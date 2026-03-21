"""opencode_adapter.py 測試"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from devap.adapters.opencode_adapter import OpenCodeAdapter
from devap.models.types import ExecuteOptions, Task


def _make_task(**kwargs: object) -> Task:
    defaults = {"id": "T-001", "title": "Test", "spec": "spec"}
    defaults.update(kwargs)  # type: ignore[arg-type]
    return Task(**defaults)  # type: ignore[arg-type]


class TestOpenCodeAdapterBasic:
    def test_name(self) -> None:
        adapter = OpenCodeAdapter()
        assert adapter.name == "opencode"


class TestIsAvailable:
    @pytest.mark.asyncio
    async def test_available(self) -> None:
        adapter = OpenCodeAdapter()
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"1.0.0", b""))

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter.is_available()
        assert result is True

    @pytest.mark.asyncio
    async def test_not_available(self) -> None:
        adapter = OpenCodeAdapter()

        with patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
            result = await adapter.is_available()
        assert result is False


class TestBuildPrompt:
    def test_basic(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task()
        prompt = adapter._build_prompt(task)
        assert "Test" in prompt
        assert "spec" in prompt

    def test_with_verify(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task(verify_command="pnpm test")
        prompt = adapter._build_prompt(task)
        assert "pnpm test" in prompt


class TestBuildArgs:
    def test_basic(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")
        args = adapter._build_args(task, options)
        assert "-p" in args
        assert "--output-format" in args

    def test_with_session(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp", session_id="sess-1")
        args = adapter._build_args(task, options)
        assert "--resume" in args
        assert "sess-1" in args

    def test_with_max_turns(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task(max_turns=30)
        options = ExecuteOptions(cwd="/tmp")
        args = adapter._build_args(task, options)
        assert "--max-turns" in args
        assert "30" in args


class TestExecuteTask:
    @pytest.mark.asyncio
    async def test_success(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        cli_output = json.dumps({
            "session_id": "oc-sess-1",
            "subtype": "success",
            "is_error": False,
            "cost_usd": 0.3,
            "duration_ms": 2000,
        })

        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(cli_output.encode(), b""))

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter.execute_task(task, options)

        assert result.status == "success"
        assert result.session_id == "oc-sess-1"
        assert result.cost_usd == 0.3

    @pytest.mark.asyncio
    async def test_failure(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        with patch("asyncio.create_subprocess_exec", side_effect=RuntimeError("boom")):
            result = await adapter.execute_task(task, options)

        assert result.status == "failed"
        assert "boom" in (result.error or "")

    @pytest.mark.asyncio
    async def test_timeout(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        cli_output = json.dumps({
            "session_id": "oc-sess-1",
            "subtype": "error_max_turns",
            "is_error": True,
            "cost_usd": 1.0,
            "duration_ms": 5000,
        })

        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(cli_output.encode(), b""))

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter.execute_task(task, options)

        assert result.status == "timeout"

    @pytest.mark.asyncio
    async def test_invalid_json(self) -> None:
        adapter = OpenCodeAdapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"not json", b""))

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await adapter.execute_task(task, options)

        assert result.status == "failed"
        assert "解析失敗" in (result.error or "")
