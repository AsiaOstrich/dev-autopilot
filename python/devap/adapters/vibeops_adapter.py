"""
VibeOps Adapter

透過 HTTP REST API 整合 VibeOps 7+1 agents。
所有通訊透過 REST API，不 import VibeOps 程式碼，確保 MIT 授權隔離。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Literal, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

from devap.models.types import (
    AgentAdapter,
    ExecuteOptions,
    Task,
    TaskResult,
    TaskStatus,
)


# --- Types ---

VibeOpsAgentName = Literal[
    "planner",
    "architect",
    "designer",
    "uiux",
    "builder",
    "reviewer",
    "operator",
    "evaluator",
]
"""VibeOps 7+1 Agent 名稱"""


@dataclass
class VibeOpsAdapterConfig:
    """VibeOps Adapter 設定"""

    base_url: str
    api_token: Optional[str] = None
    skip_checkpoints: bool = False
    stop_after: Optional[VibeOpsAgentName] = None


# --- Agent Mapper ---

_MAPPING_RULES: list[tuple[list[str], VibeOpsAgentName]] = [
    (["需求", "prd", "requirement"], "planner"),
    (["架構", "adr", "architecture"], "architect"),
    (["規格", "設計", "design", "specification"], "designer"),
    (["ui", "視覺", "ux", "介面"], "uiux"),
    (["實作", "開發", "implement", "build", "develop"], "builder"),
    (["審查", "review", "code review"], "reviewer"),
    (["部署", "deploy", "release", "ci/cd"], "operator"),
    (["評估", "度量", "evaluate", "metric"], "evaluator"),
]


def map_spec_to_agent(spec: str) -> VibeOpsAgentName:
    """
    從 task spec 推斷對應的 VibeOps agent

    Args:
        spec: 任務規格描述

    Returns:
        匹配的 VibeOps agent 名稱，預設為 "builder"
    """
    lower = spec.lower()
    for keywords, agent in _MAPPING_RULES:
        for keyword in keywords:
            if keyword in lower:
                return agent
    return "builder"


# --- Adapter ---


class VibeOpsAdapter(AgentAdapter):
    """
    VibeOps Adapter — 讓 DevAP 編排 VibeOps 7+1 agents

    透過 HTTP REST API 通訊，零 VibeOps 程式碼 import，確保 MIT 授權隔離。
    """

    def __init__(self, config: VibeOpsAdapterConfig) -> None:
        self._config = config

    @property
    def name(self) -> str:
        """agent 類型名稱"""
        return "vibeops"

    async def execute_task(
        self, task: Task, options: ExecuteOptions
    ) -> TaskResult:
        """
        執行單一任務

        根據 task.spec 推斷對應的 VibeOps agent，
        透過 REST API 提交並等待結果。
        """
        start_time = time.monotonic()

        try:
            agent = map_spec_to_agent(task.spec)
            body: dict[str, Any] = {
                "agent": agent,
                "spec": task.spec,
                "taskId": task.id,
                "sessionId": options.session_id,
            }

            if self._config.skip_checkpoints or self._config.stop_after:
                body["pipelineOptions"] = {
                    "skipCheckpoints": self._config.skip_checkpoints,
                    "stopAfter": self._config.stop_after,
                }

            raw_data = self._post("/api/task/execute", body)
            data: dict[str, Any] = dict(raw_data)

            status: TaskStatus = data.get("status", "failed")
            session_id = data.get("sessionId")
            reviewer_passed = data.get("reviewerPassed")

            return TaskResult(
                task_id=task.id,
                session_id=str(session_id) if session_id else None,
                status=status,
                cost_usd=float(data.get("costUsd", 0)),
                duration_ms=float(data.get("durationMs", 0)),
                verification_passed=(
                    bool(reviewer_passed) if reviewer_passed is not None
                    else (status == "success")
                ),
                error=str(data.get("result")) if status != "success" else None,
            )

        except Exception as e:
            return TaskResult(
                task_id=task.id,
                status="failed",
                duration_ms=(time.monotonic() - start_time) * 1000,
                error=str(e),
            )

    async def is_available(self) -> bool:
        """
        檢查 VibeOps 服務是否可用

        透過 GET /api/health 端點確認。
        """
        try:
            data = self._get("/api/health")
            return data.get("status") == "ok"
        except Exception:
            return False

    async def resume_session(self, session_id: str) -> None:
        """恢復先前暫停的 pipeline session"""
        self._post("/api/pipeline/resume", {"sessionId": session_id})

    # --- HTTP Helpers ---

    def _build_headers(self) -> dict[str, str]:
        """構建 HTTP 請求標頭"""
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._config.api_token:
            headers["Authorization"] = f"Bearer {self._config.api_token}"
        return headers

    def _get(self, path: str) -> dict[str, object]:
        """發送 GET 請求"""
        url = f"{self._config.base_url}{path}"
        req = Request(url, headers=self._build_headers(), method="GET")
        try:
            with urlopen(req, timeout=5) as resp:
                return json.loads(resp.read().decode())  # type: ignore[no-any-return]
        except (URLError, OSError) as e:
            raise ConnectionError(f"無法連線至 VibeOps: {e}") from e

    def _post(self, path: str, body: dict[str, object]) -> dict[str, object]:
        """發送 POST 請求"""
        url = f"{self._config.base_url}{path}"
        data = json.dumps(body).encode()
        req = Request(url, data=data, headers=self._build_headers(), method="POST")
        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())  # type: ignore[no-any-return]
        except (URLError, OSError) as e:
            raise ConnectionError(f"VibeOps API 呼叫失敗: {e}") from e
