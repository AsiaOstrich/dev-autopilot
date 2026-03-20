"""
CLI Adapter

透過 `claude -p --output-format json` 子進程執行任務。
零外部依賴，只需使用者本機安裝的 `claude` CLI。
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Literal, Optional

from devap.models.types import (
    AgentAdapter,
    ExecuteOptions,
    Task,
    TaskResult,
    TaskStatus,
)


# --- Output Parser ---


@dataclass
class CliJsonOutput:
    """Claude CLI JSON 輸出結構，對應 --output-format json 的回傳格式"""

    type: str
    subtype: str
    is_error: bool
    session_id: str
    duration_ms: Optional[float]
    duration_api_ms: Optional[float]
    num_turns: int
    result: str
    cost_usd: float


def parse_cli_output(stdout: str) -> CliJsonOutput:
    """
    解析 Claude CLI 的 JSON 輸出

    Args:
        stdout: CLI 的標準輸出（JSON 字串）

    Returns:
        解析後的結構化輸出

    Raises:
        ValueError: 若 JSON 解析失敗
    """
    trimmed = stdout.strip()
    if not trimmed:
        raise ValueError("CLI 輸出為空")

    try:
        parsed = json.loads(trimmed)
    except json.JSONDecodeError as e:
        raise ValueError(f"CLI 輸出不是有效的 JSON：{trimmed[:200]}") from e

    session_id = parsed.get("session_id")
    if not isinstance(session_id, str):
        raise ValueError("CLI 輸出缺少 session_id")

    return CliJsonOutput(
        type=parsed.get("type", ""),
        subtype=parsed.get("subtype", ""),
        is_error=parsed.get("is_error", False),
        session_id=session_id,
        duration_ms=parsed.get("duration_ms"),
        duration_api_ms=parsed.get("duration_api_ms"),
        num_turns=parsed.get("num_turns", 0),
        result=parsed.get("result", ""),
        cost_usd=parsed.get("cost_usd", 0.0),
    )


def resolve_status(output: CliJsonOutput) -> Literal["success", "failed", "timeout"]:
    """
    判斷 CLI 輸出的執行狀態

    Args:
        output: 解析後的 CLI 輸出

    Returns:
        執行狀態
    """
    if not output.is_error and output.subtype == "success":
        return "success"
    if output.subtype in ("error_max_turns", "error_max_budget_usd"):
        return "timeout"
    return "failed"


# --- Adapter ---


class CliAdapter(AgentAdapter):
    """
    CLI Adapter — 使用 `claude -p` 子進程執行任務

    每個任務啟動一個獨立的 `claude` 子進程，
    透過 `--output-format json` 取得結構化結果。
    """

    @property
    def name(self) -> str:
        """agent 類型名稱"""
        return "cli"

    async def execute_task(
        self, task: Task, options: ExecuteOptions
    ) -> TaskResult:
        """
        執行單一任務

        spawn `claude -p` 子進程，將 task spec 作為 prompt，
        解析 JSON 輸出取得 session_id、cost、status。

        Args:
            task: 要執行的任務
            options: 執行選項

        Returns:
            任務執行結果
        """
        start_time = time.monotonic()
        args = self._build_args(task, options)
        prompt = self._build_prompt(task)

        try:
            stdout = await self._spawn_claude(args, prompt, options.cwd)
            output = parse_cli_output(stdout)
            status: TaskStatus = resolve_status(output)

            return TaskResult(
                task_id=task.id,
                session_id=output.session_id,
                status=status,
                cost_usd=output.cost_usd,
                duration_ms=output.duration_ms or ((time.monotonic() - start_time) * 1000),
                verification_passed=status == "success",
                error=output.subtype if status != "success" else None,
            )
        except Exception as e:
            return TaskResult(
                task_id=task.id,
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

    def _build_args(self, task: Task, options: ExecuteOptions) -> list[str]:
        """構建 CLI 啟動參數"""
        args = ["-p", "--output-format", "json", "--verbose"]

        # 權限模式
        args.extend(["--permission-mode", "accept-edits"])

        # Session resume
        if options.session_id:
            args.extend(["--resume", options.session_id])

        # 限制
        if task.max_turns:
            args.extend(["--max-turns", str(task.max_turns)])

        # 工具限制
        if task.allowed_tools:
            args.extend(["--allowedTools", ",".join(task.allowed_tools)])

        return args

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

    async def _spawn_claude(
        self, args: list[str], prompt: str, cwd: str
    ) -> str:
        """
        啟動 claude 子進程並收集輸出

        Args:
            args: CLI 參數
            prompt: 要送給 claude 的 prompt
            cwd: 工作目錄

        Returns:
            stdout 輸出

        Raises:
            RuntimeError: 子進程啟動或執行失敗
        """
        proc = await asyncio.create_subprocess_exec(
            "claude", *args,
            cwd=cwd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate(input=prompt.encode())

        stdout_str = stdout.decode()
        if proc.returncode != 0 and not stdout_str.strip():
            raise RuntimeError(
                f"claude 子進程以 exit code {proc.returncode} 退出：{stderr.decode()}"
            )

        return stdout_str
