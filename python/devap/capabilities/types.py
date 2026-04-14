"""
LCM 核心型別定義 — XSPEC-027 Phase 3 Python 版本

使用 Pydantic v2，對應 TypeScript 版 src/capabilities/types.ts。
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class ModelCapabilityEntry(BaseModel):
    """單一能力在特定模型上的登記資料"""

    supported: bool
    score: int  # 0-5（0 = 不支援）
    benchmark_ref: Optional[str] = None
    updated_at: Optional[str] = None


class ModelEntry(BaseModel):
    """模型池中的單一模型登記"""

    model_id: str
    capabilities: dict[str, ModelCapabilityEntry]
    cost_per_1k_tokens: float


class TaskRequirement(BaseModel):
    """任務對某能力的硬性需求"""

    capability: str
    min_score: int  # 最低可接受分數（1-5）


CostPreference = Literal["lowest", "balanced", "quality"]


class TaskProfile(BaseModel):
    """任務的能力需求配置"""

    required: list[TaskRequirement]
    cost_preference: CostPreference = "balanced"


class ModelCandidate(BaseModel):
    """ModelRouter 回傳的模型候選"""

    model_id: str
    capability_score: int
    cost_per_1k_tokens: float
    weighted_score: float = 0.0


class CapabilityResult(BaseModel):
    """能力查詢結果"""

    supported: bool
    score: int
    probed: bool = False


class ScoreUpdate(BaseModel):
    """評分更新請求"""

    score: int
    benchmark_ref: Optional[str] = None
    date: Optional[str] = None
