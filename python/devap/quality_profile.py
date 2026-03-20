"""
Quality Profile — 品質預設模板

提供 strict / standard / minimal / none 四組預設品質設定。
"""

from __future__ import annotations

from devap.models.types import QualityConfig, QualityProfileName

PROFILES: dict[QualityProfileName, QualityConfig] = {
    "strict": QualityConfig(
        verify=True,
        judge_policy="always",
        max_retries=3,
        max_retry_budget_usd=5.0,
    ),
    "standard": QualityConfig(
        verify=True,
        judge_policy="on_change",
        max_retries=2,
        max_retry_budget_usd=3.0,
    ),
    "minimal": QualityConfig(
        verify=True,
        judge_policy="never",
        max_retries=1,
        max_retry_budget_usd=1.0,
    ),
    "none": QualityConfig(
        verify=False,
        judge_policy="never",
        max_retries=0,
        max_retry_budget_usd=0.0,
    ),
}


def resolve_quality_profile(
    quality: QualityProfileName | QualityConfig | None,
) -> QualityConfig:
    """
    解析品質設定

    Args:
        quality: profile 名稱或自訂 QualityConfig

    Returns:
        完整的 QualityConfig
    """
    if quality is None:
        return PROFILES["none"].model_copy()
    if isinstance(quality, QualityConfig):
        return quality
    if quality in PROFILES:
        return PROFILES[quality].model_copy()
    return PROFILES["none"].model_copy()
