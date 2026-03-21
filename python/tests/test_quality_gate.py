"""quality_gate.py 測試"""

import pytest
from devap.models.types import (
    CompletionCheck,
    QualityConfig,
    Task,
    TestLevel,
)
from devap.quality_gate import (
    ShellResult,
    run_quality_gate,
)


def _make_task(**kwargs: object) -> Task:
    defaults = {"id": "T-001", "title": "Test", "spec": "spec"}
    defaults.update(kwargs)  # type: ignore[arg-type]
    return Task(**defaults)  # type: ignore[arg-type]


def _make_config(**kwargs: object) -> QualityConfig:
    return QualityConfig(**kwargs)  # type: ignore[arg-type]


class TestMultiLevelTest:
    """多層級測試：task.test_levels 依序執行各 level command"""

    @pytest.mark.asyncio
    async def test_all_levels_pass(self) -> None:
        task = _make_task(
            test_levels=[
                TestLevel(name="unit", command="pytest -m unit"),
                TestLevel(name="integration", command="pytest -m integration"),
            ]
        )
        config = _make_config(verify=True)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True
        assert len(result.steps) == 2
        assert result.steps[0].name == "unit"
        assert result.steps[1].name == "integration"

    @pytest.mark.asyncio
    async def test_first_level_fails_stops(self) -> None:
        task = _make_task(
            test_levels=[
                TestLevel(name="unit", command="pytest -m unit"),
                TestLevel(name="integration", command="pytest -m integration"),
            ]
        )
        config = _make_config(verify=True)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            if "unit" in cmd:
                return ShellResult(exit_code=1, stdout="", stderr="FAIL")
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is False
        assert len(result.steps) == 1
        assert "unit" in (result.feedback or "")

    @pytest.mark.asyncio
    async def test_second_level_fails(self) -> None:
        task = _make_task(
            test_levels=[
                TestLevel(name="unit", command="pytest -m unit"),
                TestLevel(name="integration", command="pytest -m integration"),
            ]
        )
        config = _make_config(verify=True)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            if "integration" in cmd:
                return ShellResult(exit_code=1, stdout="", stderr="FAIL")
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is False
        assert len(result.steps) == 2


class TestVerifyMode:
    """單一 verify 模式"""

    @pytest.mark.asyncio
    async def test_verify_pass(self) -> None:
        task = _make_task(verify_command="pnpm test")
        config = _make_config(verify=True)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="all passed", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True
        assert result.steps[0].name == "verify"

    @pytest.mark.asyncio
    async def test_verify_fail(self) -> None:
        task = _make_task(verify_command="pnpm test")
        config = _make_config(verify=True)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=1, stdout="", stderr="FAIL")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is False

    @pytest.mark.asyncio
    async def test_verify_skipped_when_config_false(self) -> None:
        task = _make_task(verify_command="pnpm test")
        config = _make_config(verify=False)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True
        assert len(result.steps) == 0


class TestLintAndTypeCheck:
    """lint / type_check / static_analysis 步驟"""

    @pytest.mark.asyncio
    async def test_lint_pass(self) -> None:
        task = _make_task()
        config = _make_config(lint_command="ruff check .")

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True
        assert any(s.name == "lint" for s in result.steps)

    @pytest.mark.asyncio
    async def test_lint_fail_stops(self) -> None:
        task = _make_task()
        config = _make_config(lint_command="ruff check .", type_check_command="mypy .")

        async def executor(cmd: str, cwd: str) -> ShellResult:
            if "ruff" in cmd:
                return ShellResult(exit_code=1, stdout="", stderr="lint error")
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is False
        # type_check should NOT have run
        assert not any(s.name == "type_check" for s in result.steps)

    @pytest.mark.asyncio
    async def test_type_check_pass(self) -> None:
        task = _make_task()
        config = _make_config(type_check_command="mypy .")

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True
        assert any(s.name == "type_check" for s in result.steps)

    @pytest.mark.asyncio
    async def test_static_analysis_pass(self) -> None:
        task = _make_task()
        config = _make_config(static_analysis_command="semgrep --config=auto")

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True
        assert any(s.name == "static_analysis" for s in result.steps)


class TestCompletionCriteria:
    """completion_criteria 測試"""

    @pytest.mark.asyncio
    async def test_required_check_pass(self) -> None:
        task = _make_task()
        config = _make_config(
            completion_criteria=[
                CompletionCheck(name="coverage", command="pytest --cov", required=True),
            ]
        )

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True

    @pytest.mark.asyncio
    async def test_required_check_fail_stops(self) -> None:
        task = _make_task()
        config = _make_config(
            completion_criteria=[
                CompletionCheck(name="coverage", command="pytest --cov", required=True),
                CompletionCheck(name="docs", command="doc-check", required=True),
            ]
        )

        async def executor(cmd: str, cwd: str) -> ShellResult:
            if "cov" in cmd:
                return ShellResult(exit_code=1, stdout="", stderr="low coverage")
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is False
        # docs should NOT have run since coverage is required and failed
        assert not any(s.name == "docs" for s in result.steps)

    @pytest.mark.asyncio
    async def test_optional_check_fail_continues(self) -> None:
        task = _make_task()
        config = _make_config(
            completion_criteria=[
                CompletionCheck(name="coverage", command="pytest --cov", required=False),
                CompletionCheck(name="docs", command="doc-check", required=True),
            ]
        )

        async def executor(cmd: str, cwd: str) -> ShellResult:
            if "cov" in cmd:
                return ShellResult(exit_code=1, stdout="", stderr="low coverage")
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True
        assert len(result.steps) == 2

    @pytest.mark.asyncio
    async def test_check_without_command_skipped(self) -> None:
        task = _make_task()
        config = _make_config(
            completion_criteria=[
                CompletionCheck(name="manual", command=None, required=True),
            ]
        )

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is True
        assert len(result.steps) == 0


class TestEvidence:
    """evidence 收集"""

    @pytest.mark.asyncio
    async def test_evidence_collected(self) -> None:
        task = _make_task(verify_command="pnpm test")
        config = _make_config(verify=True, lint_command="ruff check .")

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert len(result.evidence) == 2
        assert result.evidence[0].command == "pnpm test"
        assert result.evidence[0].exit_code == 0
        assert result.evidence[1].command == "ruff check ."

    @pytest.mark.asyncio
    async def test_evidence_on_failure(self) -> None:
        task = _make_task(verify_command="pnpm test")
        config = _make_config(verify=True)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=1, stdout="", stderr="FAIL")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert len(result.evidence) == 1
        assert result.evidence[0].exit_code == 1


class TestProgressCallback:
    """progress 回呼"""

    @pytest.mark.asyncio
    async def test_progress_called(self) -> None:
        task = _make_task(verify_command="pnpm test")
        config = _make_config(verify=True)
        messages: list[str] = []

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        await run_quality_gate(task, config, "/tmp", executor, on_progress=messages.append)
        assert len(messages) == 1
        assert "verify" in messages[0]


class TestExecutorException:
    """executor 拋出例外"""

    @pytest.mark.asyncio
    async def test_exception_treated_as_failure(self) -> None:
        task = _make_task(verify_command="pnpm test")
        config = _make_config(verify=True)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            raise RuntimeError("connection failed")

        result = await run_quality_gate(task, config, "/tmp", executor)
        assert result.passed is False
        assert "connection failed" in (result.feedback or "")
