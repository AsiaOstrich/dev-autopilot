"""vibeops_adapter.py 測試"""

from unittest.mock import patch

import pytest
from devap.adapters.vibeops_adapter import (
    VibeOpsAdapter,
    VibeOpsAdapterConfig,
    map_spec_to_agent,
)
from devap.models.types import ExecuteOptions, Task


def _make_task(**kwargs: object) -> Task:
    defaults = {"id": "T-001", "title": "Test", "spec": "實作用戶模型"}
    defaults.update(kwargs)  # type: ignore[arg-type]
    return Task(**defaults)  # type: ignore[arg-type]


def _make_adapter(**kwargs: object) -> VibeOpsAdapter:
    config = VibeOpsAdapterConfig(base_url="http://localhost:3360", **kwargs)  # type: ignore[arg-type]
    return VibeOpsAdapter(config)


# --- map_spec_to_agent ---


class TestMapSpecToAgent:
    def test_planner(self) -> None:
        assert map_spec_to_agent("分析需求文件") == "planner"
        assert map_spec_to_agent("撰寫 PRD") == "planner"

    def test_architect(self) -> None:
        assert map_spec_to_agent("設計系統架構") == "architect"
        assert map_spec_to_agent("建立 ADR 記錄") == "architect"

    def test_designer(self) -> None:
        assert map_spec_to_agent("撰寫 API 規格") == "designer"

    def test_uiux(self) -> None:
        assert map_spec_to_agent("調整 UI 元件") == "uiux"
        assert map_spec_to_agent("更新視覺風格") == "uiux"

    def test_builder(self) -> None:
        assert map_spec_to_agent("實作用戶模型") == "builder"
        assert map_spec_to_agent("implement auth") == "builder"

    def test_reviewer(self) -> None:
        assert map_spec_to_agent("審查程式碼品質") == "reviewer"
        assert map_spec_to_agent("code review") == "reviewer"

    def test_operator(self) -> None:
        assert map_spec_to_agent("部署到 staging") == "operator"
        assert map_spec_to_agent("deploy to prod") == "operator"

    def test_evaluator(self) -> None:
        assert map_spec_to_agent("評估系統效能") == "evaluator"
        assert map_spec_to_agent("收集度量") == "evaluator"

    def test_default_builder(self) -> None:
        assert map_spec_to_agent("do something generic") == "builder"

    def test_case_insensitive(self) -> None:
        assert map_spec_to_agent("IMPLEMENT feature") == "builder"
        assert map_spec_to_agent("Deploy to prod") == "operator"


# --- VibeOpsAdapter ---


class TestVibeOpsAdapterBasic:
    def test_name(self) -> None:
        adapter = _make_adapter()
        assert adapter.name == "vibeops"


class TestIsAvailable:
    @pytest.mark.asyncio
    async def test_available(self) -> None:
        adapter = _make_adapter()

        def mock_get(path: str) -> dict[str, object]:
            return {"status": "ok", "version": "1.0.0"}

        with patch.object(adapter, "_get", side_effect=mock_get):
            result = await adapter.is_available()
        assert result is True

    @pytest.mark.asyncio
    async def test_not_available(self) -> None:
        adapter = _make_adapter()

        with patch.object(adapter, "_get", side_effect=ConnectionError("refused")):
            result = await adapter.is_available()
        assert result is False

    @pytest.mark.asyncio
    async def test_error_status(self) -> None:
        adapter = _make_adapter()

        def mock_get(path: str) -> dict[str, object]:
            return {"status": "error"}

        with patch.object(adapter, "_get", side_effect=mock_get):
            result = await adapter.is_available()
        assert result is False


class TestExecuteTask:
    @pytest.mark.asyncio
    async def test_success(self) -> None:
        adapter = _make_adapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        def mock_post(path: str, body: dict[str, object]) -> dict[str, object]:
            return {
                "sessionId": "vibeops-sess-1",
                "status": "success",
                "costUsd": 0.5,
                "durationMs": 3000,
                "reviewerPassed": True,
            }

        with patch.object(adapter, "_post", side_effect=mock_post):
            result = await adapter.execute_task(task, options)

        assert result.status == "success"
        assert result.session_id == "vibeops-sess-1"
        assert result.cost_usd == 0.5
        assert result.verification_passed is True

    @pytest.mark.asyncio
    async def test_failure(self) -> None:
        adapter = _make_adapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        def mock_post(path: str, body: dict[str, object]) -> dict[str, object]:
            return {
                "sessionId": "vibeops-sess-2",
                "status": "failed",
                "costUsd": 0.3,
                "durationMs": 1000,
                "reviewerPassed": False,
                "result": "tests failed",
            }

        with patch.object(adapter, "_post", side_effect=mock_post):
            result = await adapter.execute_task(task, options)

        assert result.status == "failed"
        assert result.verification_passed is False
        assert result.error == "tests failed"

    @pytest.mark.asyncio
    async def test_connection_error(self) -> None:
        adapter = _make_adapter()
        task = _make_task()
        options = ExecuteOptions(cwd="/tmp")

        with patch.object(adapter, "_post", side_effect=ConnectionError("refused")):
            result = await adapter.execute_task(task, options)

        assert result.status == "failed"
        assert "refused" in (result.error or "")

    @pytest.mark.asyncio
    async def test_routes_correct_agent(self) -> None:
        adapter = _make_adapter()
        task = _make_task(spec="部署到 staging")
        options = ExecuteOptions(cwd="/tmp")
        captured_body: dict[str, object] = {}

        def mock_post(path: str, body: dict[str, object]) -> dict[str, object]:
            captured_body.update(body)
            return {
                "sessionId": "s1",
                "status": "success",
                "costUsd": 0,
                "durationMs": 100,
            }

        with patch.object(adapter, "_post", side_effect=mock_post):
            await adapter.execute_task(task, options)

        assert captured_body["agent"] == "operator"

    @pytest.mark.asyncio
    async def test_includes_api_token(self) -> None:
        adapter = _make_adapter(api_token="my-token")
        headers = adapter._build_headers()
        assert headers["Authorization"] == "Bearer my-token"

    @pytest.mark.asyncio
    async def test_no_api_token(self) -> None:
        adapter = _make_adapter()
        headers = adapter._build_headers()
        assert "Authorization" not in headers


class TestResumeSession:
    @pytest.mark.asyncio
    async def test_calls_resume_endpoint(self) -> None:
        adapter = _make_adapter()
        captured_path = ""
        captured_body: dict[str, object] = {}

        def mock_post(path: str, body: dict[str, object]) -> dict[str, object]:
            nonlocal captured_path
            captured_path = path
            captured_body.update(body)
            return {}

        with patch.object(adapter, "_post", side_effect=mock_post):
            await adapter.resume_session("sess-123")

        assert captured_path == "/api/pipeline/resume"
        assert captured_body["sessionId"] == "sess-123"
