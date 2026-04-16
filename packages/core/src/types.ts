/**
 * devap 核心型別定義
 *
 * 定義所有核心介面，包括 Task、TaskResult、AgentAdapter、ExecutionReport 等。
 * 參考：docs/research/feasibility-and-design.md 第 6 節
 */

/**
 * 支援的 AI Agent 類型
 *
 * 注意：VibeOps adapter 使用 `"vibeops" as AgentType` 進行型別轉換，
 * 因為 VibeOps 是外部產品（AGPL-3.0），不直接加入此 union type。
 * 未來若需正式支援，可擴充此 union。
 */
export type AgentType = "claude" | "opencode" | "codex" | "cline" | "cursor" | "cli";

/** 多層級測試名稱 */
export type TestLevelName = "unit" | "integration" | "system" | "e2e";

/**
 * 多層級測試定義
 *
 * 取代單一 verify_command，支援依序執行多個測試層級。
 */
export interface TestLevel {
  /** 測試層級名稱 */
  name: TestLevelName;
  /** 執行指令 */
  command: string;
  /** 逾時時間（毫秒），預設 120000 */
  timeout_ms?: number;
}

/**
 * 完成準則檢查項目
 *
 * 對應 ISO 29119 Test Completion Criteria / Agile DoD。
 */
export interface CompletionCheck {
  /** 檢查項目名稱 */
  name: string;
  /** 執行指令（有 command → 自動驗證；無 → 由 Judge 審查） */
  command?: string;
  /** 是否為必要檢查（required: true 的失敗即停） */
  required: boolean;
}

/**
 * 測試策略定義
 *
 * 連結 UDS test-governance 標準。
 */
export interface TestPolicy {
  /** 金字塔推薦比例（加總應為 100，為經驗值非強制） */
  pyramid_ratio?: { unit: number; integration: number; system: number; e2e: number };
  /** 完成準則（ISO 29119 Test Completion Criteria / Agile DoD） */
  completion_criteria?: CompletionCheck[];
  /** 靜態分析指令 */
  static_analysis_command?: string;
}

/** 比較運算子（用於 ActivationPredicate threshold 類型） */
export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==";

/**
 * 動態激活條件（Activation Predicate）
 *
 * 除了 depends_on 的靜態依賴外，可定義動態條件。
 * 前置任務全部完成後，還需滿足此條件才會執行。
 * 若不滿足，任務狀態設為 skipped 並記錄原因。
 *
 * 來源：DEC-011 Stigmergy — Activation Predicates (arXiv:2604.03997)
 */
export interface ActivationPredicate {
  /** 條件類型 */
  type: "threshold" | "state_flag" | "custom";

  /** threshold 類型：檢查前置任務的度量值 */
  metric?: string;
  operator?: ComparisonOperator;
  value?: number;

  /** state_flag 類型：檢查特定任務的狀態 */
  taskId?: string;
  expectedStatus?: TaskStatus;

  /** custom 類型：shell 指令回傳 0 = 滿足 */
  command?: string;

  /** 人類可讀的條件說明（必填） */
  description: string;
}

/**
 * 失敗來源分類（XSPEC-045）
 *
 * 補充 TaskStatus（what happened）的「why it failed」維度。
 * 每類對應不同的恢復策略，供 Recovery Recipe Registry（XSPEC-046）匹配。
 */
export type FailureSource =
  | "prompt_delivery"     // API 4xx / 空回應 / 格式解析失敗
  | "model_degradation"   // LLM 降智 / 重複輸出 / 品質驟降
  | "branch_divergence"   // 工作分支落後基底分支（XSPEC-047）
  | "compilation"         // tsc / build exit code != 0
  | "test_failure"        // test 指令 exit code != 0
  | "tool_failure"        // MCP / Plugin / CLI 工具失敗
  | "policy_violation"    // Guardian / SafetyHook deny
  | "resource_exhaustion" // token / budget / timeout 超限

/**
 * 結構化失敗細節（XSPEC-045）
 */
export interface FailureDetail {
  readonly source: FailureSource;
  readonly raw_error: string;
  /** 偵測到失敗的元件名稱（quality-gate / claude-adapter / safety-hook / branch-drift） */
  readonly detected_by: string;
  readonly timestamp: string;
}

/**
 * 恢復策略列舉（XSPEC-046）
 */
