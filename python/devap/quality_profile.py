"""
Quality Profile — 品質預設模板

提供 strict / standard / minimal / none 四組預設品質設定。
"""

from __future__ import annotations

from typing import Optional

from devap.models.types import QualityConfig, QualityProfileName, TestPolicy

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
    test_policy: Optional[TestPolicy] = None,
) -> QualityConfig:
    """
    解析品質設定

    將 profile 名稱展開為完整 QualityConfig，
    並合併 test_policy 的 static_analysis_command 和 completion_criteria。

    Args:
        quality: profile 名稱或自訂 QualityConfig
        test_policy: 測試策略（可選），會合併到 QualityConfig

    Returns:
        完整的 QualityConfig
    """
    if quality is None:
        config = PROFILES["none"].model_copy()
    elif isinstance(quality, QualityConfig):
        config = quality
    elif quality in PROFILES:
        config = PROFILES[quality].model_copy()
    else:
        config = PROFILES["none"].model_copy()

    # 合併 test_policy 到 QualityConfig（對齊 TS 端 quality-profile.ts）
    if test_policy is not None:
        if test_policy.static_analysis_command and not config.static_analysis_command:
            config.static_analysis_command = test_policy.static_analysis_command
        if test_policy.completion_criteria and not config.completion_criteria:
            config.completion_criteria = test_policy.completion_criteria

    return config
