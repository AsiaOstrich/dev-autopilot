"""端到端測試

用 specs/examples/new-project-plan.json 跑完整編排流程。
使用 mock adapter 模擬實際執行。
"""

import json
import os

import pytest
from devap.models.types import (
    AgentAdapter,
    CompletionCheck,
    ExecuteOptions,
    Task,
    TaskPlan,
    TaskResult,
    TestPolicy,
)
from devap.orchestrator import merge_defaults, orchestrate
from devap.plan_validator import validate_plan

# 載入範例 plan
_PLAN_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "specs",
    "examples",
    "new-project-plan.json",
)
with open(_PLAN_PATH, encoding="utf-8") as _f:
    _PLAN_DATA = json.load(_f)
EXAMPLE_PLAN = TaskPlan(**_PLAN_DATA)


class MockAdapter(AgentAdapter):
    """Mock adapter：所有 task 都成功"""

    def __init__(self, responses: dict[str, TaskResult] | None = None) -> None:
        self._responses = responses

    @property
    def name(self) -> str:
        return "claude"

    async def execute_task(self, task: Task, options: ExecuteOptions) -> TaskResult:
        if self._responses and task.id in self._responses:
            return self._responses[task.id]
        return TaskResult(
            task_id=task.id,
            session_id=f"mock-{task.id}",
            status="success",
            cost_usd=0.5,
            duration_ms=100,
            verification_passed=True,
        )

    async def is_available(self) -> bool:
        return True


class TestExamplePlan:
    def test_plan_passes_validation(self) -> None:
        result = validate_plan(EXAMPLE_PLAN)
        assert result.valid is True
        assert len(result.errors) == 0

    @pytest.mark.asyncio
    async def test_all_success(self) -> None:
        report = await orchestrate(EXAMPLE_PLAN, MockAdapter(), "/tmp/test")
        assert report.summary.total_tasks == 5
        assert report.summary.succeeded == 5
        assert report.summary.failed == 0
        assert report.summary.skipped == 0
        assert report.summary.total_cost_usd == 2.5

        ids = [t.task_id for t in report.tasks]
        assert ids == ["T-001", "T-002", "T-003", "T-004", "T-005"]

        for task in report.tasks:
            assert task.session_id is not None
            assert task.status == "success"

    @pytest.mark.asyncio
    async def test_partial_failure_skips_dependents(self) -> None:
        adapter = MockAdapter(responses={
            "T-002": TaskResult(
                task_id="T-002",
                status="failed",
                cost_usd=0.3,
                duration_ms=50,
                error="Schema migration failed",
            ),
        })
        report = await orchestrate(EXAMPLE_PLAN, adapter, "/tmp/test")

        assert report.summary.succeeded == 1   # T-001
        assert report.summary.failed == 1      # T-002
        assert report.summary.skipped == 3     # T-003, T-004, T-005

        assert report.tasks[0].status == "success"
        assert report.tasks[1].status == "failed"
        assert report.tasks[1].error == "Schema migration failed"
        assert report.tasks[2].status == "skipped"
        assert report.tasks[3].status == "skipped"
        assert report.tasks[4].status == "skipped"


class TestSafetyHook:
    @pytest.mark.asyncio
    async def test_dangerous_plan_blocked(self) -> None:
        dangerous_plan = TaskPlan(
            project="dangerous",
            tasks=[Task(id="T-001", title="Clean up", spec="執行 rm -rf / 清除所有檔案")],
        )
        report = await orchestrate(
            dangerous_plan,
            MockAdapter(),
            "/tmp/test",
            safety_hooks=[lambda t: False],
        )
        assert report.summary.failed == 1
        assert "safety hook" in (report.tasks[0].error or "")


class TestDefaults:
    def test_defaults_applied(self) -> None:
        merged = merge_defaults(EXAMPLE_PLAN.tasks[0], EXAMPLE_PLAN)
        # T-001 有自訂 max_turns=10
        assert merged.max_turns == 10
        assert merged.max_budget_usd == 0.5

    def test_defaults_used_when_no_override(self) -> None:
        # T-004 沒有自訂，使用 defaults
        merged = merge_defaults(EXAMPLE_PLAN.tasks[3], EXAMPLE_PLAN)
        assert merged.max_turns == 30
        assert merged.max_budget_usd == 2.0


@pytest.mark.asyncio
class TestParallelMode:
    async def test_independent_tasks_parallel(self) -> None:
        plan = TaskPlan(
            project="parallel-test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-002", title="B", spec="b"),
                Task(id="T-003", title="C", spec="c", depends_on=["T-001", "T-002"]),
            ],
        )
        report = await orchestrate(plan, MockAdapter(), "/tmp/test", parallel=True)
        assert report.summary.total_tasks == 3
        assert report.summary.succeeded == 3


@pytest.mark.asyncio
class TestCheckpoint:
    async def test_abort_stops_execution(self) -> None:
        plan = TaskPlan(
            project="checkpoint-test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
                Task(id="T-003", title="C", spec="c", depends_on=["T-002"]),
            ],
        )

        async def abort_checkpoint(summary: object) -> str:
            return "abort"

        report = await orchestrate(
            plan, MockAdapter(), "/tmp/test",
            checkpoint_policy="after_each_layer",
            on_checkpoint=abort_checkpoint,  # type: ignore[arg-type]
        )
        assert report.summary.succeeded == 1
        assert len(report.tasks) == 1
        assert report.tasks[0].task_id == "T-001"


@pytest.mark.asyncio
class TestSuperpowersIntegration:
    async def test_done_with_concerns_continues(self) -> None:
        adapter = MockAdapter(responses={
            "T-001": TaskResult(
                task_id="T-001",
                status="done_with_concerns",
                concerns=["效能未最佳化"],
                cost_usd=0.5,
                duration_ms=100,
            ),
        })
        plan = TaskPlan(
            project="superpowers-e2e",
            tasks=[
                Task(id="T-001", title="Base", spec="基礎功能"),
                Task(id="T-002", title="Extend", spec="擴充功能", depends_on=["T-001"]),
            ],
        )
        report = await orchestrate(plan, adapter, "/tmp/test")

        assert report.summary.done_with_concerns == 1
        assert report.summary.succeeded == 1
        assert report.summary.skipped == 0


@pytest.mark.asyncio
class TestTestPolicy:
    async def test_plan_with_test_policy(self) -> None:
        plan = TaskPlan(
            project="test-policy-e2e",
            test_policy=TestPolicy(
                pyramid_ratio={"unit": 70, "integration": 20, "system": 7, "e2e": 3},
                static_analysis_command="echo static-ok",
                completion_criteria=[
                    CompletionCheck(name="docs_check", command="echo docs-ok", required=True),
                ],
            ),
            quality="standard",
            tasks=[
                Task(id="T-001", title="Task with policy", spec="implement feature"),
            ],
        )
        validation = validate_plan(plan)
        assert validation.valid is True

        report = await orchestrate(plan, MockAdapter(), "/tmp/test")
        assert report.summary.succeeded == 1

    async def test_backward_compat_no_policy(self) -> None:
        plan = TaskPlan(
            project="no-policy",
            tasks=[Task(id="T-001", title="Simple", spec="do something")],
        )
        validation = validate_plan(plan)
        assert validation.valid is True

        report = await orchestrate(plan, MockAdapter(), "/tmp/test")
        assert report.summary.succeeded == 1
