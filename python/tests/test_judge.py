"""judge.py 測試"""

import json

from devap.judge import (
    build_judge_prompt,
    parse_judge_output,
    should_run_judge,
    _try_parse_judge_json,
)
from devap.models.types import Task, TaskResult


def _make_task(**kwargs: object) -> Task:
    defaults = {"id": "T-001", "title": "Test", "spec": "implement feature"}
    defaults.update(kwargs)  # type: ignore[arg-type]
    return Task(**defaults)  # type: ignore[arg-type]


def _make_result(**kwargs: object) -> TaskResult:
    defaults: dict[str, object] = {"task_id": "T-001", "status": "success", "duration_ms": 100}
    defaults.update(kwargs)
    return TaskResult(**defaults)  # type: ignore[arg-type]


# --- should_run_judge ---


class TestShouldRunJudge:
    """6 種策略組合"""

    def test_always_returns_true(self) -> None:
        assert should_run_judge("always", _make_task(), has_changes=False) is True

    def test_always_with_task_judge_false(self) -> None:
        assert should_run_judge("always", _make_task(judge=False), has_changes=True) is False

    def test_on_change_with_changes(self) -> None:
        assert should_run_judge("on_change", _make_task(), has_changes=True) is True

    def test_on_change_without_changes(self) -> None:
        assert should_run_judge("on_change", _make_task(), has_changes=False) is False

    def test_never_returns_false(self) -> None:
        assert should_run_judge("never", _make_task(), has_changes=True) is False

    def test_never_with_task_judge_true(self) -> None:
        assert should_run_judge("never", _make_task(judge=True), has_changes=True) is True


# --- build_judge_prompt ---


class TestBuildJudgePrompt:
    def test_basic_prompt(self) -> None:
        prompt = build_judge_prompt(
            _make_task(), _make_result(), "diff content", "verify output"
        )
        assert "T-001" in prompt
        assert "implement feature" in prompt
        assert "diff content" in prompt
        assert "verify output" in prompt

    def test_with_acceptance_criteria(self) -> None:
        task = _make_task(acceptance_criteria=["通過 lint", "覆蓋率 > 80%"])
        prompt = build_judge_prompt(task, _make_result(), "diff", "ok")
        assert "驗收條件" in prompt
        assert "通過 lint" in prompt
        assert "覆蓋率 > 80%" in prompt
        assert "criteria_results" in prompt

    def test_with_user_intent(self) -> None:
        task = _make_task(user_intent="改善效能")
        prompt = build_judge_prompt(task, _make_result(), "diff", "ok")
        assert "使用者意圖" in prompt
        assert "改善效能" in prompt
        assert "intent_assessment" in prompt

    def test_with_criteria_and_intent(self) -> None:
        task = _make_task(
            acceptance_criteria=["AC-1"],
            user_intent="fix bug",
        )
        prompt = build_judge_prompt(task, _make_result(), "diff", "ok")
        assert "驗收條件" in prompt
        assert "使用者意圖" in prompt

    def test_without_optional_fields(self) -> None:
        prompt = build_judge_prompt(_make_task(), _make_result(), "diff", "ok")
        assert "驗收條件" not in prompt
        assert "intent_assessment" not in prompt

    def test_spec_review_stage(self) -> None:
        prompt = build_judge_prompt(
            _make_task(), _make_result(), "diff", "ok", review_stage="spec"
        )
        assert "Spec Compliance" in prompt

    def test_quality_review_stage(self) -> None:
        prompt = build_judge_prompt(
            _make_task(), _make_result(), "diff", "ok", review_stage="quality"
        )
        assert "Code Quality" in prompt

    def test_no_verify_command(self) -> None:
        task = _make_task(verify_command=None)
        prompt = build_judge_prompt(task, _make_result(), "diff", "")
        # Should not crash, just omit verify section
        assert "T-001" in prompt

    def test_with_verify_command(self) -> None:
        task = _make_task(verify_command="pnpm test")
        prompt = build_judge_prompt(task, _make_result(), "diff", "all pass")
        assert "pnpm test" in prompt


# --- parse_judge_output ---


