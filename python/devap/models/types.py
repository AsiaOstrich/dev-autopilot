"""
devap 核心型別定義

定義所有核心模型，包括 Task、TaskResult、AgentAdapter、ExecutionReport 等。
使用 Pydantic v2 進行資料驗證。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Awaitable, Callable, Literal, Optional

from pydantic import BaseModel, Field


# --- Enums / Literal Types ---

AgentType = Literal["claude", "opencode", "codex", "cline", "cursor", "cli"]
"""支援的 AI Agent 類型"""

TestLevelName = Literal["unit", "integration", "system", "e2e"]
"""多層級測試名稱"""

TaskStatus = Literal[
    "success",             # 正常完成
    "failed",              # 執行失敗
    "skipped",             # 依賴失敗跳過
    "timeout",             # 逾時
    "done_with_concerns",  # 完成但有疑慮（借鑑 Superpowers）
    "needs_context",       # 需要更多上下文（借鑑 Superpowers）
    "blocked",             # 無法完成，需升級處理（借鑑 Superpowers）
]
"""Task 執行狀態"""

ModelTier = Literal["fast", "standard", "capable"]
"""模型等級（借鑑 Superpowers 模型分級策略）"""

JudgePolicy = Literal["always", "on_change", "never"]
"""Judge 審查策略"""

JudgeReviewStage = Literal["spec", "quality"]
"""Judge 審查階段（借鑑 Superpowers 雙階段審查）"""

QualityProfileName = Literal["strict", "standard", "minimal", "none"]
"""Quality Profile 預設模板名稱"""

CheckpointPolicy = Literal["after_each_layer", "after_critical", "never"]
"""Checkpoint 策略"""

CheckpointAction = Literal["continue", "abort", "retry_layer"]
"""Checkpoint 動作"""

DebugPhase = Literal["root_cause", "pattern_analysis", "hypothesis", "fix"]
"""除錯階段"""


# --- Data Models ---


class TestLevel(BaseModel):
    """多層級測試定義"""

    name: TestLevelName
    command: str
    timeout_ms: int = 120_000


class CompletionCheck(BaseModel):
    """完成準則檢查項目"""

    name: str
    command: Optional[str] = None
    required: bool


class TestPolicy(BaseModel):
    """測試策略定義，連結 UDS test-governance 標準"""

    pyramid_ratio: Optional[dict[str, int]] = None
    completion_criteria: Optional[list[CompletionCheck]] = None
    static_analysis_command: Optional[str] = None


class TaskDefaults(BaseModel):
    """Task Plan 預設值"""

    max_turns: Optional[int] = None
    max_budget_usd: Optional[float] = None
    allowed_tools: Optional[list[str]] = None
    verify_command: Optional[str] = None
    test_levels: Optional[list[TestLevel]] = None


class Task(BaseModel):
    """單一任務定義，對應 specs/task-schema.json"""

    id: str = Field(pattern=r"^T-\d{3}$")
    title: str
    spec: str
    depends_on: list[str] = Field(default_factory=list)
    agent: Optional[AgentType] = None
    verify_command: Optional[str] = None
    max_turns: Optional[int] = None
    max_budget_usd: Optional[float] = None
    allowed_tools: Optional[list[str]] = None
    fork_session: Optional[bool] = None
    judge: Optional[bool] = None
    acceptance_criteria: Optional[list[str]] = None
    user_intent: Optional[str] = None
    test_levels: Optional[list[TestLevel]] = None
    model_tier: Optional[ModelTier] = None


class VerificationEvidence(BaseModel):
    """驗證證據（借鑑 Superpowers Iron Law: Evidence before claims）"""

    command: str
    exit_code: int
    output: str
    timestamp: str


class TaskResult(BaseModel):
    """單一任務的執行結果"""

    task_id: str
    session_id: Optional[str] = None
    status: TaskStatus = "failed"
    cost_usd: Optional[float] = None
    duration_ms: Optional[float] = None
    verification_passed: Optional[bool] = None
    error: Optional[str] = None
    retry_count: Optional[int] = None
    judge_verdict: Optional[Literal["APPROVE", "REJECT"]] = None
    retry_cost_usd: Optional[float] = None
    concerns: Optional[list[str]] = None
    needed_context: Optional[str] = None
    block_reason: Optional[str] = None
    verification_evidence: Optional[list[VerificationEvidence]] = None


class ExecuteOptions(BaseModel):
    """執行選項 — 傳給 AgentAdapter.execute_task 的參數"""

    cwd: str
    session_id: Optional[str] = None
    fork_session: Optional[bool] = None
    model_tier: Optional[ModelTier] = None


class QualityConfig(BaseModel):
    """品質設定（展開後的完整設定）"""

    verify: bool = False
    lint_command: Optional[str] = None
    type_check_command: Optional[str] = None
    judge_policy: JudgePolicy = "never"
    max_retries: int = 0
    max_retry_budget_usd: float = 0.0
    static_analysis_command: Optional[str] = None
    completion_criteria: Optional[list[CompletionCheck]] = None


class TaskPlan(BaseModel):
    """Task Plan — 完整的任務計畫"""

    project: str
    session_id: Optional[str] = None
    agent: Optional[AgentType] = None
    defaults: Optional[TaskDefaults] = None
    tasks: list[Task] = Field(min_length=1)
    max_parallel: Optional[int] = None
    quality: Optional[QualityProfileName | QualityConfig] = None
    test_policy: Optional[TestPolicy] = None


class ExecutionSummary(BaseModel):
    """執行報告摘要"""

    total_tasks: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    done_with_concerns: int = 0
    needs_context: int = 0
    blocked: int = 0
    total_cost_usd: float = 0.0
    total_duration_ms: float = 0.0


class QualityMetrics(BaseModel):
    """品質指標"""

    verification_pass_rate: float = 0.0
    judge_pass_rate: float = 1.0
    total_retries: int = 0
    total_retry_cost_usd: float = 0.0
    safety_issues_count: int = 0
    first_pass_rate: float = 0.0


class ExecutionReport(BaseModel):
    """完整的執行報告"""

    summary: ExecutionSummary
    tasks: list[TaskResult] = Field(default_factory=list)
    quality_metrics: Optional[QualityMetrics] = None


class FixLoopConfig(BaseModel):
    """Fix Loop 設定"""

    max_retries: int = 0
    max_retry_budget_usd: float = 0.0


class FixLoopAttempt(BaseModel):
    """Fix Loop 單次嘗試結果"""

    attempt: int
    success: bool
    cost_usd: float
    feedback: Optional[str] = None


class FixLoopResult(BaseModel):
    """Fix Loop 執行結果"""

    success: bool
    attempts: list[FixLoopAttempt] = Field(default_factory=list)
    total_retry_cost_usd: float = 0.0
    stop_reason: Literal["passed", "max_retries", "budget_exceeded"] = "max_retries"


class FixFeedback(BaseModel):
    """結構化除錯回饋（借鑑 Superpowers 四階段除錯法）"""

    error: str
    phase: DebugPhase
    previous_attempts: list[dict[str, str]] = Field(default_factory=list)
    instruction: str


class CheckpointSummary(BaseModel):
    """Checkpoint 摘要資料"""

    layer_index: int
    total_layers: int
    layer_results: list[TaskResult] = Field(default_factory=list)
    all_results: list[TaskResult] = Field(default_factory=list)


"""Safety Hook 回呼函式類型"""
SafetyHook = Callable[["Task"], bool]

"""Checkpoint 回呼函式類型"""
CheckpointCallback = Callable[["CheckpointSummary"], Awaitable[CheckpointAction]]


class ValidationResult(BaseModel):
    """Plan 驗證結果"""

    valid: bool = True
    errors: list[str] = Field(default_factory=list)


class ResolvedTask(Task):
    """已解析的單一任務（含生成的 prompt）"""

    generated_prompt: str = ""


class ResolvedLayer(BaseModel):
    """已解析的執行層"""

    index: int
    tasks: list[ResolvedTask] = Field(default_factory=list)


class ResolvedPlan(BaseModel):
    """已解析的執行計畫"""

    project: str
    mode: Literal["sequential", "parallel"] = "sequential"
    max_parallel: int = 1
    layers: list[ResolvedLayer] = Field(default_factory=list)
    validation: ValidationResult = Field(default_factory=ValidationResult)
    safety_issues: list[dict[str, str]] = Field(default_factory=list)
    total_tasks: int = 0
    quality: QualityConfig = Field(default_factory=QualityConfig)
    quality_warnings: list[str] = Field(default_factory=list)


# --- Abstract Base Class ---


class AgentAdapter(ABC):
    """
    Agent Adapter 抽象基類

    所有 AI agent adapter 必須繼承此類並實作介面。
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """agent 類型名稱"""
        ...

    @abstractmethod
    async def execute_task(
        self, task: Task, options: ExecuteOptions
    ) -> TaskResult:
        """執行單一任務"""
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """檢查此 agent 是否可用"""
        ...

    async def resume_session(self, session_id: str) -> None:
        """恢復指定 session（可選實作）"""
        pass
