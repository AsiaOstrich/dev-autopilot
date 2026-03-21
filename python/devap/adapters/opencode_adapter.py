"""
OpenCode SDK Adapter

透過 HTTP API 呼叫 OpenCode 執行任務。
OpenCode 使用 Client/Server 架構，需先啟動 server 再透過 HTTP API 操作。
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Optional

from devap.models.types import (
    AgentAdapter,
    ExecuteOptions,
    Task,
    TaskResult,
    TaskStatus,
)


class OpenCodeAdapter(AgentAdapter):
    """
    OpenCode SDK Adapter

    透過 OpenCode CLI 的 HTTP API 執行任務。
    """

    def __init__(self) -> None:
        self._server_url: Optional[str] = None

    @property
    def name(self) -> str:
        """agent 類型名稱"""
        return "opencode"

    async def execute_task(
        self, task: Task, options: ExecuteOptions
    ) -> TaskResult:
        """
        執行單一任務

        透過 opencode CLI 子進程執行，解析 JSON 輸出。

        Args:
            task: 要執行的任務
            options: 執行選項

        Returns:
            任務執行結果
        """
        start_time = time.monotonic()

        try:
            prompt = self._build_prompt(task)
            args = self._build_args(task, options)

            proc = await asyncio.create_subprocess_exec(
                "opencode", *args,
                cwd=options.cwd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate(input=prompt.encode())
            stdout_str = stdout.decode()

            if proc.returncode != 0 and not stdout_str.strip():
                return TaskResult(
                    task_id=task.id,
                    status="failed",
                    duration_ms=(time.monotonic() - start_time) * 1000,
                    error=f"opencode 退出碼 {proc.returncode}: {stderr.decode()}",
                )

            return self._parse_result(task.id, stdout_str, start_time)

        except Exception as e:
            return TaskResult(
                task_id=task.id,
                status="failed",
                duration_ms=(time.monotonic() - start_time) * 1000,
                error=str(e),
            )

    async def is_available(self) -> bool:
        """
        檢查 OpenCode CLI 是否可用

        嘗試執行 `opencode --version` 確認已安裝。
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                "opencode", "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()
            return proc.returncode == 0
        except (FileNotFoundError, OSError):
            return False

    async def resume_session(self, session_id: str) -> None:
        """恢復指定 session"""
        pass

    def _build_prompt(self, task: Task) -> str:
        """構建送給 OpenCode 的 prompt"""
        prompt = f"請執行以下任務：\n\n## {task.title}\n\n{task.spec}"

        if task.verify_command:
            prompt += (
                f"\n\n## 驗收條件\n"
                f"執行完成後請用以下指令驗證：\n"
                f"```bash\n{task.verify_command}\n```"
            )

        return prompt

    def _build_args(self, task: Task, options: ExecuteOptions) -> list[str]:
        """構建 CLI 啟動參數"""
        args = ["-p", "--output-format", "json"]

        if options.session_id:
            args.extend(["--resume", options.session_id])

        if task.max_turns:
            args.extend(["--max-turns", str(task.max_turns)])

        return args

    def _parse_result(
        self,
        task_id: str,
        stdout: str,
        start_time: float,
    ) -> TaskResult:
        """解析 CLI 輸出為 TaskResult"""
        try:
            parsed: dict[str, Any] = json.loads(stdout.strip())
        except (json.JSONDecodeError, ValueError):
            return TaskResult(
                task_id=task_id,
                status="failed",
                duration_ms=(time.monotonic() - start_time) * 1000,
                error=f"OpenCode 輸出解析失敗：{stdout[:200]}",
            )

        session_id = parsed.get("session_id")
        cost_usd = parsed.get("cost_usd", 0.0)
        duration_ms = parsed.get("duration_ms")
        is_error = parsed.get("is_error", False)
        subtype = parsed.get("subtype", "")

        if not is_error and subtype == "success":
            return TaskResult(
                task_id=task_id,
                session_id=str(session_id) if session_id else None,
                status="success",
                cost_usd=float(cost_usd) if cost_usd is not None else None,
                duration_ms=float(duration_ms) if duration_ms is not None else (
                    (time.monotonic() - start_time) * 1000
                ),
                verification_passed=True,
            )

        status: TaskStatus = (
            "timeout"
            if subtype in ("error_max_turns", "error_max_budget_usd")
            else "failed"
        )

        return TaskResult(
            task_id=task_id,
            session_id=str(session_id) if session_id else None,
            status=status,
            cost_usd=float(cost_usd) if cost_usd is not None else None,
            duration_ms=float(duration_ms) if duration_ms is not None else (
                (time.monotonic() - start_time) * 1000
            ),
            error=subtype if status != "success" else None,
        )
