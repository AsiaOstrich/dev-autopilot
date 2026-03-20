"""
Quality Gate — 品質閘門

依序執行驗證步驟：verify → lint → type_check → static_analysis → completion_criteria。
收集驗證證據（借鑑 Superpowers Iron Law）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
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
