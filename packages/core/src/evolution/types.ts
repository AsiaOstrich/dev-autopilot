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

/** 品質策略分析器額外配置 */
export interface QualityStrategyConfig extends AnalyzerConfig {
  /**
   * pass_rate 低於此值時視為 under_performing（預設 0.7）
   * 即：過去所有 run 中，有 30% 以上失敗
   */
  pass_rate_target?: number;
  /**
   * avg_tokens 超過全域中位數的倍數時視為 over_provisioned（預設 1.5）
   */
  token_overhead_ratio?: number;
}

/** Evolution 模組配置（對應 .evolution/config.yaml） */
export interface EvolutionConfig {
  enabled: boolean;
  analyzers: {
    "token-cost": AnalyzerConfig;
    "hook-efficiency"?: AnalyzerConfig;
    "quality-strategy"?: QualityStrategyConfig;
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
  /**
   * 分析信心等級（XSPEC-004 Phase 4.1 update）
   * - "low"：5–49 筆樣本，建議謹慎參考
   * - "high"：50+ 筆樣本，可信度足夠
   * - undefined：skipped（不足 5 筆）
   */
  confidence?: "low" | "high";
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

// ─── Hook 效率分析（XSPEC-004 Phase 4.2）─────────────────────

/** Hook 效率問題：pass_rate 低於閾值的 standard */
export interface HookEfficiencyIssue {
  standard_id: string;
  /** 總執行次數 */
  executions: number;
  /** 通過率（0–1） */
  pass_rate: number;
  /** 失敗次數 */
  fail_count: number;
  /** 平均執行耗時（毫秒） */
  avg_duration_ms: number;
  /** 低於閾值的幅度（百分比，正數表示低於閾值） */
  degradation_pct: number;
}

/** Hook 效率分析結果 */
export interface HookEfficiencyAnalysisResult {
  analyzer: "hook-efficiency";
  timestamp: string;
  config: AnalyzerConfig;
  /** 掃描的 standard 總數 */
  total_standards_scanned: number;
  /** 掃描的總執行次數 */
  total_executions: number;
  /** 發現的效率問題（pass_rate 低於閾值），按 pass_rate 升序 */
  issues: HookEfficiencyIssue[];
  skipped: boolean;
  skip_reason?: "insufficient_samples" | "no_telemetry_data";
  confidence?: "low" | "high";
}

// ─── 品質策略分析（XSPEC-004 Phase 4.3）─────────────────────

/**
 * 品質策略問題類型：
 * - over_provisioned：pass_rate ≥ 95% 但 token 消耗顯著高於全域中位數（可能品質等級過高）
 * - under_performing：pass_rate 低於目標閾值（品質策略可能不足）
 */
export type QualityStrategySignal = "over_provisioned" | "under_performing";

/** 以 tag 群組為單位的品質策略問題 */
export interface QualityStrategyIssue {
  /** 識別此群組的 tag 組合 */
  tag_group: string[];
  /** 問題訊號類型 */
  signal: QualityStrategySignal;
  /** 群組內的任務數量 */
  task_count: number;
  /** 群組平均通過率（0–1） */
  avg_pass_rate: number;
  /** 群組平均 token 消耗 */
  avg_tokens: number;
  /** 全域中位數 token（跨所有群組） */
  global_median_tokens: number;
  /**
   * 嚴重程度百分比（正數）：
   * - over_provisioned：token 超出中位數的百分比
   * - under_performing：pass_rate 低於目標閾值的百分比點數
   */
  severity_pct: number;
  /** 人類可讀建議動作 */
  suggested_action: string;
}

/** 品質策略分析結果 */
export interface QualityStrategyAnalysisResult {
  analyzer: "quality-strategy";
  timestamp: string;
  config: AnalyzerConfig;
  /** 掃描的任務群組數量 */
  total_groups_scanned: number;
  /** 掃描的任務總數 */
  total_tasks_scanned: number;
  /** 發現的品質策略問題，按 severity_pct 降序 */
  issues: QualityStrategyIssue[];
  skipped: boolean;
  skip_reason?: "insufficient_samples";
  confidence?: "low" | "high";
}

// ─── 分析日誌 ───────────────────────────────────────────────

/** analysis-log.jsonl 單行 */
export interface AnalysisLogEntry {
  timestamp: string;
  analyzer: "token-cost" | "hook-efficiency" | "quality-strategy";
  status: "completed" | "skipped";
  skip_reason?: "insufficient_samples" | "no_telemetry_data";
  total_tasks_scanned: number;
  outliers_found: number;
  proposals_generated: number;
  /** 分析信心等級（XSPEC-004 Phase 4.1 update） */
  confidence?: "low" | "high";
}
