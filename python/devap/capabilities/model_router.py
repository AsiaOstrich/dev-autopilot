"""
ModelRouter — XSPEC-027 Phase 3, DEC-032 D3

Pareto 加權最優模型選擇，TypeScript 版本的 Python 對應實作。
回傳 dict 表示的 RoutingResult（Python 風格，非 TypeScript discriminated union）。
"""
from __future__ import annotations

from typing import Any

from .types import ModelCandidate, ModelEntry, TaskProfile


def _pool_entry(pool: list[ModelEntry], model_id: str) -> ModelEntry:
    for m in pool:
        if m.model_id == model_id:
            return m
    raise ValueError(f"Model {model_id!r} not found in pool")


def route(pool: list[ModelEntry], task_profile: TaskProfile) -> dict[str, Any]:
    """
    根據模型池與任務需求，選出最優模型並回傳路由結果。

    回傳 dict：
      { 'status': 'SUPPORTED',   'model': ModelCandidate }
      { 'status': 'DEGRADED',    'model': ModelCandidate, 'degraded_capabilities': [...] }
      { 'status': 'UNSUPPORTED', 'required_capabilities': [...] }
    """
    # Step 1: 過濾 — 移除不支援或 score < 2 的模型
    candidates: list[ModelCandidate] = []

    for model in pool:
        meets_all = True
        for req in task_profile.required:
            cap = model.capabilities.get(req.capability)
            if cap is None or not cap.supported or cap.score < 2:
                meets_all = False
                break

        if meets_all:
            # 代表分數：所有必要能力中的最低分
            min_cap_score = (
                min(
                    model.capabilities[req.capability].score
                    for req in task_profile.required
                    if req.capability in model.capabilities
                )
                if task_profile.required
                else 3
            )
            candidates.append(
                ModelCandidate(
                    model_id=model.model_id,
                    capability_score=min_cap_score,
                    cost_per_1k_tokens=model.cost_per_1k_tokens,
                )
            )

    # 無候選 → UNSUPPORTED
    if not candidates:
        return {
            "status": "UNSUPPORTED",
            "required_capabilities": [r.capability for r in task_profile.required],
        }

    # Step 2: Pareto 加權
    pref = task_profile.cost_preference
    quality_weight = 0.3 if pref == "lowest" else (0.9 if pref == "quality" else 0.7)
    cost_weight = 1.0 - quality_weight

    for c in candidates:
        c.weighted_score = (
            quality_weight * c.capability_score
            + cost_weight * (1.0 / (c.cost_per_1k_tokens + 0.0001))
        )

    best = max(
        candidates,
        key=lambda c: (c.weighted_score, c.capability_score, -c.cost_per_1k_tokens),
    )

    # Step 3: SUPPORTED / DEGRADED
    best_pool_entry = _pool_entry(pool, best.model_id)
    degraded: list[str] = []
    for req in task_profile.required:
        cap = best_pool_entry.capabilities.get(req.capability)
        if cap is not None and cap.score < req.min_score:
            degraded.append(req.capability)

    if degraded:
        return {"status": "DEGRADED", "model": best, "degraded_capabilities": degraded}

    return {"status": "SUPPORTED", "model": best}
