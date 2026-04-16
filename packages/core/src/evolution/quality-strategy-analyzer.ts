/**
 * QualityStrategyAnalyzer（XSPEC-004 Phase 4.3）
 *
 * 讀取 execution-history L1/L2，以任務 tag 組合為群組，
 * 識別品質策略問題：
 *
 * - over_provisioned：pass_rate ≥ 95% 但 token 消耗顯著高於全域中位數
 *   → 可能使用了過高的品質等級（如 strict）導致 token 浪費
 *
 * - under_performing：pass_rate 低於 pass_rate_target（預設 0.7）
 *   → 任務長期失敗，品質策略可能不足或任務定義需調整
 *
 * 信心等級（ABSOLUTE_MIN / HIGH_CONFIDENCE_MIN 與 HookEfficiencyAnalyzer 相同）：
 * - total_tasks < ABSOLUTE_MIN      → skipped
 * - ABSOLUTE_MIN ≤ tasks < HIGH_MIN  → confidence: "low"
 * - tasks ≥ HIGH_MIN                 → confidence: "high"
 */

import type { StorageBackend, HistoryIndex, HistoryIndexEntry } from "../execution-history/types.js";
import type { QualityStrategyAnalysisResult, QualityStrategyIssue, QualityStrategyConfig } from "./types.js";

const HIGH_CONFIDENCE_MIN = 50;

const DEFAULT_PASS_RATE_TARGET = 0.7;
const DEFAULT_TOKEN_OVERHEAD_RATIO = 1.5;

/**
 * tag 組合的字串鍵（排序後 join，確保順序無關）
 */
function tagGroupKey(tags: string[]): string {
  return [...tags].sort().join(",") || "(no-tags)";
}

