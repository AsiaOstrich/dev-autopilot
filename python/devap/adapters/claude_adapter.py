"""
Claude Agent SDK Adapter

透過 claude-agent-sdk 呼叫 Claude Code 執行任務。
支援 session resume、fork、max_turns、max_budget_usd。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from devap.models.types import (
    AgentAdapter,
    ExecuteOptions,
    Task,
    TaskResult,
    TaskStatus,
)


class ClaudeAdapter(AgentAdapter):
    """
    Claude Agent SDK Adapter

    將 devap 的 Task 轉換為 Claude Agent SDK 的 query 呼叫。
    """

    @property
    def name(self) -> str:
        """agent 類型名稱"""
        return "claude"

    async def execute_task(
        self, task: Task, options: ExecuteOptions
    ) -> TaskResult:
        """
        執行單一任務

        透過 claude-agent-sdk 發送 prompt，
        解析回傳的 message stream 提取 session_id、status、cost。

        Args:
            task: 要執行的任務
            options: 執行選項

        Returns:
            任務執行結果
        """
        start_time = time.monotonic()

        try:
            from claude_agent_sdk import query

            prompt = self._build_prompt(task)
            sdk_options = self._build_options(task, options)

            session_id: Optional[str] = None
            result_message: Optional[dict[str, Any]] = None

            async for message in query(prompt=prompt, options=sdk_options):  # type: ignore[arg-type]
                msg_type = getattr(message, "type", None)
                msg_subtype = getattr(message, "subtype", None)

                # 提取 session_id（init 訊息）
                if msg_type == "system" and msg_subtype == "init":
                    session_id = getattr(message, "session_id", None)

                # 捕獲結果訊息
                if msg_type == "result":
                    result_message = {
                        "subtype": msg_subtype,
                        "session_id": getattr(message, "session_id", None),
                        "total_cost_usd": getattr(message, "total_cost_usd", None),
                        "duration_ms": getattr(message, "duration_ms", None),
                    }

            return self._build_result(task, session_id, result_message, start_time)

        except Exception as e:
            return TaskResult(
                task_id=task.id,
                session_id=None,
                status="failed",
                duration_ms=(time.monotonic() - start_time) * 1000,
                error=str(e),
            )

    async def is_available(self) -> bool:
        """
        檢查 Claude CLI 是否可用

        嘗試執行 `claude --version` 確認 CLI 已安裝。
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                "claude", "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()
            return proc.returncode == 0
        except (FileNotFoundError, OSError):
            return False

    async def resume_session(self, session_id: str) -> None:
        """恢復指定 session（透過 SDK options.resume 實現）"""
        pass

    def _build_prompt(self, task: Task) -> str:
        """構建送給 Claude 的 prompt"""
        prompt = f"請執行以下任務：\n\n## {task.title}\n\n{task.spec}"

        if task.verify_command:
            prompt += (
                f"\n\n## 驗收條件\n"
                f"執行完成後請用以下指令驗證：\n"
                f"```bash\n{task.verify_command}\n```"
            )

        return prompt

    def _build_options(self, task: Task, options: ExecuteOptions) -> dict[str, object]:
        """構建 SDK options"""
        sdk_options: dict[str, object] = {
            "cwd": options.cwd,
            "permissionMode": "acceptEdits",
        }

        # Session resume / fork
        if options.session_id:
            sdk_options["resume"] = options.session_id
            if options.fork_session or task.fork_session:
                sdk_options["forkSession"] = True

        # 限制
        if task.max_turns:
            sdk_options["maxTurns"] = task.max_turns
        if task.max_budget_usd:
            sdk_options["maxBudgetUsd"] = task.max_budget_usd

        # 工具限制
        if task.allowed_tools:
            sdk_options["allowedTools"] = task.allowed_tools

        return sdk_options

    def _build_result(
        self,
        task: Task,
        session_id: Optional[str],
        result: Optional[dict[str, Any]],
        start_time: float,
    ) -> TaskResult:
        """從 SDK 結果構建 TaskResult"""
        if result is None:
            return TaskResult(
                task_id=task.id,
                session_id=session_id,
                status="failed",
                duration_ms=(time.monotonic() - start_time) * 1000,
                error="未收到結果訊息",
            )

        cost_usd = result.get("total_cost_usd")
        duration_ms = result.get("duration_ms")
        subtype = result.get("subtype", "")
        result_session_id = result.get("session_id")

        final_session_id = session_id or (
            str(result_session_id) if result_session_id else None
        )

        if subtype == "success":
            return TaskResult(
                task_id=task.id,
                session_id=final_session_id,
                status="success",
                cost_usd=float(cost_usd) if cost_usd is not None else None,
                duration_ms=float(duration_ms) if duration_ms is not None else None,
                verification_passed=True,
            )

        # 錯誤情況
        status: TaskStatus = (
            "timeout"
            if subtype in ("error_max_turns", "error_max_budget_usd")
            else "failed"
        )

        return TaskResult(
            task_id=task.id,
            session_id=final_session_id,
            status=status,
            cost_usd=float(cost_usd) if cost_usd is not None else None,
            duration_ms=float(duration_ms) if duration_ms is not None else None,
            error=str(subtype),
        )
