/**
 * 執行歷史倉庫 — 型別定義（SPEC-008）
 */

/** 執行歷史配置（TaskPlan 層級） */
export interface ExecutionHistoryConfig {
  enabled: boolean;
  backend?: "local" | "file_server";
  file_server_url?: string;
  retention?: Partial<RetentionConfig>;
  extra_sensitive_patterns?: SensitivePattern[];
  /** 是否啟用遙測上傳（opt-in，預設 false；SPEC-012） */
  telemetryUpload?: boolean;
  /** 遙測伺服器 URL（telemetryUpload=true 時必填；SPEC-012） */
  telemetryServer?: string;
  /** 遙測 API Key（空字串時不觸發上傳；SPEC-012） */
  telemetryApiKey?: string;
}

/** L1 全域索引 */
export interface HistoryIndex {
  version: string;
  updated: string;
  max_active_tasks: number;
  archive_threshold_days: number;
  tasks: HistoryIndexEntry[];
}

export interface HistoryIndexEntry {
  task_id: string;
  task_name: string;
  tags: string[];
  latest_run: string;
  latest_status: "success" | "failure" | "partial";
  latest_date: string;
  total_runs: number;
}

/** L2 Task Manifest */
export interface TaskManifest {
  task_id: string;
  task_description_summary: string;
  run_history: RunHistoryEntry[];
  key_metrics: {
    pass_rate: number;
    avg_tokens: number;
    avg_duration_s: number;
  };
  artifacts_available: string[];
  failure_summary?: string;
}

export interface RunHistoryEntry {
  run: string;
  status: "success" | "failure" | "partial";
  date: string;
  duration_s: number;
  tokens_total: number;
}

/** Retention 配置 */
export interface RetentionConfig {
  max_runs_per_task: number;
  max_total_size_mb: number;
  cleanup_strategy: "oldest_l3_first";
  archive_threshold_days: number;
}

/** Sensitive Pattern */
export interface SensitivePattern {
  pattern: string;
  label: string;
}

/** Storage Backend 介面 */
export interface StorageBackend {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteDir(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

/** recordRun 的上下文資料 */
export interface RunContext {
  codeDiff?: string;
  executionLog?: Array<{ timestamp: string; message: string }>;
  previousAttempts?: Array<{ hypothesis: string; result: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-013: 獨立儲存 API 型別
// ─────────────────────────────────────────────────────────────────────────────

/** Artifact 類型（SPEC-013） */
export type ArtifactType =
  | "task-description"
  | "code-diff"
  | "test-results"
  | "execution-log"
  | "token-usage"
  | "final-status"
  | "error-analysis"
  | "agent-reasoning";

/** L1 索引條目別名（SPEC-013） */
export type ManifestL1Entry = HistoryIndexEntry;

/** L2 任務 Manifest 別名（SPEC-013） */
export type ManifestL2 = TaskManifest;

/** 單次執行 Manifest（per-run，SPEC-013） */
export interface RunManifest {
  run: string;
  status: "success" | "failure" | "partial";
  date: string;
  duration_s: number;
  tokens_total: number;
  artifacts: string[];
}

/** 儲存後端配置（SPEC-013） */
export interface StorageConfig {
  /** .execution-history/ 的上層目錄（project root） */
  basePath: string;
  backend?: "local" | "file_server";
  file_server_url?: string;
  retention?: Partial<RetentionConfig>;
  sensitivePatternsExtra?: SensitivePattern[];
}

/** Retention 策略別名（SPEC-013） */
export type RetentionPolicy = RetentionConfig;

/** recordRun 的 artifacts 輸入（SPEC-013） */
export interface RunArtifacts {
  taskId: string;
  taskName: string;
  tags?: string[];
  status: "success" | "failure" | "partial";
  /** artifact 類型 → 原始字串內容 */
  content: Partial<Record<ArtifactType, string>>;
  durationS?: number;
  tokensTotal?: number;
}
