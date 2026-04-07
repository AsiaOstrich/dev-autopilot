/**
 * Token Cost Analyzer（XSPEC-004 Phase 4.1）
 *
 * 讀取 execution-history 的 L1/L2 數據，按 tags + quality 分組，
 * 識別 token 消耗顯著高於平均值的任務類型。
 */

import type { StorageBackend } from "../execution-history/types.js";
import { HistoryReader } from "../execution-history/reader.js";
import type {
  AnalyzerConfig,
  AnalysisResult,
  GroupKey,
  GroupStats,
  Outlier,
} from "./types.js";

/** 用於分組的內部資料結構 */
interface TaskTokenRecord {
  task_id: string;
  tags: string[];
  quality: "success" | "failure" | "partial";
  avg_tokens: number;
}

/** 產生穩定的分組鍵字串 */
function groupKeyString(key: GroupKey): string {
  return `${[...key.tags].sort().join(",")}|${key.quality}`;
}

/** 計算中位數 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** 計算標準差 */
function stdDev(values: number[], avg: number): number {
  if (values.length <= 1) return 0;
  const sumSq = values.reduce((sum, v) => sum + (v - avg) ** 2, 0);
  return Math.sqrt(sumSq / values.length);
}

/**
 * Token 成本分析器
 */
export class TokenCostAnalyzer {
  private readonly reader: HistoryReader;
  private readonly config: AnalyzerConfig;

  constructor(backend: StorageBackend, config: AnalyzerConfig) {
    this.reader = new HistoryReader(backend);
    this.config = config;
  }

  /**
   * 執行分析
   *
   * 1. 讀取 L1 index 取得所有 task
   * 2. 讀取各 task 的 L2 manifest 取得 avg_tokens、tags、quality
   * 3. 按 tags + quality 分組計算統計
   * 4. 識別超過 threshold_ratio 的異常值
   */
  async analyze(): Promise<AnalysisResult> {
    const now = new Date().toISOString();
    const index = await this.reader.readIndex();

    // 無資料時視為樣本不足
    if (!index || index.tasks.length === 0) {
      return this.skippedResult(now, 0);
    }

    // 收集每個 task 的 token 記錄
    const records: TaskTokenRecord[] = [];
    for (const entry of index.tasks) {
      const manifest = await this.reader.readTaskManifest(entry.task_id);
      if (!manifest || manifest.run_history.length === 0) continue;

      records.push({
        task_id: entry.task_id,
        tags: entry.tags,
        quality: entry.latest_status,
        avg_tokens: manifest.key_metrics.avg_tokens,
      });
    }

    // 樣本數不足
    if (records.length < this.config.min_samples) {
      return this.skippedResult(now, records.length);
    }

    // 按 tags + quality 分組
    const groupMap = new Map<string, { key: GroupKey; records: TaskTokenRecord[] }>();
    for (const rec of records) {
      const key: GroupKey = { tags: rec.tags, quality: rec.quality };
      const ks = groupKeyString(key);
      const existing = groupMap.get(ks);
      if (existing) {
        existing.records.push(rec);
      } else {
        groupMap.set(ks, { key, records: [rec] });
      }
    }

    // 計算各組統計 + 識別異常值
    const groups: GroupStats[] = [];
    const outliers: Outlier[] = [];

    for (const { key, records: groupRecords } of groupMap.values()) {
      const tokens = groupRecords.map((r) => r.avg_tokens);
      const avg = tokens.reduce((s, v) => s + v, 0) / tokens.length;
      const med = median(tokens);
      const sd = stdDev(tokens, avg);
      const min = Math.min(...tokens);
      const max = Math.max(...tokens);

      const outlierIds: string[] = [];
      const threshold = avg * this.config.threshold_ratio;

      for (const rec of groupRecords) {
        if (rec.avg_tokens > threshold) {
          outlierIds.push(rec.task_id);
          const savingPct =
            avg > 0 ? ((rec.avg_tokens - avg) / rec.avg_tokens) * 100 : 0;
          outliers.push({
            task_id: rec.task_id,
            group_key: key,
            actual_tokens: rec.avg_tokens,
            group_avg: avg,
            ratio: avg > 0 ? rec.avg_tokens / avg : 0,
            estimated_saving_pct: Math.round(savingPct * 10) / 10,
          });
        }
      }

      groups.push({
        group_key: key,
        sample_count: groupRecords.length,
        avg_tokens: Math.round(avg),
        median_tokens: Math.round(med),
        std_dev: Math.round(sd * 10) / 10,
        min_tokens: min,
        max_tokens: max,
        outlier_task_ids: outlierIds,
      });
    }

    return {
      analyzer: "token-cost",
      timestamp: now,
      config: this.config,
      total_tasks_scanned: records.length,
      groups,
      outliers,
      skipped: false,
    };
  }

  /** 產生「樣本不足」的跳過結果 */
  private skippedResult(timestamp: string, scanned: number): AnalysisResult {
    return {
      analyzer: "token-cost",
      timestamp,
      config: this.config,
      total_tasks_scanned: scanned,
      groups: [],
      outliers: [],
      skipped: true,
      skip_reason: "insufficient_samples",
    };
  }
}
