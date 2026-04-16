/**
 * Hook Efficiency Analyzer（XSPEC-004 Phase 4.2）
 *
 * 讀取 .standards/telemetry.jsonl，按 standard_id 分群，
 * 識別 pass_rate 低於閾值的 hook，產生效率改進報告。
 * 類比 TokenCostAnalyzer，但針對 hook 執行品質而非 token 消耗。
 */

import { parseTelemetryJsonl } from "../telemetry-parser.js";
import type {
  AnalyzerConfig,
  HookEfficiencyAnalysisResult,
  HookEfficiencyIssue,
} from "./types.js";

const ABSOLUTE_MIN = 5;
const HIGH_CONFIDENCE_MIN = 50;

/**
 * Hook 效率分析器
 *
 * 使用 `threshold_ratio` 作為失敗率閾值：
 * - 若 standard 的 pass_rate < (1 - threshold_ratio)，則標記為問題
 * - 例如 threshold_ratio = 0.2 → pass_rate < 0.8 時觸發
 */
export class HookEfficiencyAnalyzer {
  private readonly cwd: string;
  private readonly config: AnalyzerConfig;

  /**
   * @param cwd - 專案工作目錄（含 .standards/telemetry.jsonl）
   * @param config - 分析器配置（threshold_ratio 用作失敗率閾值）
   */
  constructor(cwd: string, config: AnalyzerConfig) {
    this.cwd = cwd;
    this.config = config;
  }

  /**
   * 執行分析
   *
   * 1. 讀取 .standards/telemetry.jsonl
   * 2. 按 standard_id 分群，過濾執行次數不足的 standard
   * 3. 計算漸進式信心等級（< 5 跳過；5–49 low；50+ high）
   * 4. 識別 pass_rate 低於閾值的 standard
   */
  async analyze(): Promise<HookEfficiencyAnalysisResult> {
    const now = new Date().toISOString();
    const data = parseTelemetryJsonl(this.cwd);

    if (!data || data.by_standard.length === 0) {
      return this.skippedResult(now, 0, 0, "no_telemetry_data");
    }

    const standards = data.by_standard;

    // 過濾執行次數不足的 standard（每個 standard 獨立判斷）
    const qualified = standards.filter((s) => s.executions >= ABSOLUTE_MIN);

    if (qualified.length === 0) {
      return this.skippedResult(
        now,
        standards.length,
        data.total_executions,
        "insufficient_samples",
      );
    }

    // 信心等級：以總執行次數判斷
    const confidence: "low" | "high" =
      data.total_executions >= HIGH_CONFIDENCE_MIN ? "high" : "low";

    // 閾值：pass_rate 低於 (1 - threshold_ratio) 時視為問題
    // e.g. threshold_ratio = 0.2 → 標記 pass_rate < 0.8 的 standard
    const passRateThreshold = 1 - this.config.threshold_ratio;
    const issues: HookEfficiencyIssue[] = [];

    for (const std of qualified) {
      if (std.pass_rate < passRateThreshold) {
        // 低於閾值的幅度（百分比）
        const degradation_pct =
          Math.round((passRateThreshold - std.pass_rate) * 1000) / 10;
        issues.push({
          standard_id: std.standard_id,
          executions: std.executions,
          pass_rate: std.pass_rate,
          fail_count: std.fail_count,
          avg_duration_ms: std.avg_duration_ms,
          degradation_pct,
        });
      }
    }

    // 按 pass_rate 升序（最差的排前面）
    issues.sort((a, b) => a.pass_rate - b.pass_rate);

    return {
      analyzer: "hook-efficiency",
      timestamp: now,
      config: this.config,
      total_standards_scanned: standards.length,
      total_executions: data.total_executions,
      issues,
      skipped: false,
      confidence,
    };
  }

  /** 產生「跳過」結果 */
  private skippedResult(
    timestamp: string,
    standardsScanned: number,
    totalExecutions: number,
    reason: "insufficient_samples" | "no_telemetry_data",
  ): HookEfficiencyAnalysisResult {
    return {
      analyzer: "hook-efficiency",
      timestamp,
      config: this.config,
      total_standards_scanned: standardsScanned,
      total_executions: totalExecutions,
      issues: [],
      skipped: true,
      skip_reason: reason,
    };
  }
}