class TestParseJudgeOutput:
    def test_approve_json(self) -> None:
        cli_output = json.dumps({
            "result": json.dumps({"verdict": "APPROVE", "reasoning": "looks good"}),
            "session_id": "s1",
            "cost_usd": 0.1,
        })
        result = parse_judge_output(cli_output)
        assert result.verdict == "APPROVE"
        assert result.reasoning == "looks good"
        assert result.session_id == "s1"
        assert result.cost_usd == 0.1

    def test_reject_json(self) -> None:
        cli_output = json.dumps({
            "result": json.dumps({"verdict": "REJECT", "reasoning": "missing tests"}),
            "session_id": "s2",
        })
        result = parse_judge_output(cli_output)
        assert result.verdict == "REJECT"

    def test_with_criteria_results(self) -> None:
        verdict = {
            "verdict": "APPROVE",
            "reasoning": "ok",
            "criteria_results": [
                {"criteria": "AC-1", "passed": True, "reasoning": "done"},
                {"criteria": "AC-2", "passed": False, "reasoning": "partial"},
            ],
        }
        cli_output = json.dumps({"result": json.dumps(verdict), "session_id": "s3"})
        result = parse_judge_output(cli_output)
        assert result.criteria_results is not None
        assert len(result.criteria_results) == 2
        assert result.criteria_results[0].passed is True
        assert result.criteria_results[1].passed is False

    def test_with_intent_assessment(self) -> None:
        verdict = {
            "verdict": "APPROVE",
            "reasoning": "ok",
            "intent_assessment": "意圖達成",
        }
        cli_output = json.dumps({"result": json.dumps(verdict), "session_id": "s4"})
        result = parse_judge_output(cli_output)
        assert result.intent_assessment == "意圖達成"

    def test_text_with_reject_keyword(self) -> None:
        cli_output = json.dumps({
            "result": "This should be REJECT because of issues.",
            "session_id": "s5",
        })
        result = parse_judge_output(cli_output)
        assert result.verdict == "REJECT"

    def test_text_without_reject_defaults_approve(self) -> None:
        cli_output = json.dumps({
            "result": "Everything seems fine.",
            "session_id": "s6",
        })
        result = parse_judge_output(cli_output)
        assert result.verdict == "APPROVE"

    def test_empty_result(self) -> None:
        cli_output = json.dumps({"result": "", "session_id": "s7"})
        result = parse_judge_output(cli_output)
        assert result.verdict == "APPROVE"
        assert "預設通過" in result.reasoning


# --- _try_parse_judge_json ---


class TestTryParseJudgeJson:
    def test_direct_json(self) -> None:
        text = json.dumps({"verdict": "APPROVE", "reasoning": "ok"})
        result = _try_parse_judge_json(text)
        assert result is not None
        assert result["verdict"] == "APPROVE"

    def test_json_in_code_block(self) -> None:
        text = 'Some text\n```json\n{"verdict": "REJECT", "reasoning": "bad"}\n```\nMore text'
        result = _try_parse_judge_json(text)
        assert result is not None
        assert result["verdict"] == "REJECT"

    def test_json_embedded_in_text(self) -> None:
        text = 'Here is my verdict: {"verdict": "APPROVE", "reasoning": "done"} end.'
        result = _try_parse_judge_json(text)
        assert result is not None
        assert result["verdict"] == "APPROVE"

    def test_no_json(self) -> None:
        result = _try_parse_judge_json("No JSON here at all")
        assert result is None

    def test_invalid_json(self) -> None:
        result = _try_parse_judge_json("{invalid json}")
        assert result is None

    def test_json_without_verdict(self) -> None:
        result = _try_parse_judge_json('{"foo": "bar"}')
        assert result is None

    def test_nested_json_with_criteria(self) -> None:
        verdict = {
            "verdict": "APPROVE",
            "reasoning": "ok",
            "criteria_results": [{"criteria": "AC-1", "passed": True, "reasoning": "done"}],
        }
        text = f"```json\n{json.dumps(verdict)}\n```"
        result = _try_parse_judge_json(text)
        assert result is not None
        assert isinstance(result["criteria_results"], list)
