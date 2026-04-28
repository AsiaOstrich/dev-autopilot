"""orchestrator.py 測試"""

import pytest
from devap.models.types import (
    AgentAdapter,
    ExecuteOptions,
    Task,
    TaskDefaults,
    TaskPlan,
    TaskResult,
)
from devap.orchestrator import (
    merge_defaults,
    orchestrate,
    topological_layers,
    topological_sort,
)


class MockAdapter(AgentAdapter):
    """Mock adapter：所有 task 都成功"""

    def __init__(self, responses: dict[str, TaskResult] | None = None):
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
        )

    async def is_available(self) -> bool:
        return True


class TestTopologicalSort:
    def test_linear_deps(self):
        tasks = [
            Task(id="T-001", title="A", spec="a"),
            Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
            Task(id="T-003", title="C", spec="c", depends_on=["T-002"]),
        ]
        sorted_tasks = topological_sort(tasks)
        ids = [t.id for t in sorted_tasks]
        assert ids.index("T-001") < ids.index("T-002")
        assert ids.index("T-002") < ids.index("T-003")

    def test_no_deps(self):
        tasks = [
            Task(id="T-001", title="A", spec="a"),
            Task(id="T-002", title="B", spec="b"),
        ]
        result = topological_sort(tasks)
        assert len(result) == 2


class TestTopologicalLayers:
    def test_diamond_deps(self):
        tasks = [
            Task(id="T-001", title="Root", spec="r"),
            Task(id="T-002", title="Left", spec="l", depends_on=["T-001"]),
            Task(id="T-003", title="Right", spec="r", depends_on=["T-001"]),
            Task(id="T-004", title="Merge", spec="m", depends_on=["T-002", "T-003"]),
        ]
        layers = topological_layers(tasks)
        assert len(layers) == 3
        assert [t.id for t in layers[0]] == ["T-001"]
        assert sorted(t.id for t in layers[1]) == ["T-002", "T-003"]
        assert [t.id for t in layers[2]] == ["T-004"]


class TestMergeDefaults:
    def test_defaults_applied(self):
        plan = TaskPlan(
            project="test",
            defaults=TaskDefaults(max_turns=50, max_budget_usd=3.0),
            tasks=[Task(id="T-001", title="A", spec="a")],
        )
        merged = merge_defaults(plan.tasks[0], plan)
        assert merged.max_turns == 50
        assert merged.max_budget_usd == 3.0

    def test_task_overrides_defaults(self):
        plan = TaskPlan(
            project="test",
            defaults=TaskDefaults(max_turns=50),
            tasks=[Task(id="T-001", title="A", spec="a", max_turns=10)],
        )
        merged = merge_defaults(plan.tasks[0], plan)
        assert merged.max_turns == 10


@pytest.mark.asyncio
class TestOrchestrate:
    async def test_sequential_all_success(self):
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
            ],
        )
        report = await orchestrate(plan, MockAdapter(), "/tmp/test")
        assert report.summary.total_tasks == 2
        assert report.summary.succeeded == 2

    async def test_dependency_failure_skips(self):
        adapter = MockAdapter(responses={
            "T-001": TaskResult(task_id="T-001", status="failed", error="error"),
        })
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
            ],
        )
        report = await orchestrate(plan, adapter, "/tmp/test")
        assert report.summary.failed == 1
        assert report.summary.skipped == 1

    async def test_done_with_concerns_continues(self):
        adapter = MockAdapter(responses={
            "T-001": TaskResult(
                task_id="T-001",
                status="done_with_concerns",
                concerns=["效能"],
                cost_usd=0.5,
            ),
        })
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
            ],
        )
        report = await orchestrate(plan, adapter, "/tmp/test")
        assert report.summary.done_with_concerns == 1
        assert report.summary.succeeded == 1
        assert report.summary.skipped == 0

    async def test_parallel_mode(self):
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-002", title="B", spec="b"),
                Task(id="T-003", title="C", spec="c", depends_on=["T-001", "T-002"]),
            ],
        )
        report = await orchestrate(plan, MockAdapter(), "/tmp/test", parallel=True)
        assert report.summary.total_tasks == 3
        assert report.summary.succeeded == 3

    async def test_invalid_plan_raises(self):
        plan = TaskPlan(project="test", tasks=[
            Task(id="T-001", title="A", spec="a", depends_on=["T-002"]),
            Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
        ])
        with pytest.raises(ValueError, match="Plan 驗證失敗"):
            await orchestrate(plan, MockAdapter(), "/tmp/test")

    async def test_safety_hook_blocks(self):
        plan = TaskPlan(
            project="test",
            tasks=[Task(id="T-001", title="Danger", spec="rm -rf /")],
        )
        report = await orchestrate(
            plan, MockAdapter(), "/tmp/test",
            safety_hooks=[lambda t: False],
        )
        assert report.summary.failed == 1
        assert "safety hook" in (report.tasks[0].error or "")


class TestEpistemicRouting:
    """XSPEC-008 Phase 4: 認知路由測試"""

    @pytest.mark.asyncio
    async def test_needs_context_not_treated_as_failure(self):
        """needs_context 任務不因 log 訊息被誤判為失敗"""
        progress_messages: list[str] = []

        class AskAdapter(AgentAdapter):
            @property
            def name(self) -> str:
                return "claude"

            async def execute_task(self, task, opts):
                return TaskResult(
                    task_id=task.id,
                    status="needs_context",
                    needed_context="需要 API 規格",
                )

            async def is_available(self) -> bool:
                return True

        plan = TaskPlan(
            project="test",
            tasks=[Task(id="T-001", title="Ask Task", spec="test")],
        )
        report = await orchestrate(
            plan,
            AskAdapter(),
            cwd="/tmp",
            on_progress=progress_messages.append,
        )
        assert report.summary.needs_context == 1
        assert report.summary.failed == 0
        assert any("ask" in m.lower() or "需要更多資訊" in m for m in progress_messages)

    @pytest.mark.asyncio
    async def test_blocked_not_treated_as_failure(self):
        """blocked 任務不因 log 訊息被誤判為失敗"""
        progress_messages: list[str] = []

        class AbstainAdapter(AgentAdapter):
            @property
            def name(self) -> str:
                return "claude"

            async def execute_task(self, task, opts):
                return TaskResult(
                    task_id=task.id,
                    status="blocked",
                    block_reason="超出能力範圍",
                )

            async def is_available(self) -> bool:
                return True

        plan = TaskPlan(
            project="test",
            tasks=[Task(id="T-001", title="Abstain Task", spec="test")],
        )
        report = await orchestrate(
            plan,
            AbstainAdapter(),
            cwd="/tmp",
            on_progress=progress_messages.append,
        )
        assert report.summary.blocked == 1
        assert report.summary.failed == 0
        assert any("abstain" in m.lower() or "有意識" in m for m in progress_messages)