export type RecoveryStrategy =
  | "fix_loop"
  | "circuit_breaker"
  | "rebase_and_retry"
  | "model_switch"
  | "degraded_mode"
  | "human_checkpoint";

/**
 * 恢復食譜（XSPEC-046）
 */
export interface RecoveryRecipe {
  readonly id: string;
  readonly name: string;
  readonly match: {
    readonly failureSource: FailureSource;
    readonly severity?: ReadonlyArray<"critical" | "high" | "medium" | "low">;
  };
  readonly strategy: RecoveryStrategy;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly escalation: {
    readonly onExhaust: RecoveryStrategy;
    readonly message?: string;
  };
}

/** Task 執行狀態 */
export type TaskStatus =
  | "success"            // 正常完成
  | "failed"             // 執行失敗
  | "skipped"            // 依賴失敗跳過
  | "timeout"            // 逾時
  | "done_with_concerns" // 完成但有疑慮（借鑑 Superpowers DONE_WITH_CONCERNS）
  | "needs_context"      // 需要更多上下文（借鑑 Superpowers NEEDS_CONTEXT）
  | "blocked"            // 無法完成，需升級處理（借鑑 Superpowers BLOCKED）
  | "cancelled";         // 被 AbortSignal 取消（XSPEC-048）

/**
 * 單一任務定義
 *
 * 對應 specs/task-schema.json 中的 task 格式。
 * Task ID 格式：T-NNN（如 T-001）。
 */
export interface Task {
  /** 任務 ID，格式 T-NNN */
  readonly id: string;
  /** 任務標題 */
  readonly title: string;
  /** 任務規格說明（spec） */
  readonly spec: string;
  /** 依賴的前置任務 ID 列表 */
  readonly depends_on?: ReadonlyArray<string>;
  /** 指定執行此任務的 agent */
  readonly agent?: AgentType;
  /** 任務完成後的驗證指令 */
  readonly verify_command?: string;
  /** 最大回合數 */
  readonly max_turns?: number;
  /** 最大預算（美元） */
  readonly max_budget_usd?: number;
  /** 允許使用的工具列表 */
  readonly allowed_tools?: ReadonlyArray<string>;
  /** 是否 fork session 執行（隔離 context） */
  readonly fork_session?: boolean;
  /** 是否啟用 Judge Agent 審查此任務的結果 */
  readonly judge?: boolean;
  /** 驗收條件列表，每條是一個可觀察的驗收標準 */
  readonly acceptance_criteria?: ReadonlyArray<string>;
  /** 使用者意圖：為什麼需要這個功能 */
  readonly user_intent?: string;
  /** 多層級測試定義（優先於 verify_command） */
  readonly test_levels?: ReadonlyArray<TestLevel>;
  /** 建議模型等級（借鑑 Superpowers 模型分級策略） */
  readonly model_tier?: ModelTier;
  /** 規格品質評分（由 UDS checklist scoring 提供，optional） */
  readonly spec_score?: number;
  /** 規格品質滿分（Standard mode = 10, Boost mode = 25） */
  readonly spec_max_score?: number;
  /**
   * 動態激活條件（Activation Predicate）
   *
   * 除了 depends_on 的靜態依賴外，可定義動態條件。
   * 前置任務全部完成後，還需滿足此條件才會執行。
   * 若不滿足，任務狀態設為 skipped 並記錄原因。
   *
   * 來源：DEC-011 Stigmergy — Activation Predicates
   */
  readonly activationPredicate?: ActivationPredicate;
}

/**
 * Task Plan 預設值
 *
 * 當 task 未指定時使用的預設參數。
 */
export interface TaskDefaults {
  /** 預設最大回合數 */
  max_turns?: number;
  /** 預設最大預算（美元） */
  max_budget_usd?: number;
  /** 預設允許使用的工具列表 */
  allowed_tools?: string[];
  /** 預設驗證指令 */
  verify_command?: string;
  /** 預設多層級測試定義 */
  test_levels?: TestLevel[];
}

/**
 * Task Plan — 完整的任務計畫
 *
 * 對應 specs/task-schema.json 的頂層結構。
 */
