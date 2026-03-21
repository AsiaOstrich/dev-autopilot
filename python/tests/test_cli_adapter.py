"""cli_adapter.py 測試"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from devap.adapters.cli_adapter import (
    CliAdapter,
    CliJsonOutput,
    parse_cli_output,
    resolve_status,
)
from devap.models.types import ExecuteOptions, Task


def _make_task(**kwargs: object) -> Task:
    defaults = {"id": "T-001", "title": "Test", "spec": "spec"}
    defaults.update(kwargs)  # type: ignore[arg-type]
    return Task(**defaults)  # type: ignore[arg-type]


# --- parse_cli_output ---


class TestParseCliOutput:
    def test_valid_json(self) -> None:
        stdout = json.dumps({
            "type": "result",
            "subtype": "success",
            "is_error": False,
            "session_id": "sess-1",
            "duration_ms": 500,
            "duration_api_ms": 300,
            "num_turns": 3,
            "result": "done",
            "cost_usd": 0.5,
        })
        output = parse_cli_output(stdout)
        assert output.session_id == "sess-1"
        assert output.cost_usd == 0.5
        assert output.is_error is False
        assert output.num_turns == 3

    def test_empty_string_raises(self) -> None:
        with pytest.raises(ValueError, match="為空"):
            parse_cli_output("")

    def test_whitespace_only_raises(self) -> None:
        with pytest.raises(ValueError, match="為空"):
            parse_cli_output("   \n  ")

    def test_invalid_json_raises(self) -> None:
        with pytest.raises(ValueError, match="不是有效的 JSON"):
            parse_cli_output("not json at all")

    def test_missing_session_id_raises(self) -> None:
        with pytest.raises(ValueError, match="session_id"):
            parse_cli_output(json.dumps({"type": "result"}))


# --- resolve_status ---


class TestResolveStatus:
    def test_success(self) -> None:
        output = CliJsonOutput(
            type="result", subtype="success", is_error=False,
            session_id="s1", duration_ms=100, duration_api_ms=50,
            num_turns=1, result="ok", cost_usd=0.1,
        )
        assert resolve_status(output) == "success"

    def test_timeout_max_turns(self) -> None:
        output = CliJsonOutput(
            type="result", subtype="error_max_turns", is_error=True,
            session_id="s1", duration_ms=100, duration_api_ms=50,
            num_turns=1, result="", cost_usd=0.1,
        )
        assert resolve_status(output) == "timeout"

    def test_timeout_max_budget(self) -> None:
        output = CliJsonOutput(
            type="result", subtype="error_max_budget_usd", is_error=True,
            session_id="s1", duration_ms=100, duration_api_ms=50,
            num_turns=1, result="", cost_usd=5.0,
        )
        assert resolve_status(output) == "timeout"

    def test_failed(self) -> None:
        output = CliJsonOutput(
            type="result", subtype="error", is_error=True,
            session_id="s1", duration_ms=100, duration_api_ms=50,
            num_turns=1, result="", cost_usd=0.1,
        )
        assert resolve_status(output) == "failed"

    def test_is_error_but_success_subtype(self) -> None:
        """is_error=True but subtype='success' → still success because of AND condition"""
        output = CliJsonOutput(
            type="result", subtype="success", is_error=True,
            session_id="s1", duration_ms=100, duration_api_ms=50,
            num_turns=1, result="", cost_usd=0.1,
        )
        # is_error is True, so the first condition fails → falls through to "failed"
        assert resolve_status(output) == "failed"


# --- CliAdapter ---


class TestCliAdapter:
    def test_name(self) -> None:
        adapter = CliAdapter()
        assert adapter.name == "cli"

    @pytest.mark.asyncio
    async def test_is_available_true(self) -> None:
        adapter = CliAdapter()
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"1.0.0", b""))

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter.is_available()
        assert result is True

    @pytest.mark.asyncio
    async def test_is_available_false(self) -> None:
        adapter = CliAdapter()

        with patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
            result = await adapter.is_available()
        assert result is False

    def test_build_prompt_basic(self) -> None:
        adapter = CliAdapter()
        task = _make_task()
        prompt = adapter._build_prompt(task)
        assert "Test" in prompt
        assert "spec" in prompt

    def test_build_prompt_with_verify(self) -> None:
        adapter = CliAdapter()
        task = _make_task(verify_command="pnpm test")
        prompt = adapter._build_prompt(task)
        assert "pnpm test" in prompt
        assert "驗收條件" in prompt

    def test_build_prompt_without_verify(self) -> None:
        adapter = CliAdapter()
        task = _make_task(verify_command=None)
        prompt = adapter._build_prompt(task)
        assert "驗收條件" not in prompt

    @pytest.mark.asyncio
    async def test_execute_task_success(self) -> None:
        adapter = CliAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        cli_output = json.dumps({
            "type": "result",
            "subtype": "success",
            "is_error": False,
            "session_id": "sess-1",
            "duration_ms": 500,
            "duration_api_ms": 300,
            "num_turns": 3,
            "result": "done",
            "cost_usd": 0.5,
        })

        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(cli_output.encode(), b""))

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter.execute_task(task, options)

        assert result.status == "success"
        assert result.session_id == "sess-1"
        assert result.cost_usd == 0.5

    @pytest.mark.asyncio
    async def test_execute_task_failure(self) -> None:
        adapter = CliAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        with patch("asyncio.create_subprocess_exec", side_effect=RuntimeError("boom")):
            result = await adapter.execute_task(task, options)

        assert result.status == "failed"
        assert "boom" in (result.error or "")
