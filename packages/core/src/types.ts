/**
 * dev-autopilot 核心型別定義
 *
 * 定義所有核心介面，包括 Task、TaskResult、AgentAdapter、ExecutionReport 等。
 * 參考：docs/research/feasibility-and-design.md 第 6 節
 */

/** 支援的 AI Agent 類型 */
export type AgentType = "claude" | "opencode" | "codex" | "cline" | "cursor";

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
 * 完整的執行報告
 *
 * 編排器執行完所有任務後產出的報告。
 */
export interface ExecutionReport {
  /** 摘要統計 */
  summary: ExecutionSummary;
  /** 各任務的執行結果 */
  tasks: TaskResult[];
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