export interface TaskPlan {
  /** 專案名稱或路徑 */
  project: string;
  /** 規劃階段的 session ID（可選） */
  session_id?: string;
  /** 預設使用的 agent */
  agent?: AgentType;
  /** 任務預設值 */
  defaults?: TaskDefaults;
  /** 任務列表（至少一個） */
  tasks: Task[];
  /** 最大並行任務數 */
  max_parallel?: number;
  /** 品質設定：profile 名稱或自訂 QualityConfig */
  quality?: QualityProfileName | Partial<QualityConfig>;
  /** 測試策略定義（連結 UDS test-governance） */
  test_policy?: TestPolicy;
  /** 整個 plan 的總預算上限（美元），超過即停止執行剩餘 tasks */
  max_total_budget_usd?: number;
  /** 執行歷史配置（opt-in，SPEC-008） */
  execution_history?: import("./execution-history/types.js").ExecutionHistoryConfig;
}

/**
 * 單一任務的執行結果
 */
export interface TaskResult {
  /** 任務 ID */
  readonly task_id: string;
  /** 執行時使用的 session ID */
  readonly session_id?: string;
  /** 執行狀態 */
  readonly status: TaskStatus;
  /** 消耗的成本（美元） */
  readonly cost_usd?: number;
  /** 執行耗時（毫秒） */
  readonly duration_ms?: number;
  /** 驗證指令是否通過 */
  readonly verification_passed?: boolean;
  /** 錯誤訊息（失敗時） */
  readonly error?: string;
  /** 失敗來源分類（XSPEC-045，optional，不破壞現有程式碼） */
  readonly failureSource?: FailureSource;
  /** 結構化失敗細節（XSPEC-045，optional） */
  readonly failureDetail?: FailureDetail;
  /** 重試次數（0 = 首次即成功） */
  readonly retry_count?: number;
  /** Judge 審查判決 */
  readonly judge_verdict?: "APPROVE" | "REJECT";
  /** 重試總成本（美元） */
  readonly retry_cost_usd?: number;
  /** 疑慮說明（status 為 done_with_concerns 時） */
  readonly concerns?: ReadonlyArray<string>;
  /** 需要的額外上下文（status 為 needs_context 時） */
  readonly needed_context?: string;
  /** 阻塞原因（status 為 blocked 時） */
  readonly block_reason?: string;
  /** 驗證證據（借鑑 Superpowers Iron Law：Evidence before claims） */
  readonly verification_evidence?: ReadonlyArray<VerificationEvidence>;
  /** 執行度量（供 activationPredicate threshold 類型讀取，DEC-011） */
  readonly metrics?: Record<string, number>;
  /** 取消原因（status 為 cancelled 時，對應 AbortSignal.reason，XSPEC-048） */
  readonly cancellation_reason?: string;
}

/**
 * 執行選項 — 傳給 AgentAdapter.executeTask 的參數
 */
export interface ExecuteOptions {
  /** 工作目錄 */
  readonly cwd: string;
  /** 要接續的 session ID */
  readonly sessionId?: string;
  /** 是否 fork session */
  readonly forkSession?: boolean;
  /** 進度回呼 */
  readonly onProgress?: (message: string) => void;
  /** 模型等級建議（adapter 可據此選擇不同 model endpoint） */
  readonly modelTier?: ModelTier;
  /** 品質設定（由 Orchestrator 傳入，adapter 用於生成 hooks） */
  readonly qualityConfig?: QualityConfig;
  /**
   * 取消訊號（XSPEC-048）
   *
   * 傳入 Web 標準 AbortSignal，adapter 在執行前/中若偵測到 abort 則立即
   * 停止執行並回傳 { status: "cancelled", cancellation_reason }。
   *
   * 使用範例：
   *   const ctrl = new AbortController()
   *   setTimeout(() => ctrl.abort("timeout_30s"), 30_000)
   *   adapter.executeTask(task, { ...opts, signal: ctrl.signal })
   */
  readonly signal?: AbortSignal;
}

/**
 * 執行報告摘要
 */
export interface ExecutionSummary {
  /** 總任務數 */
  total_tasks: number;
  /** 成功數 */
  succeeded: number;
  /** 失敗數 */
  failed: number;
  /** 跳過數 */
  skipped: number;
  /** 有疑慮完成數 */
  done_with_concerns: number;
  /** 需要上下文數 */
  needs_context: number;
  /** 被阻塞數 */
  blocked: number;
  /** 被取消數（XSPEC-048） */
  cancelled: number;
  /** 總成本（美元） */
  total_cost_usd: number;
  /** 總耗時（毫秒） */
  total_duration_ms: number;
}

