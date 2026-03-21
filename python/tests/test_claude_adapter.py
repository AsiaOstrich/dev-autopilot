"""claude_adapter.py 測試"""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from devap.adapters.claude_adapter import ClaudeAdapter
from devap.models.types import ExecuteOptions, Task


def _make_task(**kwargs: object) -> Task:
    defaults = {"id": "T-001", "title": "Test", "spec": "spec"}
    defaults.update(kwargs)  # type: ignore[arg-type]
    return Task(**defaults)  # type: ignore[arg-type]


class TestClaudeAdapterBasic:
    def test_name(self) -> None:
        adapter = ClaudeAdapter()
        assert adapter.name == "claude"


class TestIsAvailable:
    @pytest.mark.asyncio
    async def test_available(self) -> None:
        adapter = ClaudeAdapter()
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"1.0.0", b""))

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter.is_available()
        assert result is True

    @pytest.mark.asyncio
    async def test_not_available(self) -> None:
        adapter = ClaudeAdapter()

        with patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
            result = await adapter.is_available()
        assert result is False


class TestBuildPrompt:
    def test_basic(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task()
        prompt = adapter._build_prompt(task)
        assert "Test" in prompt
        assert "spec" in prompt

    def test_with_verify(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task(verify_command="pnpm test")
        prompt = adapter._build_prompt(task)
        assert "pnpm test" in prompt
        assert "驗收條件" in prompt

    def test_without_verify(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task(verify_command=None)
        prompt = adapter._build_prompt(task)
        assert "驗收條件" not in prompt


class TestBuildOptions:
    def test_basic(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")
        sdk_opts = adapter._build_options(task, options)
        assert sdk_opts["cwd"] == "/tmp"
        assert sdk_opts["permissionMode"] == "acceptEdits"

    def test_with_session(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp", session_id="sess-1")
        sdk_opts = adapter._build_options(task, options)
        assert sdk_opts["resume"] == "sess-1"

    def test_with_fork(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task(fork_session=True)
        options = ExecuteOptions(cwd="/tmp", session_id="sess-1")
        sdk_opts = adapter._build_options(task, options)
        assert sdk_opts["forkSession"] is True

    def test_with_limits(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task(max_turns=20, max_budget_usd=2.0)
        options = ExecuteOptions(cwd="/tmp")
        sdk_opts = adapter._build_options(task, options)
        assert sdk_opts["maxTurns"] == 20
        assert sdk_opts["maxBudgetUsd"] == 2.0

    def test_with_allowed_tools(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task(allowed_tools=["Read", "Write"])
        options = ExecuteOptions(cwd="/tmp")
        sdk_opts = adapter._build_options(task, options)
        assert sdk_opts["allowedTools"] == ["Read", "Write"]


class TestBuildResult:
    def test_no_result_message(self) -> None:
        import time
        adapter = ClaudeAdapter()
        task = _make_task()
        result = adapter._build_result(task, "sess-1", None, time.monotonic())
        assert result.status == "failed"
        assert "未收到結果訊息" in (result.error or "")

    def test_success(self) -> None:
        import time
        adapter = ClaudeAdapter()
        task = _make_task()
        msg: dict[str, Any] = {
            "subtype": "success",
            "session_id": "sess-1",
            "total_cost_usd": 0.5,
            "duration_ms": 3000,
        }
        result = adapter._build_result(task, "sess-1", msg, time.monotonic())
        assert result.status == "success"
        assert result.cost_usd == 0.5
        assert result.verification_passed is True

    def test_timeout(self) -> None:
        import time
        adapter = ClaudeAdapter()
        task = _make_task()
        msg: dict[str, Any] = {
            "subtype": "error_max_turns",
            "session_id": "sess-1",
            "total_cost_usd": 1.0,
            "duration_ms": 5000,
        }
        result = adapter._build_result(task, None, msg, time.monotonic())
        assert result.status == "timeout"

    def test_failed(self) -> None:
        import time
        adapter = ClaudeAdapter()
        task = _make_task()
        msg: dict[str, Any] = {
            "subtype": "error",
            "session_id": None,
            "total_cost_usd": None,
            "duration_ms": None,
        }
        result = adapter._build_result(task, None, msg, time.monotonic())
        assert result.status == "failed"


class TestExecuteTask:
    @pytest.mark.asyncio
    async def test_sdk_import_failure(self) -> None:
        adapter = ClaudeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        # claude_agent_sdk 未安裝時應回傳 failed
        with patch.dict("sys.modules", {"claude_agent_sdk": None}):
            result = await adapter.execute_task(task, options)
        assert result.status == "failed"
