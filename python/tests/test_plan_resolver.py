"""plan_resolver.py 測試"""

import pytest
from devap.models.types import (
    Task,
    TaskPlan,
)
from devap.plan_resolver import resolve_plan, PlanResolverOptions


def _make_plan(**kwargs: object) -> TaskPlan:
    defaults = {
        "project": "test",
        "tasks": [Task(id="T-001", title="A", spec="do something")],
    }
    defaults.update(kwargs)  # type: ignore[arg-type]
    return TaskPlan(**defaults)  # type: ignore[arg-type]


class TestNormalPlan:
    @pytest.mark.asyncio
    async def test_basic_resolve(self) -> None:
        plan = _make_plan()
        resolved = await resolve_plan(plan)
        assert resolved.project == "test"
        assert resolved.total_tasks == 1
        assert resolved.validation.valid is True
        assert len(resolved.layers) == 1
        assert len(resolved.layers[0].tasks) == 1
        assert resolved.layers[0].tasks[0].id == "T-001"

    @pytest.mark.asyncio
    async def test_generated_prompt_present(self) -> None:
        plan = _make_plan()
        resolved = await resolve_plan(plan)
        prompt = resolved.layers[0].tasks[0].generated_prompt
        assert "T-001" in prompt
        assert "do something" in prompt

    @pytest.mark.asyncio
    async def test_multi_layer(self) -> None:
        plan = _make_plan(tasks=[
            Task(id="T-001", title="A", spec="a"),
            Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
        ])
        resolved = await resolve_plan(plan)
        assert len(resolved.layers) == 2
        assert resolved.layers[0].tasks[0].id == "T-001"
        assert resolved.layers[1].tasks[0].id == "T-002"


class TestValidationFailure:
    @pytest.mark.asyncio
    async def test_cycle_detected(self) -> None:
        plan = _make_plan(tasks=[
            Task(id="T-001", title="A", spec="a", depends_on=["T-002"]),
            Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
        ])
        resolved = await resolve_plan(plan)
        assert resolved.validation.valid is False
        assert len(resolved.validation.errors) > 0
        assert len(resolved.layers) == 0

    @pytest.mark.asyncio
    async def test_missing_dep(self) -> None:
        plan = _make_plan(tasks=[
            Task(id="T-001", title="A", spec="a", depends_on=["T-999"]),
        ])
        resolved = await resolve_plan(plan)
        assert resolved.validation.valid is False


class TestSafetyIssues:
    @pytest.mark.asyncio
    async def test_dangerous_spec(self) -> None:
        plan = _make_plan(tasks=[
            Task(id="T-001", title="Danger", spec="run rm -rf / to clean up"),
        ])
        resolved = await resolve_plan(plan)
        assert len(resolved.safety_issues) > 0
        assert resolved.safety_issues[0]["task_id"] == "T-001"

    @pytest.mark.asyncio
    async def test_dangerous_verify_command(self) -> None:
        plan = _make_plan(tasks=[
            Task(
                id="T-001", title="A", spec="do stuff",
                verify_command="git push --force origin main",
            ),
        ])
        resolved = await resolve_plan(plan)
        assert any("T-001" in issue["task_id"] for issue in resolved.safety_issues)


class TestQualityWarnings:
    @pytest.mark.asyncio
    async def test_missing_verify_command_warning(self) -> None:
        plan = _make_plan(
            quality="strict",
            tasks=[Task(id="T-001", title="A", spec="a")],
        )
        resolved = await resolve_plan(plan)
        assert len(resolved.quality_warnings) > 0
        assert "verify_command" in resolved.quality_warnings[0]

    @pytest.mark.asyncio
    async def test_no_warning_with_verify(self) -> None:
        plan = _make_plan(
            quality="strict",
            tasks=[Task(id="T-001", title="A", spec="a", verify_command="pnpm test")],
        )
        resolved = await resolve_plan(plan)
        assert len(resolved.quality_warnings) == 0


class TestParallelMode:
    @pytest.mark.asyncio
    async def test_sequential_mode(self) -> None:
        plan = _make_plan(tasks=[
            Task(id="T-001", title="A", spec="a"),
            Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
        ])
        resolved = await resolve_plan(plan)
        assert resolved.mode == "sequential"

    @pytest.mark.asyncio
    async def test_parallel_mode(self) -> None:
        plan = _make_plan(tasks=[
            Task(id="T-001", title="A", spec="a"),
            Task(id="T-002", title="B", spec="b"),
            Task(id="T-003", title="C", spec="c", depends_on=["T-001", "T-002"]),
        ])
        resolved = await resolve_plan(plan)
        assert resolved.mode == "parallel"


class TestResolverOptions:
    @pytest.mark.asyncio
    async def test_with_extra_constraints(self) -> None:
        plan = _make_plan()
        options = PlanResolverOptions(extra_constraints=["不要動 README"])
        resolved = await resolve_plan(plan, options)
        prompt = resolved.layers[0].tasks[0].generated_prompt
        assert "不要動 README" in prompt


class TestQualityProfile:
    @pytest.mark.asyncio
    async def test_strict_profile(self) -> None:
        plan = _make_plan(quality="strict")
        resolved = await resolve_plan(plan)
        assert resolved.quality.verify is True
        assert resolved.quality.judge_policy == "always"

    @pytest.mark.asyncio
    async def test_none_profile(self) -> None:
        plan = _make_plan(quality="none")
        resolved = await resolve_plan(plan)
        assert resolved.quality.verify is False

    @pytest.mark.asyncio
    async def test_default_quality(self) -> None:
        plan = _make_plan()
        resolved = await resolve_plan(plan)
        assert resolved.quality.verify is False
