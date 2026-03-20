"""models/types.py 的基礎測試"""

import pytest
from devap.models.types import (
    Task,
    TaskPlan,
    TaskResult,
    ExecuteOptions,
    QualityConfig,
    FixLoopConfig,
    VerificationEvidence,
    ExecutionSummary,
)


class TestTask:
    def test_basic_task(self):
        task = Task(id="T-001", title="Init", spec="Initialize project")
        assert task.id == "T-001"
        assert task.depends_on == []
        assert task.model_tier is None

    def test_task_with_all_fields(self):
        task = Task(
            id="T-002",
            title="Build",
            spec="Build the project",
            depends_on=["T-001"],
            agent="claude",
            model_tier="capable",
            acceptance_criteria=["通過測試"],
        )
        assert task.depends_on == ["T-001"]
        assert task.model_tier == "capable"

    def test_invalid_task_id(self):
        with pytest.raises(Exception):
            Task(id="invalid", title="X", spec="x")


class TestTaskPlan:
    def test_basic_plan(self):
        plan = TaskPlan(
            project="test",
            tasks=[Task(id="T-001", title="A", spec="a")],
        )
        assert plan.project == "test"
        assert len(plan.tasks) == 1

    def test_empty_tasks_rejected(self):
        with pytest.raises(Exception):
            TaskPlan(project="test", tasks=[])


class TestTaskResult:
    def test_success_result(self):
        result = TaskResult(task_id="T-001", status="success", cost_usd=0.5)
        assert result.status == "success"
        assert result.concerns is None

    def test_done_with_concerns(self):
        result = TaskResult(
            task_id="T-001",
            status="done_with_concerns",
            concerns=["效能未最佳化"],
        )
        assert result.concerns == ["效能未最佳化"]

    def test_blocked(self):
        result = TaskResult(
            task_id="T-001",
            status="blocked",
            block_reason="缺少權限",
        )
        assert result.block_reason == "缺少權限"


class TestVerificationEvidence:
    def test_evidence(self):
        ev = VerificationEvidence(
            command="pnpm test",
            exit_code=0,
            output="all passed",
            timestamp="2026-03-20T00:00:00Z",
        )
        assert ev.exit_code == 0


class TestExecutionSummary:
    def test_summary_with_superpowers_statuses(self):
        summary = ExecutionSummary(
            total_tasks=5,
            succeeded=2,
            failed=1,
            skipped=0,
            done_with_concerns=1,
            needs_context=0,
            blocked=1,
            total_cost_usd=1.5,
            total_duration_ms=5000,
        )
        assert summary.done_with_concerns == 1
        assert summary.blocked == 1
