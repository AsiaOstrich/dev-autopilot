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

/** Task 執行狀態 */
export type TaskStatus =
  | "success"            // 正常完成
  | "failed"             // 執行失敗
  | "skipped"            // 依賴失敗跳過
  | "timeout"            // 逾時
  | "done_with_concerns" // 完成但有疑慮（借鑑 Superpowers DONE_WITH_CONCERNS）
  | "needs_context"      // 需要更多上下文（借鑑 Superpowers NEEDS_CONTEXT）
  | "blocked";           // 無法完成，需升級處理（借鑑 Superpowers BLOCKED）

/**
 * 單一任務定義
 *
 * 對應 specs/task-schema.json 中的 task 格式。
 * Task ID 格式：T-NNN（如 T-001）。
 */
export interface Task {
  /** 任務 ID，格式 T-NNN */
  id: string;
  /** 任務標題 */
  title: string;
  /** 任務規格說明（spec） */
  spec: string;
  /** 依賴的前置任務 ID 列表 */
  depends_on?: string[];
  /** 指定執行此任務的 agent */
  agent?: AgentType;
  /** 任務完成後的驗證指令 */
  verify_command?: string;
  /** 最大回合數 */
  max_turns?: number;
  /** 最大預算（美元） */
  max_budget_usd?: number;
  /** 允許使用的工具列表 */
  allowed_tools?: string[];
  /** 是否 fork session 執行（隔離 context） */
  fork_session?: boolean;
  /** 是否啟用 Judge Agent 審查此任務的結果 */
  judge?: boolean;
  /** 驗收條件列表，每條是一個可觀察的驗收標準 */
  acceptance_criteria?: string[];
  /** 使用者意圖：為什麼需要這個功能 */
  user_intent?: string;
  /** 多層級測試定義（優先於 verify_command） */
  test_levels?: TestLevel[];
  /** 建議模型等級（借鑑 Superpowers 模型分級策略） */
  model_tier?: ModelTier;
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
}

/**
 * 單一任務的執行結果
 */
export interface TaskResult {
  /** 任務 ID */
  task_id: string;
  /** 執行時使用的 session ID */
  session_id?: string;
  /** 執行狀態 */
  status: TaskStatus;
  /** 消耗的成本（美元） */
  cost_usd?: number;
  /** 執行耗時（毫秒） */
  duration_ms?: number;
  /** 驗證指令是否通過 */
  verification_passed?: boolean;
  /** 錯誤訊息（失敗時） */
  error?: string;
  /** 重試次數（0 = 首次即成功） */
  retry_count?: number;
  /** Judge 審查判決 */
  judge_verdict?: "APPROVE" | "REJECT";
  /** 重試總成本（美元） */
  retry_cost_usd?: number;
  /** 疑慮說明（status 為 done_with_concerns 時） */
  concerns?: string[];
  /** 需要的額外上下文（status 為 needs_context 時） */
  needed_context?: string;
  /** 阻塞原因（status 為 blocked 時） */
  block_reason?: string;
  /** 驗證證據（借鑑 Superpowers Iron Law：Evidence before claims） */
  verification_evidence?: VerificationEvidence[];
}

/**
 * 執行選項 — 傳給 AgentAdapter.executeTask 的參數
 */
export interface ExecuteOptions {
  /** 工作目錄 */
  cwd: string;
  /** 要接續的 session ID */
  sessionId?: string;
  /** 是否 fork session */
  forkSession?: boolean;
  /** 進度回呼 */
  onProgress?: (message: string) => void;
  /** 模型等級建議（adapter 可據此選擇不同 model endpoint） */
  modelTier?: ModelTier;
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
export interface ExecutionReport {
  /** 摘要統計 */
  summary: ExecutionSummary;
  /** 各任務的執行結果 */
  tasks: TaskResult[];
  /** 品質指標（若使用品質模式） */
  quality_metrics?: QualityMetrics;
}

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
}

/**
 * Safety Hook 回呼函式類型
 *
 * 在任務執行前呼叫，用於攔截危險操作。
 * 回傳 true 表示允許，false 表示拒絕。
 */
export type SafetyHook = (task: Task) => Promise<boolean> | boolean;

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
 */
export type JudgeReviewStage = "spec" | "quality";

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
  stop_reason: "passed" | "max_retries" | "budget_exceeded";
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
 * 編排器選項
 */
export interface OrchestratorOptions {
  /** 工作目錄 */
  cwd: string;
  /** 規劃階段的 session ID */
  sessionId?: string;
  /** 進度回呼 */
  onProgress?: (message: string) => void;
  /** 安全 hook 列表 */
  safetyHooks?: SafetyHook[];
  /** 是否啟用並行模式 */
  parallel?: boolean;
  /** 最大並行任務數 */
  maxParallel?: number;
  /** 品質設定（若提供，啟用 quality gate + fix loop + judge） */
  qualityConfig?: QualityConfig;
  /** Checkpoint 策略（預設 never） */
  checkpointPolicy?: CheckpointPolicy;
  /** Checkpoint 回呼（checkpoint_policy 非 never 時必須提供） */
  onCheckpoint?: CheckpointCallback;
  /** 隔離模式（借鑑 Superpowers Git Worktree 隔離執行） */
  isolation?: "none" | "worktree";
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