/**
 * 品質指標
 *
 * 彙整所有 task 的品質相關統計。
 */
export interface QualityMetrics {
  /** 驗證通過率（0-1） */
  verification_pass_rate: number;
  /** Judge 審查通過率（0-1，若無 judge 則為 1） */
  judge_pass_rate: number;
  /** 總重試次數 */
  total_retries: number;
  /** 總重試成本（美元） */
  total_retry_cost_usd: number;
  /** 安全問題數 */
  safety_issues_count: number;
  /** 首次通過率（0-1，無需重試即成功的比率） */
  first_pass_rate: number;
}

/**
 * 完整的執行報告
 *
 * 編排器執行完所有任務後產出的報告。
 */
/**
 * 標準效果回饋（UDS SPEC-SELFDIAG-001）
 *
 * 記錄每次執行中 UDS 標準的引用與遵循情況，
 * 回饋給 UDS 用於分析標準有效性。
 */
export interface StandardEffectiveness {
  /** 標準 ID（如 'testing', 'commit-message'） */
  standard_id: string;
  /** 標準版本 */
  version?: string;
  /** 應用此標準的 agent */
  applied_by_agent?: string;
  /** 效果評估 */
  effectiveness: {
    /** 是否在執行中被引用/載入 */
    was_referenced: boolean;
    /** 輸出是否符合標準 */
    was_followed: boolean;
    /** 違規次數 */
    violation_count?: number;
    /** 是否回報摩擦 */
    friction_reported?: boolean;
    /** 摩擦詳情 */
    friction_detail?: string;
  };
}

/**
 * 單一 standard 的 harness hook 統計（SPEC-010）
 */
export interface HarnessHookStandardStats {
  /** 標準 ID（如 'testing', 'commit-message'） */
  standard_id: string;
  /** 該標準的 hook 執行次數 */
  executions: number;
  /** 通過次數 */
  pass_count: number;
  /** 失敗次數 */
  fail_count: number;
  /** 通過率（0-1） */
  pass_rate: number;
  /** 平均執行時間（毫秒） */
  avg_duration_ms: number;
}

/**
 * Harness hook telemetry 彙總資料（SPEC-010）
 *
 * 從 .standards/telemetry.jsonl 解析並彙整。
 */
export interface HarnessHookData {
  /** hook 總執行次數 */
  total_executions: number;
  /** 通過次數 */
  pass_count: number;
  /** 失敗次數 */
  fail_count: number;
  /** 通過率（0-1） */
  pass_rate: number;
  /** 平均執行時間（毫秒） */
  avg_duration_ms: number;
  /** 按 standard_id 分群的統計 */
  by_standard: HarnessHookStandardStats[];
}

/**
 * 標準效果報告（UDS SPEC-SELFDIAG-001 schema v1.0.0）
 */
export interface StandardsEffectivenessReport {
  /** Schema 版本 */
  schema_version: "1.0.0";
  /** 來源 */
  source: "devap" | "vibeops" | "manual";
  /** 時間戳 */
  timestamp: string;
  /** 專案類型 */
  project_type?: "web-api" | "cli" | "library" | "web-app" | "mobile" | "other";
  /** 應用的標準列表 */
  standards_applied: StandardEffectiveness[];
  /** 迭代資料 */
  iteration_data?: {
    total_iterations: number;
    iteration_causes?: Array<{
      iteration: number;
      cause: string;
      related_standard?: string;
    }>;
  };
  /** 未被標準涵蓋的問題 */
  unmatched_issues?: Array<{
    issue: string;
    category: string;
    suggested_standard?: string;
  }>;
  /** Harness hook telemetry 彙總（SPEC-010，telemetry.jsonl 不存在時為 undefined） */
  harness_hook_data?: HarnessHookData;
}

export interface ExecutionReport {
  /** 摘要統計 */
  summary: ExecutionSummary;
  /** 各任務的執行結果 */
  tasks: TaskResult[];
  /** 品質指標（若使用品質模式） */
  quality_metrics?: QualityMetrics;
  /** 標準效果回饋（UDS SPEC-SELFDIAG-001） */
  standards_effectiveness?: StandardsEffectivenessReport;
}

