/**
 * devap 核心型別定義
 *
 * 定義所有核心介面，包括 Task、TaskResult、AgentAdapter、ExecutionReport 等。
 * 參考：docs/research/feasibility-and-design.md 第 6 節
 */

/** 支援的 AI Agent 類型 */
export type AgentType = "claude" | "opencode" | "codex" | "cline" | "cursor" | "cli";

/** Task 執行狀態 */
export type TaskStatus = "success" | "failed" | "skipped" | "timeout";

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
