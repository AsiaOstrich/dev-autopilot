"""
Quality Gate — 品質閘門

依序執行驗證步驟：verify → lint → type_check → static_analysis → completion_criteria。
收集驗證證據（借鑑 Superpowers Iron Law）。

靜態合規檢查（非阻塞，僅 warning）：
- AGENTS.md 同步檢查
- 前端設計合規性檢查（XSPEC-026 AC-3.x）
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable, Optional

from devap.models.types import QualityConfig, Task, VerificationEvidence


@dataclass
class ShellResult:
    """Shell 執行結果"""

    exit_code: int
    stdout: str
    stderr: str


# Shell 執行器類型
ShellExecutor = Callable[[str, str], Awaitable[ShellResult]]


@dataclass
class QualityGateStep:
    """Quality Gate 單一步驟結果"""

    name: str
    command: str
    passed: bool
    output: str


@dataclass
class QualityGateResult:
    """Quality Gate 檢查結果"""

    passed: bool
    steps: list[QualityGateStep] = field(default_factory=list)
    feedback: Optional[str] = None
    evidence: list[VerificationEvidence] = field(default_factory=list)


@dataclass
class FrontendDesignCheckResult:
    """前端設計合規性檢查結果"""

    step: QualityGateStep
    missing_sections: Optional[list[str]] = None
    missing_color_tokens: Optional[list[str]] = None
    anti_pattern_count: Optional[int] = None


async def run_quality_gate(
    task: Task,
    quality_config: QualityConfig,
    cwd: str,
    shell_executor: ShellExecutor,
    on_progress: Optional[Callable[[str], None]] = None,
) -> QualityGateResult:
    """
    執行品質閘門

    Args:
        task: 要驗證的任務
        quality_config: 品質設定
        cwd: 工作目錄
        shell_executor: Shell 執行器
        on_progress: 進度回呼

    Returns:
        品質閘門檢查結果
    """
    steps: list[QualityGateStep] = []
    evidence: list[VerificationEvidence] = []

    has_test_levels = bool(task.test_levels and len(task.test_levels) > 0)

    async def run_step(name: str, command: str) -> QualityGateStep:
        step = await _execute_step(name, command, cwd, shell_executor)
        steps.append(step)
        evidence.append(VerificationEvidence(
            command=command,
            exit_code=0 if step.passed else 1,
            output=step.output[:2000],
            timestamp=datetime.now(timezone.utc).isoformat(),
        ))
        return step

    # 多層級測試模式
    if has_test_levels:
        for level in task.test_levels:  # type: ignore[union-attr]
            on_progress and on_progress(
                f"[{task.id}] Quality Gate: {level.name} → {level.command}"
            )
            step = await run_step(level.name, level.command)
            if not step.passed:
                return _build_fail_result(steps, step, evidence)

    elif quality_config.verify and task.verify_command:
        on_progress and on_progress(
            f"[{task.id}] Quality Gate: verify → {task.verify_command}"
        )
        step = await run_step("verify", task.verify_command)
        if not step.passed:
            return _build_fail_result(steps, step, evidence)

    # lint
    if quality_config.lint_command:
        on_progress and on_progress(
            f"[{task.id}] Quality Gate: lint → {quality_config.lint_command}"
        )
        step = await run_step("lint", quality_config.lint_command)
        if not step.passed:
            return _build_fail_result(steps, step, evidence)

    # type_check
    if quality_config.type_check_command:
        on_progress and on_progress(
            f"[{task.id}] Quality Gate: type_check → {quality_config.type_check_command}"
        )
        step = await run_step("type_check", quality_config.type_check_command)
        if not step.passed:
            return _build_fail_result(steps, step, evidence)

    # static_analysis
    if quality_config.static_analysis_command:
        on_progress and on_progress(
            f"[{task.id}] Quality Gate: static_analysis → {quality_config.static_analysis_command}"
        )
        step = await run_step("static_analysis", quality_config.static_analysis_command)
        if not step.passed:
            return _build_fail_result(steps, step, evidence)

    # completion_criteria
    if quality_config.completion_criteria:
        for check in quality_config.completion_criteria:
            if not check.command:
                continue
            on_progress and on_progress(
                f"[{task.id}] Quality Gate: completion_check → {check.command}"
            )
            step = await run_step("completion_check", check.command)
            if not step.passed and check.required:
                return _build_fail_result(steps, step, evidence)

    # 前端設計合規性檢查（非阻塞，僅 warning）
    # 純後端 API 或 CLI 專案若無 DESIGN.md，不視為錯誤
    fd_result = check_frontend_design_compliance(cwd)
    if fd_result is not None:
        steps.append(fd_result.step)
        evidence.append(VerificationEvidence(
            command="frontend_design_check",
            exit_code=0 if fd_result.step.passed else 1,
            output=fd_result.step.output[:2000],
            timestamp=datetime.now(timezone.utc).isoformat(),
        ))
        if not fd_result.step.passed:
            on_progress and on_progress(
                f"[{task.id}] Quality Gate: DESIGN.md compliance issues detected (warning only)"
            )

    return QualityGateResult(passed=True, steps=steps, evidence=evidence)


async def _execute_step(
    name: str,
    command: str,
    cwd: str,
    shell_executor: ShellExecutor,
) -> QualityGateStep:
    """執行單一品質檢查步驟"""
    try:
        result = await shell_executor(command, cwd)
        passed = result.exit_code == 0
        output = result.stdout if passed else result.stderr or result.stdout
        return QualityGateStep(
            name=name,
            command=command,
            passed=passed,
            output=output,
        )
    except Exception as e:
        return QualityGateStep(
            name=name,
            command=command,
            passed=False,
            output=str(e),
        )


def _build_fail_result(
    steps: list[QualityGateStep],
    failed_step: QualityGateStep,
    evidence: list[VerificationEvidence],
) -> QualityGateResult:
    """構建失敗結果"""
    return QualityGateResult(
        passed=False,
        steps=steps,
        feedback=(
            f"Quality Gate 失敗於 {failed_step.name} 步驟\n"
            f"指令: {failed_step.command}\n"
            f"輸出: {failed_step.output[:500]}"
        ),
        evidence=evidence,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 前端設計合規性驗證
# 來源：UDS frontend-design-standards.ai.yaml（XSPEC-026 Phase 1）
# ─────────────────────────────────────────────────────────────────────────────

# DESIGN.md 必填段落（snake_case 和 kebab-case 兩種格式）
_REQUIRED_DESIGN_SECTIONS: list[list[str]] = [
    ["visual_theme", "visual-theme"],
    ["color_palette", "color-palette"],
    ["typography"],
    ["component_styling", "component-styling"],
    ["layout_spacing", "layout-spacing"],
    ["design_guidelines", "design-guidelines"],
]

# 語義色彩必要 token（snake_case 和 kebab-case 兩種格式）
_REQUIRED_COLOR_TOKENS: list[list[str]] = [
    ["background"],
    ["surface"],
    ["primary_text", "primary-text"],
    ["muted_text", "muted-text"],
    ["accent"],
]

# anti_patterns 建議最低條目數
_MIN_ANTI_PATTERN_COUNT = 5


def check_frontend_design_compliance(cwd: str) -> Optional[FrontendDesignCheckResult]:
    """
    驗證前端設計合規性（XSPEC-026 AC-3.x）。

    非阻塞：DESIGN.md 不存在時回傳 None（純後端專案不應被 block）。
    DESIGN.md 存在時驗證：
    1. 6 個必填段落是否完整（缺失 → error，step.passed=False）
    2. 語義色彩 5 個必要 token 是否存在（缺失 → warn）
    3. anti_patterns 條目數是否 ≥ 5（不足 → warn）

    Args:
        cwd: 專案根目錄路徑

    Returns:
        FrontendDesignCheckResult 或 None（若無 DESIGN.md）
    """
    design_md_path = Path(cwd) / "DESIGN.md"

    if not design_md_path.exists():
        # DESIGN.md 不存在 → 跳過（非前端專案不應被 block）
        return None

    content = design_md_path.read_text(encoding="utf-8")

    issues: list[str] = []
    missing_sections: list[str] = []
    missing_color_tokens: list[str] = []
    anti_pattern_count: Optional[int] = None

    # 1. 必填段落完整性檢查
    for aliases in _REQUIRED_DESIGN_SECTIONS:
        found = any(
            re.search(
                rf"(?:^#{'{1,6}'}\s+{re.escape(alias)}\b|^{re.escape(alias)}\s*:)",
                content,
                re.IGNORECASE | re.MULTILINE,
            )
            for alias in aliases
        )
        if not found:
            missing_sections.append(aliases[0])

    if missing_sections:
        issues.append(
            f"缺少必填段落（{len(missing_sections)} 個）：{', '.join(missing_sections)}\n"
            f"  → 請在 DESIGN.md 中補充上述段落（支援 ## section_name 或 section_name: 格式）"
        )

    # 2. 語義色彩 token 檢查（warn）
    for aliases in _REQUIRED_COLOR_TOKENS:
        found = any(
            re.search(rf"\b{re.escape(alias)}\s*[=:\-]", content, re.IGNORECASE)
            for alias in aliases
        )
        if not found:
            missing_color_tokens.append(aliases[0])

    if missing_color_tokens:
        issues.append(
            f"語義色彩 token 不完整，缺少：{', '.join(missing_color_tokens)}\n"
            f"  → 建議在 color_palette 段落中補充上述 token"
        )

    # 3. anti_patterns 條目數檢查（warn）
    ap_match = re.search(
        r"(?:anti[_\-]patterns?)\s*[:\n](.*?)(?=\n#{1,6}\s|\n\w[\w\-]*\s*:|$)",
        content,
        re.IGNORECASE | re.DOTALL,
    )
    if ap_match:
        list_items = re.findall(r"^\s*[-*+]\s+\S", ap_match.group(1), re.MULTILINE)
        anti_pattern_count = len(list_items)
        if anti_pattern_count < _MIN_ANTI_PATTERN_COUNT:
            issues.append(
                f"design_guidelines.anti_patterns 條目不足"
                f"（目前 {anti_pattern_count} 條，建議 ≥ {_MIN_ANTI_PATTERN_COUNT} 條）\n"
                f"  → 請補充常見的前端設計反模式"
            )

    passed = len(missing_sections) == 0
    output_lines: list[str] = []

    if passed and not issues:
        output_lines.append("DESIGN.md 前端設計合規性驗證通過。")
    else:
        output_lines.append("DESIGN.md 前端設計合規性問題：")
        for i, issue in enumerate(issues, 1):
            output_lines.append(f"\n[{i}] {issue}")
        if passed:
            output_lines.append("\n（必填段落完整，上述為 warning 項目）")
        else:
            output_lines.append("\n請修正上述 error 項目（必填段落缺失），warning 項目建議補充。")

    return FrontendDesignCheckResult(
        step=QualityGateStep(
            name="frontend_design_check",
            command="frontend_design_check",
            passed=passed,
            output="".join(output_lines),
        ),
        missing_sections=missing_sections or None,
        missing_color_tokens=missing_color_tokens or None,
        anti_pattern_count=anti_pattern_count,
    )