/**
 * 串流任務事件（XSPEC-042）
 *
 * TaskStreamEvent 是 executeTaskStream() 回傳的 AsyncGenerator 所 yield 的事件。
 * 使用 discriminated union，每種事件有獨立的 type 欄位。
 *
 * - tool_start：工具呼叫開始（來自 SDKAssistantMessage content 中的 tool_use block）
 * - tool_end：工具呼叫完成（來自 SDKToolProgressMessage elapsed_time_seconds）
 * - thinking：思考過程文字片段
 * - output_chunk：一般文字輸出片段
 * - progress：進度訊息（來自 SDKTaskProgressMessage 或 SDKStatusMessage）
 */
export type TaskStreamEvent =
  | { type: "tool_start"; task_id: string; tool_name: string; tool_input?: unknown }
  | { type: "tool_end"; task_id: string; tool_name: string; duration_ms: number; success: boolean }
  | { type: "thinking"; task_id: string; chunk: string }
  | { type: "output_chunk"; task_id: string; chunk: string }
  | { type: "progress"; task_id: string; message: string; step: number; total_steps?: number };

/**
 * Agent Adapter 介面
 *
 * 所有 AI agent adapter 必須實作此介面。
 * 每個 adapter 負責與特定 agent 的 SDK/CLI 溝通。
 *
 * ## VibeOps 整合指引
 *
 * VibeOps（vibeops360）可實作此介面讓 DevAP 編排其 7+1 agents：
 *
 * ```typescript
 * class VibeOpsAdapter implements AgentAdapter {
 *   readonly name: AgentType = "vibeops" as AgentType;
 *   // 透過 VibeOps REST API 路由到對應 Agent
 *   async executeTask(task, options) { ... }
 *   // 檢查 VibeOps 服務健康狀態
 *   async isAvailable() { ... }
 *   // 恢復暫停的 pipeline session
 *   async resumeSession(sessionId) { ... }
 * }
 * ```
 *
 * 詳見 SPEC-004-vibeops-adapter.md。
 */
export interface AgentAdapter {
  /** agent 類型名稱 */
  readonly name: AgentType;

  /**
   * 執行單一任務
   * @param task - 要執行的任務
   * @param options - 執行選項
   * @returns 任務執行結果
   */
  executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult>;

  /**
   * 檢查此 agent 是否可用（CLI 是否安裝、SDK 是否可達）
   * @returns 是否可用
   */
  isAvailable(): Promise<boolean>;

  /**
   * 恢復指定 session（可選實作）
   * @param sessionId - 要恢復的 session ID
   */
  resumeSession?(sessionId: string): Promise<void>;

  /**
   * 以串流方式執行單一任務（XSPEC-042，可選實作）
   *
   * 與 executeTask() 語意相同，但以 AsyncGenerator 對外暴露內部 SDK stream，
   * 讓呼叫方可即時接收工具呼叫、文字輸出等進度事件。
   *
   * Generator 結束（done: true）時的 return value 即為最終 TaskResult。
   *
   * @param task - 要執行的任務
   * @param options - 執行選項
   * @returns AsyncGenerator，yield TaskStreamEvent，return TaskResult
   */
  executeTaskStream?(
    task: Task,
    options: ExecuteOptions,
  ): AsyncGenerator<TaskStreamEvent, TaskResult>;

  /**
   * 能力聲明（XSPEC-037 Fail-Closed 預設）
   *
   * 未提供時使用 FAIL_CLOSED_DEFAULTS（最保守設定）。
   * 新增 Adapter 時建議明確聲明，避免被誤判為不安全。
   */
  capabilities?: Readonly<CapabilityDeclaration>;
}

/**
 * 安全決策三態（XSPEC-037 / UDS security-decision 標準）
 *
 * deny > ask > allow 優先級鐵律：
 * - deny: 立即阻止，任何來源的 deny 均優先
 * - ask: 需使用者確認（CI 模式下等同 deny）
 * - allow: 允許繼續執行
 *
 * 向後相容：SafetyHook 仍可回傳 boolean（true = allow, false = deny）
 */
export type SecurityDecision = "deny" | "ask" | "allow";

/**
 * 能力聲明（XSPEC-037 / UDS capability-declaration 標準）
 *
 * Fail-Closed 設計：未明確聲明的屬性預設為最保守值。
 * 「忘記聲明」的結果是保守行為，而非危險行為。
 */
