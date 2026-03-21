"""
Plan Resolver — 純函式橋接層

整合 validate_plan、topological_layers、merge_defaults、detect_dangerous_command、generate_claudemd，
輸出結構化的 ResolvedPlan JSON。

作為獨立模式（CLI orchestrate）與 Claude Code 模式（/orchestrate skill）的共用橋接。
純計算、無副作用（除了讀取原始 CLAUDE.md）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from devap.claudemd_generator import ClaudeMdOptions, generate_claudemd
from devap.hooks.safety_hook import detect_dangerous_command, detect_hardcoded_secrets
from devap.models.types import (
    QualityConfig,
    ResolvedLayer,
    ResolvedPlan,
    ResolvedTask,
    TaskPlan,
)
from devap.orchestrator import merge_defaults, topological_layers
from devap.plan_validator import validate_plan
from devap.quality_profile import resolve_quality_profile


@dataclass
class PlanResolverOptions:
    """Plan Resolver 選項"""

    existing_claudemd_path: Optional[str] = None
    extra_constraints: Optional[list[str]] = None


async def resolve_plan(
    plan: TaskPlan,
    options: Optional[PlanResolverOptions] = None,
) -> ResolvedPlan:
    """
    解析 TaskPlan，產出 ResolvedPlan

    流程：
    1. validate_plan() -> 格式 + DAG 驗證
    2. topological_layers() -> 分層
    3. merge_defaults() -> 合併預設值
    4. detect_dangerous_command() -> 安全檢查
    5. generate_claudemd() -> 生成每個 task 的 prompt

    Args:
        plan: 原始 TaskPlan
        options: 解析選項

    Returns:
        結構化的 ResolvedPlan
    """
    if options is None:
        options = PlanResolverOptions()

    # 1. 驗證
    validation = validate_plan(plan)

    # 解析 quality profile
    quality_config = resolve_quality_profile(plan.quality, plan.test_policy)

    # 驗證失敗時仍回傳結構（含錯誤資訊），不 throw
    if not validation.valid:
        return ResolvedPlan(
            project=plan.project or "unknown",
            mode="sequential",
            max_parallel=1,
            layers=[],
            validation=validation,
            safety_issues=[],
            total_tasks=len(plan.tasks) if plan.tasks else 0,
            quality=quality_config,
            quality_warnings=[],
        )

    # 檢查品質相關警告
    quality_warnings = _check_quality_warnings(plan, quality_config)

    # 2. 分層
    layers = topological_layers(plan.tasks)

    # 3 + 4 + 5. 合併 defaults、安全檢查、生成 prompt
    safety_issues: list[dict[str, str]] = []
    claudemd_options = ClaudeMdOptions(
        project=plan.project,
        existing_claudemd_path=options.existing_claudemd_path,
        extra_constraints=options.extra_constraints,
    )

    resolved_layers: list[ResolvedLayer] = []

    for i, layer in enumerate(layers):
        layer_tasks: list[ResolvedTask] = []

        for raw_task in layer:
            merged = merge_defaults(raw_task, plan)

            # 安全檢查 spec
            spec_dangers = detect_dangerous_command(merged.spec)
            for danger in spec_dangers:
                safety_issues.append({"task_id": merged.id, "issue": danger})

            # 安全檢查 verify_command
            if merged.verify_command:
                verify_dangers = detect_dangerous_command(merged.verify_command)
                for danger in verify_dangers:
                    safety_issues.append({"task_id": merged.id, "issue": danger})

            # 祕密掃描 spec
            spec_secrets = detect_hardcoded_secrets(merged.spec)
            for secret in spec_secrets:
                safety_issues.append({"task_id": merged.id, "issue": secret})

            # 生成 prompt
            generated_prompt = await generate_claudemd(merged, claudemd_options)

            resolved_task = ResolvedTask(
                **merged.model_dump(),
                generated_prompt=generated_prompt,
            )
            layer_tasks.append(resolved_task)

        resolved_layers.append(ResolvedLayer(index=i, tasks=layer_tasks))

    # 判斷模式
    has_parallel_layer = any(len(layer) > 1 for layer in layers)
    mode: Literal["sequential", "parallel"] = "parallel" if has_parallel_layer else "sequential"
    max_parallel_val = plan.max_parallel if plan.max_parallel is not None else -1

    return ResolvedPlan(
        project=plan.project,
        mode=mode,
        max_parallel=max_parallel_val,
        layers=resolved_layers,
        validation=validation,
        safety_issues=safety_issues,
        total_tasks=len(plan.tasks),
        quality=quality_config,
        quality_warnings=quality_warnings,
    )


def _check_quality_warnings(
    plan: TaskPlan,
    quality_config: QualityConfig,
) -> list[str]:
    """檢查品質相關警告"""
    warnings: list[str] = []

    if quality_config.verify:
        tasks_without_verify = [
            t.id
            for t in plan.tasks
            if not t.verify_command and not (t.test_levels and len(t.test_levels) > 0)
        ]
        if tasks_without_verify:
            warnings.append(
                f"以下 task 缺少 verify_command 或 test_levels: "
                f"{', '.join(tasks_without_verify)}"
            )

    if quality_config.judge_policy != "never":
        tasks_without_spec = [t.id for t in plan.tasks if not t.spec.strip()]
        if tasks_without_spec:
            warnings.append(
                f"以下 task 缺少 spec（Judge 需要 spec 進行審查）: "
                f"{', '.join(tasks_without_spec)}"
            )

    return warnings
