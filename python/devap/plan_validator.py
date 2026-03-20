"""
Plan Validator — TaskPlan 驗證

驗證 TaskPlan 結構合法性：
- 至少一個 task
- Task ID 格式正確且唯一
- 依賴存在且無環狀依賴
"""

from __future__ import annotations

from devap.models.types import TaskPlan, ValidationResult


def validate_plan(plan: TaskPlan) -> ValidationResult:
    """
    驗證 TaskPlan 是否合法

    Args:
        plan: 要驗證的任務計畫

    Returns:
        驗證結果，包含是否通過與錯誤訊息
    """
    errors: list[str] = []

    # 1. 至少一個 task
    if not plan.tasks:
        errors.append("tasks 不可為空")
        return ValidationResult(valid=False, errors=errors)

    # 2. Task ID 唯一性
    ids = [t.id for t in plan.tasks]
    seen: set[str] = set()
    for task_id in ids:
        if task_id in seen:
            errors.append(f"重複的 task ID: {task_id}")
        seen.add(task_id)

    # 3. 依賴存在性
    id_set = set(ids)
    for task in plan.tasks:
        for dep in task.depends_on:
            if dep not in id_set:
                errors.append(f"Task {task.id} 依賴不存在的 {dep}")

    # 4. 無環狀依賴（DFS）
    if not errors:
        cycle = _detect_cycle(plan)
        if cycle:
            errors.append(f"環狀依賴: {' → '.join(cycle)}")

    return ValidationResult(valid=len(errors) == 0, errors=errors)


def _detect_cycle(plan: TaskPlan) -> list[str] | None:
    """使用 DFS 偵測環狀依賴"""
    adj: dict[str, list[str]] = {t.id: list(t.depends_on) for t in plan.tasks}
    white, gray, black = 0, 1, 2
    color: dict[str, int] = {t.id: white for t in plan.tasks}
    parent: dict[str, str | None] = {t.id: None for t in plan.tasks}

    def dfs(node: str) -> str | None:
        color[node] = gray
        for neighbor in adj.get(node, []):
            if color.get(neighbor) == gray:
                return neighbor
            if color.get(neighbor) == white:
                parent[neighbor] = node
                result = dfs(neighbor)
                if result is not None:
                    return result
        color[node] = black
        return None

    for task_id in adj:
        if color[task_id] == white:
            cycle_node = dfs(task_id)
            if cycle_node is not None:
                # 重建環路徑
                path = [cycle_node]
                current = parent.get(cycle_node)
                while current and current != cycle_node:
                    path.append(current)
                    current = parent.get(current)
                path.append(cycle_node)
                path.reverse()
                return path

    return None
