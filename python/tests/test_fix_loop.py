"""fix_loop.py 測試"""

import pytest
from devap.models.types import FixLoopConfig
from devap.fix_loop import ExecuteResult, build_structured_feedback, run_fix_loop


@pytest.mark.asyncio
class TestRunFixLoop:
    async def test_first_pass_no_retry(self):
        async def execute(feedback, attempt):
            return ExecuteResult(success=True, cost_usd=0.5)

        result = await run_fix_loop(
            FixLoopConfig(max_retries=2, max_retry_budget_usd=2.0),
            execute,
        )
        assert result.success is True
        assert len(result.attempts) == 1
        assert result.stop_reason == "passed"

    async def test_retry_then_success(self):
        call_count = 0

        async def execute(feedback, attempt):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return ExecuteResult(success=False, cost_usd=0.5, feedback="error")
            return ExecuteResult(success=True, cost_usd=0.3)

        result = await run_fix_loop(
            FixLoopConfig(max_retries=2, max_retry_budget_usd=2.0),
            execute,
        )
        assert result.success is True
        assert len(result.attempts) == 2
        assert result.stop_reason == "passed"

    async def test_max_retries_exceeded(self):
        async def execute(feedback, attempt):
            return ExecuteResult(success=False, cost_usd=0.3, feedback="still failing")

        result = await run_fix_loop(
            FixLoopConfig(max_retries=2, max_retry_budget_usd=10.0),
            execute,
        )
        assert result.success is False
        assert len(result.attempts) == 3  # 1 initial + 2 retries
        assert result.stop_reason == "max_retries"

    async def test_budget_exceeded(self):
        async def execute(feedback, attempt):
            return ExecuteResult(success=False, cost_usd=0.8, feedback="expensive")

        result = await run_fix_loop(
            FixLoopConfig(max_retries=5, max_retry_budget_usd=1.0),
            execute,
        )
        assert result.success is False
        assert result.stop_reason == "budget_exceeded"

    async def test_structured_feedback_injected(self):
        feedbacks = []
        call_count = 0

        async def execute(feedback, attempt):
            nonlocal call_count
            feedbacks.append(feedback)
            call_count += 1
            if call_count < 3:
                return ExecuteResult(success=False, cost_usd=0.1, feedback=f"error-{call_count}")
            return ExecuteResult(success=True, cost_usd=0.1)

        await run_fix_loop(
            FixLoopConfig(max_retries=5, max_retry_budget_usd=10.0),
            execute,
        )

        assert feedbacks[0] is None  # 首次無 feedback
        assert "Root Cause Investigation" in feedbacks[1]
        assert "Pattern Analysis" in feedbacks[2]


class TestBuildStructuredFeedback:
    def test_root_cause_phase(self):
        fb = build_structured_feedback("error", 1, [])
        assert "Root Cause Investigation" in fb

    def test_pattern_analysis_phase(self):
        fb = build_structured_feedback("error", 2, [{"hypothesis": "a1", "result": "failed"}])
        assert "Pattern Analysis" in fb

    def test_3_strike_rule(self):
        fb = build_structured_feedback(
            "error", 3,
            [{"hypothesis": "a1", "result": "f1"}, {"hypothesis": "a2", "result": "f2"}],
        )
        assert "3-Strike Rule" in fb
        assert "停止猜測性修復" in fb