/**
 * 計算數字陣列的中位數
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

interface GroupAccumulator {
  tags: string[];
  entries: Array<{ pass_rate: number; avg_tokens: number }>;
}

export class QualityStrategyAnalyzer {
  private readonly backend: StorageBackend;
  private readonly config: QualityStrategyConfig;

  constructor(backend: StorageBackend, config: QualityStrategyConfig) {
    this.backend = backend;
    this.config = config;
  }

  async analyze(): Promise<QualityStrategyAnalysisResult> {
    const timestamp = new Date().toISOString();

    // 讀取 L1 index
    const raw = await this.backend.readFile("index.json");
    if (!raw) {
      return {
        analyzer: "quality-strategy",
        timestamp,
        config: this.config,
        total_groups_scanned: 0,
        total_tasks_scanned: 0,
        issues: [],
        skipped: true,
        skip_reason: "insufficient_samples",
      };
    }

    let index: HistoryIndex;
    try {
      index = JSON.parse(raw) as HistoryIndex;
    } catch {
      return {
        analyzer: "quality-strategy",
        timestamp,
        config: this.config,
        total_groups_scanned: 0,
        total_tasks_scanned: 0,
        issues: [],
        skipped: true,
        skip_reason: "insufficient_samples",
      };
    }

    const tasks = index.tasks ?? [];
    const totalTasks = tasks.length;

    if (totalTasks < this.config.min_samples) {
      return {
        analyzer: "quality-strategy",
        timestamp,
        config: this.config,
        total_groups_scanned: 0,
        total_tasks_scanned: totalTasks,
        issues: [],
        skipped: true,
        skip_reason: "insufficient_samples",
      };
    }

    const confidence: "low" | "high" = totalTasks >= HIGH_CONFIDENCE_MIN ? "high" : "low";

    // 以 tag 組合分組
    const groupMap = new Map<string, GroupAccumulator>();
    for (const entry of tasks) {
      const key = tagGroupKey(entry.tags ?? []);
      if (!groupMap.has(key)) {
        groupMap.set(key, { tags: [...(entry.tags ?? [])].sort(), entries: [] });
      }
      // 從 L1 index 取得 pass_rate 代理值（total_runs 和 latest_status）
      const passRate = this.estimatePassRate(entry);
      const avgTokens = await this.readAvgTokens(entry);
      groupMap.get(key)!.entries.push({ pass_rate: passRate, avg_tokens: avgTokens });
    }

    // 計算全域中位數 token（用於 over_provisioned 判定）
    const allTokens: number[] = [];
    for (const group of groupMap.values()) {
      for (const e of group.entries) {
        if (e.avg_tokens > 0) allTokens.push(e.avg_tokens);
      }
    }
    const globalMedianTokens = median(allTokens);

    const passRateTarget = this.config.pass_rate_target ?? DEFAULT_PASS_RATE_TARGET;
    const tokenOverheadRatio = this.config.token_overhead_ratio ?? DEFAULT_TOKEN_OVERHEAD_RATIO;

    const issues: QualityStrategyIssue[] = [];

    for (const [, group] of groupMap) {
      if (group.entries.length < this.config.min_samples) continue;

      const avgPassRate =
        group.entries.reduce((sum, e) => sum + e.pass_rate, 0) / group.entries.length;
      const avgTokens =
        group.entries.reduce((sum, e) => sum + e.avg_tokens, 0) / group.entries.length;

      // over_provisioned: 高通過率 + 高 token 消耗
      if (avgPassRate >= 0.95 && globalMedianTokens > 0 && avgTokens > globalMedianTokens * tokenOverheadRatio) {
        const severityPct = Math.round(((avgTokens - globalMedianTokens) / globalMedianTokens) * 100);
        issues.push({
          tag_group: group.tags,
          signal: "over_provisioned",
          task_count: group.entries.length,
          avg_pass_rate: avgPassRate,
          avg_tokens: Math.round(avgTokens),
          global_median_tokens: Math.round(globalMedianTokens),
          severity_pct: severityPct,
          suggested_action: `此 tag 群組（${group.tags.join(", ") || "(no-tags)"}）通過率 ${(avgPassRate * 100).toFixed(1)}% 但 token 消耗比全域中位數高 ${severityPct}%。建議評估是否能降低品質等級（如從 strict 改為 standard）以節省 token。`,
        });
        continue;
      }

      // under_performing: 低通過率
      if (avgPassRate < passRateTarget) {
        const severityPct = Math.round((passRateTarget - avgPassRate) * 100);
        issues.push({
          tag_group: group.tags,
          signal: "under_performing",
          task_count: group.entries.length,
          avg_pass_rate: avgPassRate,
          avg_tokens: Math.round(avgTokens),
          global_median_tokens: Math.round(globalMedianTokens),
          severity_pct: severityPct,
          suggested_action: `此 tag 群組（${group.tags.join(", ") || "(no-tags)"}）通過率 ${(avgPassRate * 100).toFixed(1)}% 低於目標 ${(passRateTarget * 100).toFixed(0)}%（差距 ${severityPct} pp）。建議審查任務定義或提升品質等級、增加驗證步驟。`,
        });
      }
    }

    // 按 severity_pct 降序排序
    issues.sort((a, b) => b.severity_pct - a.severity_pct);

    return {
      analyzer: "quality-strategy",
      timestamp,
      config: this.config,
      total_groups_scanned: groupMap.size,
      total_tasks_scanned: totalTasks,
      issues,
      skipped: false,
      confidence,
    };
  }

  /**
   * 以 L1 latest_status 和 total_runs 估算通過率。
   * L2 manifest 有精確的 pass_rate，但讀取所有 manifest 成本高，
   * 此處使用 L1 的 latest_status 作為代理：
   * success → 1.0, partial → 0.5, failure → 0.0
   */
  private estimatePassRate(entry: HistoryIndexEntry): number {
    switch (entry.latest_status) {
      case "success": return 1.0;
      case "partial":  return 0.5;
      case "failure":  return 0.0;
      default:         return 0.5;
    }
  }

  /**
   * 嘗試從 L2 manifest 讀取 key_metrics.avg_tokens；
   * 若讀取失敗則回傳 0（不影響分析）。
   */
  private async readAvgTokens(entry: HistoryIndexEntry): Promise<number> {
    try {
      const raw = await this.backend.readFile(`${entry.task_id}/manifest.json`);
      if (!raw) return 0;
      const manifest = JSON.parse(raw) as { key_metrics?: { avg_tokens?: number } };
      return manifest.key_metrics?.avg_tokens ?? 0;
    } catch {
      return 0;
    }
  }
}
