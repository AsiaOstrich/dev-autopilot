"""
Orchestrator — DAG 任務編排引擎

讀取 TaskPlan，解析拓撲排序與分層，依序/並行派發 task，產出 ExecutionReport。
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from typing import Callable, Optional

from devap.hooks.safety_hook import SafetyHook
from devap.models.types import (
    AgentAdapter,
    CheckpointCallback,
    CheckpointPolicy,
    CheckpointSummary,
    ExecuteOptions,
    ExecutionReport,
    ExecutionSummary,
    QualityConfig,
    QualityMetrics,
    Task,
    TaskPlan,
    TaskResult,
)
from devap.plan_validator import validate_plan


def topological_sort(tasks: list[Task]) -> list[Task]:
    """
    拓撲排序

    Args:
        tasks: 任務列表

    Returns:
        排序後的任務列表
    """
    in_degree: dict[str, int] = {t.id: 0 for t in tasks}
    adj: dict[str, list[str]] = defaultdict(list)
    task_map = {t.id: t for t in tasks}

    for t in tasks:
        for dep in t.depends_on:
            adj[dep].append(t.id)
            in_degree[t.id] += 1

    queue: deque[str] = deque(tid for tid, deg in in_degree.items() if deg == 0)
    result: list[Task] = []

    while queue:
        tid = queue.popleft()
        result.append(task_map[tid])
        for neighbor in adj[tid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    return result


def topological_layers(tasks: list[Task]) -> list[list[Task]]:
    """
    拓撲分層 — 同層 tasks 可並行執行

    Args:
        tasks: 任務列表

    Returns:
        分層後的任務列表
    """
    in_degree: dict[str, int] = {t.id: 0 for t in tasks}
    adj: dict[str, list[str]] = defaultdict(list)
    task_map = {t.id: t for t in tasks}

    for t in tasks:
        for dep in t.depends_on:
            adj[dep].append(t.id)
            in_degree[t.id] += 1

    queue: deque[str] = deque(tid for tid, deg in in_degree.items() if deg == 0)
    layers: list[list[Task]] = []

    while queue:
        layer: list[Task] = []
        next_queue: deque[str] = deque()
        while queue:
            tid = queue.popleft()
            layer.append(task_map[tid])
            for neighbor in adj[tid]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    next_queue.append(neighbor)
        layers.append(layer)
        queue = next_queue

    return layers


def merge_defaults(task: Task, plan: TaskPlan) -> Task:
    """合併 plan defaults 到 task（task 層級值優先）"""
    if not plan.defaults:
        return task

    data = task.model_dump(exclude_unset=True)
    defaults = plan.defaults.model_dump(exclude_none=True)

    for key, value in defaults.items():
        if key not in data:
            data[key] = value

    # 保留原始 id、title、spec（必填欄位）
    data["id"] = task.id
    data["title"] = task.title
    data["spec"] = task.spec
    data["depends_on"] = task.depends_on

    return Task(**data)


async def orchestrate(
    plan: TaskPlan,
    adapter: AgentAdapter,
    cwd: str,
    *,
    session_id: Optional[str] = None,
    on_progress: Optional[Callable[[str], None]] = None,
    safety_hooks: Optional[list[SafetyHook]] = None,
    parallel: bool = False,
    max_parallel: Optional[int] = None,
    quality_config: Optional[QualityConfig] = None,
    checkpoint_policy: CheckpointPolicy = "never",
    on_checkpoint: Optional[CheckpointCallback] = None,
) -> ExecutionReport:
    """
    編排執行 TaskPlan

    Args:
        plan: 任務計畫
        adapter: AI Agent Adapter
        cwd: 工作目錄
        session_id: 規劃階段的 session ID
        on_progress: 進度回呼
        safety_hooks: 安全 hook 列表
        parallel: 是否啟用並行模式
        max_parallel: 最大並行任務數
        quality_config: 品質設定
        checkpoint_policy: Checkpoint 策略
        on_checkpoint: Checkpoint 回呼

    Returns:
        完整的執行報告
    """
    # 1. 驗證 plan
    validation = validate_plan(plan)
    if not validation.valid:
        raise ValueError(f"Plan 驗證失敗：{'; '.join(validation.errors)}")

    start_time = time.monotonic()

    # 2. 執行
    if parallel:
        results = await _orchestrate_parallel(
            plan, adapter, cwd, session_id, on_progress, safety_hooks,
            max_parallel, quality_config, checkpoint_policy, on_checkpoint,
        )
    else:
        results = await _orchestrate_sequential(
            plan, adapter, cwd, session_id, on_progress, safety_hooks,
            quality_config, checkpoint_policy, on_checkpoint,
        )

    total_duration_ms = (time.monotonic() - start_time) * 1000
    return _build_report(results, total_duration_ms, quality_config)


async def _orchestrate_sequential(
    plan: TaskPlan,
    adapter: AgentAdapter,
    cwd: str,
    session_id: Optional[str],
    on_progress: Optional[Callable[[str], None]],
    safety_hooks: Optional[list[SafetyHook]],
    quality_config: Optional[QualityConfig],
    checkpoint_policy: CheckpointPolicy,
    on_checkpoint: Optional[CheckpointCallback],
) -> list[TaskResult]:
    """序列執行"""
    sorted_tasks = topological_sort(plan.tasks)
    results: list[TaskResult] = []
    completed: dict[str, TaskResult] = {}

    for i, raw_task in enumerate(sorted_tasks):
        task = merge_defaults(raw_task, plan)
        result = await _execute_one_task(
            task, adapter, cwd, session_id, on_progress, safety_hooks,
            completed, quality_config,
        )
        results.append(result)
        completed[task.id] = result

        # Checkpoint
        if (
            checkpoint_policy == "after_each_layer"
            and on_checkpoint
            and i < len(sorted_tasks) - 1
        ):
            action = await on_checkpoint(CheckpointSummary(
                layer_index=i,
                total_layers=len(sorted_tasks),
                layer_results=[result],
                all_results=list(results),
            ))
            if action == "abort":
                break

    return results


async def _orchestrate_parallel(
    plan: TaskPlan,
    adapter: AgentAdapter,
    cwd: str,
    session_id: Optional[str],
    on_progress: Optional[Callable[[str], None]],
    safety_hooks: Optional[list[SafetyHook]],
    max_parallel: Optional[int],
    quality_config: Optional[QualityConfig],
    checkpoint_policy: CheckpointPolicy,
    on_checkpoint: Optional[CheckpointCallback],
) -> list[TaskResult]:
    """並行分層執行"""
    layers = topological_layers(plan.tasks)
    results: list[TaskResult] = []
    completed: dict[str, TaskResult] = {}
    effective_max_parallel = max_parallel or plan.max_parallel or 5

    for layer_idx, layer in enumerate(layers):
        merged_tasks = [merge_defaults(t, plan) for t in layer]

        # 批次並行
        for batch_start in range(0, len(merged_tasks), effective_max_parallel):
            batch = merged_tasks[batch_start:batch_start + effective_max_parallel]
            batch_results = await asyncio.gather(*(
                _execute_one_task(
                    task, adapter, cwd, session_id, on_progress,
                    safety_hooks, completed, quality_config,
                )
                for task in batch
            ))
            results.extend(batch_results)
            for task, result in zip(batch, batch_results):
                completed[task.id] = result

        # Checkpoint
        if (
            checkpoint_policy == "after_each_layer"
            and on_checkpoint
            and layer_idx < len(layers) - 1
        ):
            layer_results = results[-len(layer):]
            action = await on_checkpoint(CheckpointSummary(
                layer_index=layer_idx,
                total_layers=len(layers),
                layer_results=layer_results,
                all_results=list(results),
            ))
            if action == "abort":
                break

    return results


async def _execute_one_task(
    task: Task,
    adapter: AgentAdapter,
    cwd: str,
    session_id: Optional[str],
    on_progress: Optional[Callable[[str], None]],
    safety_hooks: Optional[list[SafetyHook]],
    completed: dict[str, TaskResult],
    quality_config: Optional[QualityConfig],
) -> TaskResult:
    """執行單一任務"""
    start_time = time.monotonic()

    # 檢查依賴（done_with_concerns 視為可繼續）
    deps_failed = any(
        completed.get(dep) is not None
        and completed[dep].status not in ("success", "done_with_concerns")
        for dep in task.depends_on
    )
    if deps_failed:
        on_progress and on_progress(f"[{task.id}] 跳過：依賴任務失敗")
        return TaskResult(task_id=task.id, status="skipped")

    # Safety hooks
    if safety_hooks:
        for hook in safety_hooks:
            if not hook(task):
                on_progress and on_progress(
                    f"[{task.id}] 被 safety hook 攔截"
                )
                return TaskResult(
                    task_id=task.id,
                    status="failed",
                    error="Task 被 safety hook 攔截",
                )

    on_progress and on_progress(f"[{task.id}] 開始執行：{task.title}")

    try:
        exec_opts = ExecuteOptions(
            cwd=cwd,
            session_id=session_id,
            fork_session=task.fork_session,
            model_tier=task.model_tier,
        )
        result = await adapter.execute_task(task, exec_opts)
        result.duration_ms = result.duration_ms or (
            (time.monotonic() - start_time) * 1000
        )
        on_progress and on_progress(f"[{task.id}] 完成：{result.status}")
        return result
    except Exception as e:
        duration_ms = (time.monotonic() - start_time) * 1000
        return TaskResult(
            task_id=task.id,
            status="failed",
            error=str(e),
            duration_ms=duration_ms,
        )


def _build_report(
    results: list[TaskResult],
    total_duration_ms: float,
    quality_config: Optional[QualityConfig],
) -> ExecutionReport:
    """建構執行報告"""
    summary = ExecutionSummary(
        total_tasks=len(results),
        succeeded=sum(1 for r in results if r.status == "success"),
        failed=sum(1 for r in results if r.status == "failed"),
        skipped=sum(1 for r in results if r.status == "skipped"),
        done_with_concerns=sum(1 for r in results if r.status == "done_with_concerns"),
        needs_context=sum(1 for r in results if r.status == "needs_context"),
        blocked=sum(1 for r in results if r.status == "blocked"),
        total_cost_usd=sum(r.cost_usd or 0 for r in results),
        total_duration_ms=total_duration_ms,
    )

    # 品質指標
    quality_metrics: Optional[QualityMetrics] = None
    if quality_config and (quality_config.verify or quality_config.judge_policy != "never"):
        completed = [r for r in results if r.status != "skipped"]
        total = len(completed)
        if total > 0:
            quality_metrics = QualityMetrics(
                verification_pass_rate=sum(
                    1 for r in completed if r.status in ("success", "done_with_concerns")
                ) / total,
                total_retries=sum(r.retry_count or 0 for r in completed),
                total_retry_cost_usd=sum(r.retry_cost_usd or 0 for r in completed),
                first_pass_rate=sum(
                    1 for r in completed
                    if r.status in ("success", "done_with_concerns")
                    and (r.retry_count or 0) == 0
                ) / total,
            )

    return ExecutionReport(
        summary=summary,
        tasks=results,
        quality_metrics=quality_metrics,
    )
