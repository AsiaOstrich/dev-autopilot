"""
test_capability_registry.py — XSPEC-027 Phase 3 Python 雙版本測試

8 個測試，覆蓋 CapabilityRegistry 和 ModelRouter 核心功能。
"""
from devap.capabilities.capability_registry import CapabilityRegistry
from devap.capabilities.model_router import route
from devap.capabilities.types import (
    ModelCapabilityEntry,
    ModelEntry,
    ScoreUpdate,
    TaskProfile,
    TaskRequirement,
)


def make_model(
    model_id: str,
    caps: dict[str, int],
    cost_per_1k_tokens: float = 0.01,
) -> ModelEntry:
    return ModelEntry(
        model_id=model_id,
        capabilities={
            k: ModelCapabilityEntry(supported=v > 0, score=v) for k, v in caps.items()
        },
        cost_per_1k_tokens=cost_per_1k_tokens,
    )


class TestCapabilityRegistry:
    def test_1_resolve_registered_model(self):
        """1. resolve() 查到已登記模型的能力 → 回傳正確分數"""
        registry = CapabilityRegistry(initial_pool=[
            make_model("gpt-4o", {"modality.vision": 5}),
        ])

        result = registry.resolve("gpt-4o", "modality.vision")

        assert result.score == 5
        assert result.supported is True
        assert result.probed is False

    def test_2_resolve_unknown_model_triggers_probe(self):
        """2. resolve() 查無模型時觸發 probe → probed: True"""
        registry = CapabilityRegistry()

        result = registry.resolve("unknown-model", "modality.vision")

        assert result.probed is True

    def test_3_resolve_unknown_capability_triggers_probe(self):
        """3. resolve() 查無能力時觸發 probe → probed: True"""
        registry = CapabilityRegistry(initial_pool=[
            make_model("claude-3-5-sonnet", {"reasoning.code_reasoning": 5}),
        ])

        result = registry.resolve("claude-3-5-sonnet", "modality.vision")

        assert result.probed is True

    def test_4_update_score_then_resolve(self):
        """4. update_score() 更新後 resolve() 回傳新分數"""
        registry = CapabilityRegistry(initial_pool=[
            make_model("gpt-4o", {"modality.vision": 3}),
        ])

        registry.update_score(
            "gpt-4o",
            "modality.vision",
            ScoreUpdate(score=5, benchmark_ref="bench-001", date="2026-04-14"),
        )

        result = registry.resolve("gpt-4o", "modality.vision")
        assert result.score == 5
        assert result.probed is False

    def test_5_add_model_then_resolve(self):
        """5. add_model() 新增模型後可查詢"""
        registry = CapabilityRegistry()

        registry.add_model(make_model("gemini-1.5-pro", {"modality.vision": 4}))

        result = registry.resolve("gemini-1.5-pro", "modality.vision")
        assert result.score == 4
        assert result.probed is False

    def test_6_list_models(self):
        """6. list_models() 回傳所有已登記模型 id"""
        registry = CapabilityRegistry(initial_pool=[
            make_model("model-a", {"modality.vision": 4}),
            make_model("model-b", {"reasoning.code_reasoning": 3}),
        ])

        models = registry.list_models()
        assert "model-a" in models
        assert "model-b" in models
        assert len(models) == 2

    def test_7_probe_sync_valid_model_id(self):
        """7. _probe_sync() 合法模型 id 回傳 True"""
        registry = CapabilityRegistry()

        result = registry._probe_sync("gpt-4o", "modality.vision")

        assert result is True

    def test_8_probe_sync_empty_string(self):
        """8. _probe_sync() 空字串回傳 False"""
        registry = CapabilityRegistry()

        result = registry._probe_sync("", "modality.vision")

        assert result is False


class TestModelRouter:
    def test_supported_single_model(self):
        """route() SUPPORTED：單一模型符合所有需求"""
        pool = [make_model("gpt-4o", {"modality.vision": 5})]
        profile = TaskProfile(
            required=[TaskRequirement(capability="modality.vision", min_score=4)],
            cost_preference="balanced",
        )

        result = route(pool, profile)

        assert result["status"] == "SUPPORTED"
        assert result["model"].model_id == "gpt-4o"

    def test_unsupported_no_capable_model(self):
        """route() UNSUPPORTED：無模型支援所需能力"""
        pool = [make_model("gpt-4o", {"reasoning.code_reasoning": 4})]
        profile = TaskProfile(
            required=[TaskRequirement(capability="modality.vision", min_score=4)],
            cost_preference="balanced",
        )

        result = route(pool, profile)

        assert result["status"] == "UNSUPPORTED"
        assert "modality.vision" in result["required_capabilities"]

    def test_degraded_score_below_min_but_above_2(self):
        """route() DEGRADED：最優模型能力分數 < minScore 但 >= 2"""
        pool = [make_model("cheap-model", {"modality.vision": 2})]
        profile = TaskProfile(
            required=[TaskRequirement(capability="modality.vision", min_score=4)],
            cost_preference="balanced",
        )

        result = route(pool, profile)

        assert result["status"] == "DEGRADED"
        assert "modality.vision" in result["degraded_capabilities"]

    def test_empty_pool_returns_unsupported(self):
        """route() 空模型池回傳 UNSUPPORTED"""
        profile = TaskProfile(
            required=[TaskRequirement(capability="modality.vision", min_score=3)],
            cost_preference="balanced",
        )

        result = route([], profile)

        assert result["status"] == "UNSUPPORTED"
