"""plan_validator.py 測試"""

from devap.models.types import Task, TaskPlan
from devap.plan_validator import validate_plan


class TestValidatePlan:
    def test_valid_linear_plan(self):
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
            ],
        )
        result = validate_plan(plan)
        assert result.valid is True
        assert result.errors == []

    def test_duplicate_task_id(self):
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-001", title="B", spec="b"),
            ],
        )
        result = validate_plan(plan)
        assert result.valid is False
        assert any("重複" in e for e in result.errors)

    def test_missing_dependency(self):
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a", depends_on=["T-999"]),
            ],
        )
        result = validate_plan(plan)
        assert result.valid is False
        assert any("不存在" in e for e in result.errors)

    def test_circular_dependency(self):
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a", depends_on=["T-002"]),
                Task(id="T-002", title="B", spec="b", depends_on=["T-001"]),
            ],
        )
        result = validate_plan(plan)
        assert result.valid is False
        assert any("環狀" in e for e in result.errors)

    def test_no_dependencies(self):
        plan = TaskPlan(
            project="test",
            tasks=[
                Task(id="T-001", title="A", spec="a"),
                Task(id="T-002", title="B", spec="b"),
                Task(id="T-003", title="C", spec="c"),
            ],
        )
        result = validate_plan(plan)
        assert result.valid is True
