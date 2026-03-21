"""quality_profile.py 測試"""

from devap.models.types import CompletionCheck, QualityConfig, TestPolicy
from devap.quality_profile import PROFILES, resolve_quality_profile


class TestResolveQualityProfile:
    def test_none_returns_none_profile(self) -> None:
        config = resolve_quality_profile(None)
        assert config.verify is False
        assert config.judge_policy == "never"

    def test_strict_profile(self) -> None:
        config = resolve_quality_profile("strict")
        assert config.verify is True
        assert config.judge_policy == "always"
        assert config.max_retries == 3

    def test_standard_profile(self) -> None:
        config = resolve_quality_profile("standard")
        assert config.verify is True
        assert config.judge_policy == "on_change"

    def test_minimal_profile(self) -> None:
        config = resolve_quality_profile("minimal")
        assert config.verify is True
        assert config.judge_policy == "never"

    def test_custom_config_passthrough(self) -> None:
        custom = QualityConfig(verify=True, judge_policy="always", max_retries=5)
        config = resolve_quality_profile(custom)
        assert config is custom
        assert config.max_retries == 5

    def test_unknown_profile_falls_back(self) -> None:
        config = resolve_quality_profile("nonexistent")  # type: ignore[arg-type]
        assert config.verify is False

    def test_returns_copy(self) -> None:
        """確保不修改原始 PROFILES"""
        config = resolve_quality_profile("strict")
        config.max_retries = 99
        assert PROFILES["strict"].max_retries == 3


class TestTestPolicyMerge:
    def test_merge_static_analysis(self) -> None:
        policy = TestPolicy(static_analysis_command="semgrep --config=auto")
        config = resolve_quality_profile("strict", test_policy=policy)
        assert config.static_analysis_command == "semgrep --config=auto"

    def test_merge_completion_criteria(self) -> None:
        policy = TestPolicy(
            completion_criteria=[
                CompletionCheck(name="coverage", command="pytest --cov", required=True),
            ]
        )
        config = resolve_quality_profile("standard", test_policy=policy)
        assert config.completion_criteria is not None
        assert len(config.completion_criteria) == 1
        assert config.completion_criteria[0].name == "coverage"

    def test_existing_static_analysis_not_overridden(self) -> None:
        custom = QualityConfig(
            verify=True,
            static_analysis_command="existing-tool",
        )
        policy = TestPolicy(static_analysis_command="semgrep")
        config = resolve_quality_profile(custom, test_policy=policy)
        assert config.static_analysis_command == "existing-tool"

    def test_existing_completion_criteria_not_overridden(self) -> None:
        existing_criteria = [CompletionCheck(name="existing", required=True)]
        custom = QualityConfig(
            verify=True,
            completion_criteria=existing_criteria,
        )
        policy = TestPolicy(
            completion_criteria=[
                CompletionCheck(name="from-policy", required=False),
            ]
        )
        config = resolve_quality_profile(custom, test_policy=policy)
        assert config.completion_criteria is not None
        assert len(config.completion_criteria) == 1
        assert config.completion_criteria[0].name == "existing"

    def test_no_test_policy(self) -> None:
        config = resolve_quality_profile("strict")
        assert config.static_analysis_command is None
        assert config.completion_criteria is None

    def test_empty_test_policy(self) -> None:
        policy = TestPolicy()
        config = resolve_quality_profile("strict", test_policy=policy)
        assert config.static_analysis_command is None
        assert config.completion_criteria is None