export interface CapabilityDeclaration {
  /** 是否對並行執行安全（無競態、無共享可變狀態）。預設 false。 */
  isConcurrencySafe: boolean;
  /** 是否為純讀取操作（不修改任何持久化狀態）。預設 false。 */
  isReadOnly: boolean;
  /** 執行前是否需要使用者明確確認。預設 true。 */
  requiresUserConfirmation: boolean;
  /** 工具的信任等級，影響沙箱隔離強度。預設 "untrusted"。 */
  trustLevel: "trusted" | "sandboxed" | "untrusted";
}

/** Fail-Closed 預設能力聲明 */
export const FAIL_CLOSED_DEFAULTS: Readonly<CapabilityDeclaration> = {
  isConcurrencySafe: false,
  isReadOnly: false,
  requiresUserConfirmation: true,
  trustLevel: "untrusted",
} as const;

/**
 * Safety Hook 回呼函式類型
 *
 * 在任務執行前呼叫，用於攔截危險操作。
 * 支援三態回傳（SecurityDecision）或向後相容的布林值：
 * - "deny" / false: 拒絕執行
 * - "ask": 需使用者確認（DevAP CI 模式下等同 deny）
 * - "allow" / true: 允許執行
 */
export type SafetyHook = (task: Task) => Promise<SecurityDecision | boolean> | SecurityDecision | boolean;

/**
 * 已解析的單一任務（含生成的 prompt）
 */
export interface ResolvedTask extends Task {
  /** generateClaudeMd() 產生的 sub-agent prompt */
  generated_prompt: string;
}

/**
 * 已解析的執行層
 *
 * 同層 tasks 彼此間無依賴，可並行執行。
 */
export interface ResolvedLayer {
  /** 層索引（從 0 開始） */
  index: number;
  /** 同層可並行的任務列表 */
  tasks: ResolvedTask[];
}

/**
 * 已解析的執行計畫
 *
 * plan-resolver 的輸出，包含分層資訊、驗證結果、安全問題。
 * 作為獨立模式與 Claude Code 模式的共用橋接資料結構。
 */
export interface ResolvedPlan {
  /** 專案名稱 */
  project: string;
  /** 執行模式 */
  mode: "sequential" | "parallel";
  /** 最大並行數 */
  max_parallel: number;
  /** 拓撲分層結果 */
  layers: ResolvedLayer[];
  /** Plan 驗證結果 */
  validation: ValidationResult;
  /** 安全問題清單 */
  safety_issues: Array<{ task_id: string; issue: string }>;
  /** 總任務數 */
  total_tasks: number;
  /** 品質設定（展開後的完整設定） */
  quality: QualityConfig;
  /** 品質相關警告（如缺少 verify_command） */
  quality_warnings: string[];
}

/**
 * 模型等級（借鑑 Superpowers 模型分級策略）
 *
 * - fast: 單一檔案、明確 spec 的機械性實作
 * - standard: 多檔案整合、需要判斷力
 * - capable: 架構設計、審查、除錯
 */
export type ModelTier = "fast" | "standard" | "capable";

/**
 * 驗證證據（借鑑 Superpowers Iron Law: Evidence before claims）
 *
 * 要求 agent 在聲稱完成前提供實際驗證結果。
 */
export interface VerificationEvidence {
  /** 實際執行的驗證指令 */
  command: string;
  /** 退出碼 */
  exit_code: number;
  /** 驗證輸出（截斷至合理長度） */
  output: string;
  /** 執行時間（ISO 8601） */
  timestamp: string;
}

/**
 * Judge 審查階段（借鑑 Superpowers 雙階段審查）
 *
 * - spec: Spec Compliance — 比對 task spec 與實作產出
 * - quality: Code Quality — 程式碼品質、測試覆蓋、架構一致性
 * - red_team: Red Team — 攻方視角，找注入向量、邊界條件缺口、競態條件、授權繞過（XSPEC-043）
 */
export type JudgeReviewStage = "spec" | "quality" | "red_team";

/**
 * 結構化除錯回饋（借鑑 Superpowers 四階段除錯法）
 *
 * Fix Loop 在重試時注入結構化指引，而非僅轉發錯誤訊息。
 */
export interface FixFeedback {
  /** 原始錯誤訊息 */
  error: string;
  /** 當前除錯階段 */
  phase: "root_cause" | "pattern_analysis" | "hypothesis" | "fix";
  /** 先前嘗試記錄 */
  previous_attempts: Array<{ hypothesis: string; result: string }>;
  /** 結構化除錯指引 */
  instruction: string;
}

