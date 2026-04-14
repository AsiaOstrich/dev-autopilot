"""
CapabilityRegistry — XSPEC-027 Phase 3, DEC-031 D1/D2

TypeScript 版本的 Python 對應實作。
管理模型能力評分的在記憶體登記表。
resolve() 查無時自動觸發 Probe（AC-3.1）。
"""
from __future__ import annotations

from typing import Optional

from .types import CapabilityResult, ModelCapabilityEntry, ModelEntry, ScoreUpdate


class CapabilityRegistry:
    """管理模型能力評分的在記憶體登記表"""

    def __init__(self, initial_pool: Optional[list[ModelEntry]] = None):
        self._models: dict[str, ModelEntry] = {}
        if initial_pool:
            for entry in initial_pool:
                self._models[entry.model_id] = entry

    def resolve(self, model_id: str, capability: str) -> CapabilityResult:
        """
        查詢指定模型的能力評分。
        查無（模型或能力不存在）時自動觸發 probe（AC-3.1）。
        """
        entry = self._models.get(model_id)
        if entry is None or capability not in entry.capabilities:
            # 查無時自動探測
            probed = self._probe_sync(model_id, capability)
            cap = self._models.get(model_id, ModelEntry(
                model_id=model_id, capabilities={}, cost_per_1k_tokens=0.001
            )).capabilities.get(capability)
            return CapabilityResult(
                supported=cap.supported if cap else probed,
                score=cap.score if cap else (1 if probed else 0),
                probed=True,
            )

        cap = entry.capabilities[capability]
        return CapabilityResult(supported=cap.supported, score=cap.score, probed=False)

    def _probe_sync(self, model_id: str, capability: str) -> bool:
        """
        預設探測：模型 id 非空則視為支援（score=1，未評比）。
        可被子類別 override 做真實 API 探測。
        探測後將結果寫入內部 dict（相當於 TS 版的 probe()）。
        """
        supported = bool(model_id.strip())
        if model_id not in self._models:
            self._models[model_id] = ModelEntry(
                model_id=model_id,
                capabilities={},
                cost_per_1k_tokens=0.001,
            )
        self._models[model_id].capabilities[capability] = ModelCapabilityEntry(
            supported=supported,
            score=1 if supported else 0,
        )
        return supported

    def update_score(self, model_id: str, capability: str, update: ScoreUpdate) -> None:
        """更新指定模型+能力的評分"""
        if model_id not in self._models:
            self._models[model_id] = ModelEntry(
                model_id=model_id, capabilities={}, cost_per_1k_tokens=0.001
            )
        self._models[model_id].capabilities[capability] = ModelCapabilityEntry(
            supported=update.score > 0,
            score=update.score,
            benchmark_ref=update.benchmark_ref,
            updated_at=update.date,
        )

    def list_models(self) -> list[str]:
        """列出所有已登記的模型 id"""
        return list(self._models.keys())

    def get_model_entry(self, model_id: str) -> Optional[ModelEntry]:
        """取得模型登記資料"""
        return self._models.get(model_id)

    def add_model(self, entry: ModelEntry) -> None:
        """新增模型至登記表"""
        self._models[entry.model_id] = entry
