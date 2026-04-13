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
    check_frontend_design_compliance,
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


# ─────────────────────────────────────────────────────────────────────────────
# check_frontend_design_compliance — 前端設計合規性檢查
# AC-3.1：驗證 DESIGN.md 存在性
# AC-3.2：驗證必填欄位完整性，缺失時回報具體欄位名稱
# AC-3.3：失敗時給出清楚的錯誤訊息
# ─────────────────────────────────────────────────────────────────────────────

_VALID_DESIGN_MD = """# DESIGN

## visual_theme
Light theme.

## color_palette
background: #ffffff
surface: #f5f5f5
primary_text: #111111
muted_text: #888888
accent: #0070f3

## typography
font-family: Inter

## component_styling
border-radius: 4px

## layout_spacing
base: 8px

## design_guidelines

### anti_patterns
- 禁止使用魔術數字
- 禁止內嵌樣式
- 禁止超過 3 層巢狀
- 禁止不語義化的顏色
- 禁止跳過視覺層級
"""


class TestFrontendDesignCompliance:
    """前端設計合規性檢查測試（XSPEC-026 AC-3.x）"""

    def test_no_design_md_returns_none(self, tmp_path: "pytest.TempPathFactory") -> None:
        """AC-3.1：DESIGN.md 不存在時回傳 None（純後端/CLI 專案不被 block）"""
        result = check_frontend_design_compliance(str(tmp_path))
        assert result is None

    def test_valid_design_md_passes(self, tmp_path: "pytest.TempPathFactory") -> None:
        """AC-3.1 + AC-3.2：有效的完整 DESIGN.md → passed=True"""
        (tmp_path / "DESIGN.md").write_text(_VALID_DESIGN_MD, encoding="utf-8")
        result = check_frontend_design_compliance(str(tmp_path))
        assert result is not None
        assert result.step.passed is True
        assert result.step.name == "frontend_design_check"
        assert result.missing_sections is None

    def test_missing_required_sections_fails(self, tmp_path: "pytest.TempPathFactory") -> None:
        """AC-3.2：缺少必填段落時 passed=False，並回報具體缺失欄位名稱"""
        content = "# DESIGN\n\n## visual_theme\nLight.\n\n## color_palette\nbg: #fff\n"
        (tmp_path / "DESIGN.md").write_text(content, encoding="utf-8")

        result = check_frontend_design_compliance(str(tmp_path))
        assert result is not None
        assert result.step.passed is False
        assert result.missing_sections is not None
        assert "typography" in result.missing_sections
        assert "component_styling" in result.missing_sections
        assert "layout_spacing" in result.missing_sections
        assert "design_guidelines" in result.missing_sections

    def test_error_message_contains_missing_section_names(self, tmp_path: "pytest.TempPathFactory") -> None:
        """AC-3.3：錯誤訊息應清楚說明缺失的段落名稱"""
        content = "# DESIGN\n## visual_theme\nDark theme.\n"
        (tmp_path / "DESIGN.md").write_text(content, encoding="utf-8")

        result = check_frontend_design_compliance(str(tmp_path))
        assert result is not None
        assert result.step.passed is False
        # AC-3.3：錯誤訊息必須明確指出缺失內容
        assert "缺少必填段落" in result.step.output
        assert "color_palette" in result.step.output
        assert "typography" in result.step.output

    def test_missing_color_tokens_warns_but_passes(self, tmp_path: "pytest.TempPathFactory") -> None:
        """必填段落完整但缺少語義色彩 token → passed=True（warning 不 block）"""
        content = "\n".join([
            "# DESIGN",
            "## visual_theme",
            "Light.",
            "## color_palette",
            "background: #fff",
            # 缺少 surface、primary_text、muted_text、accent
            "## typography",
            "font: Inter",
            "## component_styling",
            "border: 4px",
            "## layout_spacing",
            "base: 8",
            "## design_guidelines",
            "### anti_patterns",
            "- a",
            "- b",
            "- c",
            "- d",
            "- e",
        ])
        (tmp_path / "DESIGN.md").write_text(content, encoding="utf-8")

        result = check_frontend_design_compliance(str(tmp_path))
        assert result is not None
        # 必填段落完整 → passed=True
        assert result.step.passed is True
        assert result.missing_color_tokens is not None
        assert "surface" in result.missing_color_tokens

    def test_insufficient_anti_patterns_warns_but_passes(self, tmp_path: "pytest.TempPathFactory") -> None:
        """anti_patterns 不足（< 5）→ passed=True（warning），anti_pattern_count 正確"""
        content = "\n".join([
            "# DESIGN",
            "## visual_theme",
            "Light.",
            "## color_palette",
            "background: #fff",
            "surface: #f5f",
            "primary_text: #111",
            "muted_text: #888",
            "accent: #07f",
            "## typography",
            "font: Inter",
            "## component_styling",
            "border: 4px",
            "## layout_spacing",
            "base: 8",
            "## design_guidelines",
            "### anti_patterns",
            "- 禁止魔術數字",
            "- 禁止內嵌樣式",
            # 只有 2 條
        ])
        (tmp_path / "DESIGN.md").write_text(content, encoding="utf-8")

        result = check_frontend_design_compliance(str(tmp_path))
        assert result is not None
        assert result.step.passed is True
        assert result.anti_pattern_count is not None
        assert result.anti_pattern_count < 5
        assert "anti_patterns" in result.step.output

    def test_kebab_case_section_names_recognized(self, tmp_path: "pytest.TempPathFactory") -> None:
        """kebab-case 段落名稱（如 ## visual-theme）也應被識別為合規"""
        content = "\n".join([
            "# DESIGN",
            "## visual-theme",
            "Light.",
            "## color-palette",
            "background: #fff",
            "surface: #f5f",
            "primary-text: #111",
            "muted-text: #888",
            "accent: #07f",
            "## typography",
            "font: Inter",
            "## component-styling",
            "border: 4px",
            "## layout-spacing",
            "base: 8",
            "## design-guidelines",
            "### anti_patterns",
            "- a",
            "- b",
            "- c",
            "- d",
            "- e",
        ])
        (tmp_path / "DESIGN.md").write_text(content, encoding="utf-8")

        result = check_frontend_design_compliance(str(tmp_path))
        assert result is not None
        assert result.step.passed is True
        assert result.missing_sections is None

    @pytest.mark.asyncio
    async def test_run_quality_gate_design_issues_non_blocking(self, tmp_path: "pytest.TempPathFactory") -> None:
        """runQualityGate 整合：DESIGN.md 有問題但不 block 整體 QualityGate"""
        # 寫一個缺少必填段落的 DESIGN.md
        (tmp_path / "DESIGN.md").write_text("# DESIGN\n## visual_theme\nLight.", encoding="utf-8")

        task = Task(id="T-001", title="X", spec="x")
        config = QualityConfig(verify=False)

        async def executor(cmd: str, cwd: str) -> ShellResult:
            return ShellResult(exit_code=0, stdout="ok", stderr="")

        result = await run_quality_gate(task, config, str(tmp_path), executor)

        # 整體仍然 passed（frontend_design_check 為非阻塞）
        assert result.passed is True
        # steps 中應有 frontend_design_check 步驟
        fd_steps = [s for s in result.steps if s.name == "frontend_design_check"]
        assert len(fd_steps) == 1
        assert fd_steps[0].passed is False
        assert "缺少必填段落" in fd_steps[0].output