/** Judge 審查策略 */
export type JudgePolicy = "always" | "on_change" | "never";

/** Quality Profile 預設模板名稱 */
export type QualityProfileName = "strict" | "standard" | "minimal" | "none";

/**
 * 品質設定（展開後的完整設定）
 *
 * 由 Quality Profile 展開或由使用者自訂。
 */
export interface QualityConfig {
  /** 是否要求 verify_command */
  verify: boolean;
  /** lint 指令（若設定，執行後檢查 exit code） */
  lint_command?: string;
  /** 型別檢查指令（若設定，執行後檢查 exit code） */
  type_check_command?: string;
  /** Judge 審查策略 */
  judge_policy: JudgePolicy;
  /** 最大重試次數（verify 失敗或 Judge REJECT 時） */
  max_retries: number;
  /** 單一 task 重試預算上限（美元），超過則停止重試 */
  max_retry_budget_usd: number;
  /** 靜態分析指令 */
  static_analysis_command?: string;
  /** 完成準則（ISO 29119 Test Completion Criteria / Agile DoD） */
  completion_criteria?: CompletionCheck[];
  /** 是否啟用 Red Team 第三審查階段（預設 false，XSPEC-043） */
  red_team?: boolean;
}

/**
 * Fix Loop 設定
 *
 * 控制自動修復迴圈的行為。
 */
export interface FixLoopConfig {
  /** 最大重試次數 */
  max_retries: number;
  /** 單一 task 重試預算上限（美元） */
  max_retry_budget_usd: number;
}

/**
 * Fix Loop 單次嘗試結果
 */
export interface FixLoopAttempt {
  /** 嘗試次序（從 1 開始） */
  attempt: number;
  /** 是否成功 */
  success: boolean;
  /** 此次嘗試的成本（美元） */
  cost_usd: number;
  /** 錯誤回饋（失敗時） */
  feedback?: string;
}

/**
 * Fix Loop 執行結果
 */
export interface FixLoopResult {
  /** 最終是否成功 */
  success: boolean;
  /** 所有嘗試記錄 */
  attempts: FixLoopAttempt[];
  /** 總重試成本（美元） */
  total_retry_cost_usd: number;
  /** 停止原因 */
  stop_reason: "passed" | "max_retries" | "budget_exceeded" | "circuit_open";
}

/** Checkpoint 策略 */
export type CheckpointPolicy = "after_each_layer" | "after_critical" | "never";

/** Checkpoint 動作 */
export type CheckpointAction = "continue" | "abort" | "retry_layer";

/**
 * Checkpoint 摘要資料
 *
 * 在層間暫停時呈現給使用者的進度資訊。
 */
export interface CheckpointSummary {
  /** 當前完成的層索引 */
  layer_index: number;
  /** 總層數 */
  total_layers: number;
  /** 本層的任務結果 */
  layer_results: TaskResult[];
  /** 累積的所有結果 */
  all_results: TaskResult[];
}

/** Checkpoint 回呼函式：接收摘要，回傳使用者選擇的動作 */
export type CheckpointCallback = (summary: CheckpointSummary) => Promise<CheckpointAction>;

/**
 * Orchestrator 結構化事件（XSPEC-049）
 *
 * Discriminated union，透過 `type` 欄位區分事件類型。
 * 透過 `OrchestratorOptions.emitter` 監聽，頻道名稱為 `"event"`。
 */
export type OrchestratorEvent =
  | {
      type: "orchestrator:start";
      /** 計劃 ID（plan.id） */
      plan_id: string;
      /** 任務總數 */
      task_count: number;
      timestamp: string;
    }
  | {
      type: "orchestrator:complete";
      plan_id: string;
      summary: ExecutionSummary;
      /** 整體耗時（毫秒） */
      duration_ms: number;
      timestamp: string;
    }
  | {
      type: "task:start";
      task_id: string;
      title: string;
      timestamp: string;
    }
  | {
      type: "task:complete";
      task_id: string;
      status: TaskStatus;
      duration_ms: number;
      timestamp: string;
    }
  | {
      type: "task:failed";
      task_id: string;
      error: string;
      failure_source?: FailureSource;
      timestamp: string;
    }
  | {
      type: "task:cancelled";
      task_id: string;
      reason: string;
      timestamp: string;
    }
  | {
      type: "task:skipped";
      task_id: string;
      reason: string;
      timestamp: string;
    }
  | {
      type: "layer:start";
      /** 0-based 層索引 */
      layer_index: number;
      task_ids: string[];
      timestamp: string;
    }
  | {
      type: "layer:complete";
      layer_index: number;
      timestamp: string;
    }
  | {
      type: "signal:abort";
      reason: string;
      /** 尚未執行的 Task 數量 */
      remaining_tasks: number;
      timestamp: string;
    };

