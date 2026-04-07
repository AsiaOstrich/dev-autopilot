/**
 * Evolution 模組型別定義（XSPEC-004 Phase 4.1）
 *
 * Token 成本分析器：讀取執行歷史數據，識別異常 token 消耗，
 * 產生改進提案供人類審批。
 */

// ─── 配置 ───────────────────────────────────────────────

/** 單一分析器配置 */
export interface AnalyzerConfig {
  enabled: boolean;
  /** 最低樣本數，不足時跳過分析 */
  min_samples: number;
  /** 超過平均值倍數時標記為異常 */
  threshold_ratio: number;
}

/** Evolution 模組配置（對應 .evolution/config.yaml） */
export interface EvolutionConfig {
  enabled: boolean;
  analyzers: {
    "token-cost": AnalyzerConfig;
    "hook-efficiency"?: AnalyzerConfig;
    "quality-strategy"?: AnalyzerConfig;
  };
  trigger: {
    mode: "manual" | "on-report" | "scheduled";
  };
  approval: {
    /** 必須為 true，不可設為 false */
    required: true;
  };
}

// ─── 分析結果 ─────────────────────────────────────────────

/** 分組鍵：tags + quality 組合 */
export interface GroupKey {
  tags: string[];
  quality: "success" | "failure" | "partial";
}

/** 單一分組的統計摘要 */
export interface GroupStats {
  group_key: GroupKey;
  sample_count: number;
  avg_tokens: number;
  median_tokens: number;
  std_dev: number;
  min_tokens: number;
  max_tokens: number;
  /** 超過 threshold 的 task IDs */
  outlier_task_ids: string[];
}

/** 單一異常項目 */
export interface Outlier {
  task_id: string;
  group_key: GroupKey;
  actual_tokens: number;
  group_avg: number;
  ratio: number;
  /** 預估節省百分比（若降至平均值） */
  estimated_saving_pct: number;
}

/** 分析結果 */
export interface AnalysisResult {
  analyzer: "token-cost";
  timestamp: string;
  config: AnalyzerConfig;
  total_tasks_scanned: number;
  groups: GroupStats[];
  outliers: Outlier[];
  /** 分析是否因樣本不足而跳過 */
  skipped: boolean;
  skip_reason?: "insufficient_samples";
}

// ─── 提案 ─────────────────────────────────────────────────

/** 提案狀態 */
export type ProposalStatus = "pending" | "approved" | "rejected" | "applied";

/** 提案影響等級 */
export type ProposalImpact = "low" | "medium" | "high";

/** 變更目標 */
export interface ProposalTarget {
  project: string;
  file?: string;
  field?: string;
}

/** 提案 frontmatter 結構 */
export interface ProposalMeta {
  id: string;
  status: ProposalStatus;
  confidence: number;
  impact: ProposalImpact;
  target: ProposalTarget;
  created: string;
  updated: string;
  /** 關聯的分析 timestamp */
  analysis_ref: string;
  reject_reason?: string;
}

/** 完整提案（metadata + 內容） */
export interface Proposal {
  meta: ProposalMeta;
  /** Markdown 格式的提案內容 */
  body: string;
}

// ─── 分析日誌 ───────────────────────────────────────────────

/** analysis-log.jsonl 單行 */
export interface AnalysisLogEntry {
  timestamp: string;
  analyzer: "token-cost";
  status: "completed" | "skipped";
  skip_reason?: "insufficient_samples";
  total_tasks_scanned: number;
  outliers_found: number;
  proposals_generated: number;
}