/**
 * 編排器選項
 */
export interface OrchestratorOptions {
  /** 工作目錄 */
  readonly cwd: string;
  /** 規劃階段的 session ID */
  readonly sessionId?: string;
  /** 進度回呼 */
  readonly onProgress?: (message: string) => void;
  /** 安全 hook 列表 */
  readonly safetyHooks?: ReadonlyArray<SafetyHook>;
  /** 是否啟用並行模式 */
  readonly parallel?: boolean;
  /** 最大並行任務數 */
  readonly maxParallel?: number;
  /** 品質設定（若提供，啟用 quality gate + fix loop + judge） */
  readonly qualityConfig?: QualityConfig;
  /** Checkpoint 策略（預設 never） */
  readonly checkpointPolicy?: CheckpointPolicy;
  /** Checkpoint 回呼（checkpoint_policy 非 never 時必須提供） */
  readonly onCheckpoint?: CheckpointCallback;
  /** 隔離模式（借鑑 Superpowers Git Worktree 隔離執行） */
  readonly isolation?: "none" | "worktree";
  /** 專案原始 CLAUDE.md 路徑（用於 generated_prompt 生成） */
  readonly existingClaudeMdPath?: string;
  /**
   * Fork Mode Cache-Safe 並行（XSPEC-038）
   *
   * 啟用時，若前一層恰好只有 1 個成功 Task 且產生了 session_id，
   * 則將該 session_id 作為下一層所有並行 Task 的 base session，
   * 透過 forkSession:true 共享 Anthropic prompt cache prefix。
   *
   * 預設 false，不影響現有行為。
   */
  readonly parallelForkMode?: boolean;
  /**
   * 啟用串流模式（XSPEC-042）
   *
   * 若 adapter 實作了 executeTaskStream()，則使用串流模式執行 task，
   * 即時轉發 tool_start 等事件到 onProgress 回呼。
   * 若 adapter 未實作，退回使用 executeTask()。
   *
   * 預設 false，不影響現有行為。
   */
  readonly streamOutput?: boolean;
  /** 分支漂移警告閾值（XSPEC-047，預設 5） */
  readonly branchDriftWarningThreshold?: number;
  /** 分支漂移阻擋閾值（XSPEC-047，預設 6） */
  readonly branchDriftBlockThreshold?: number;
  /** 基底分支名稱（XSPEC-047，預設 "main"） */
  readonly branchDriftBaseBranch?: string;
  /**
   * 取消訊號（XSPEC-048）
   *
   * Orchestrator 在每個 Layer 邊界檢查 signal.aborted：
   * - 若已 abort，將所有未開始 Task 標記為 "cancelled"，並傳播 signal 給進行中 Task
   * - cancelled Task 不觸發重試，也不消耗 max_retries 配額
   *
   * 可用 AbortSignal.any([signal1, signal2]) 合併多個取消來源（用戶 + 逾時）。
   */
  readonly signal?: AbortSignal;
  /**
   * 結構化事件發射器（XSPEC-049）
   *
   * 監聽頻道 `"event"`，接收 `OrchestratorEvent` discriminated union。
   * 與 `onProgress` 共存，不傳入時行為與舊版完全相同（向後相容）。
   *
   * @example
   * ```typescript
   * const emitter = new EventEmitter()
   * emitter.on("event", (e: OrchestratorEvent) => {
   *   if (e.type === "task:complete") console.log(e.task_id, e.duration_ms)
   * })
   * await orchestrate(plan, adapter, { emitter })
   * ```
   */
  readonly emitter?: import("node:events").EventEmitter;
}

/**
 * Plan 驗證結果
 */
export interface ValidationResult {
  /** 是否驗證通過 */
  valid: boolean;
  /** 錯誤訊息列表 */
  errors: string[];
}
