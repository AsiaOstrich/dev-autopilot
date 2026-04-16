import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalStorageBackend } from "../../execution-history/index.js";
import { QualityStrategyAnalyzer } from "../../evolution/quality-strategy-analyzer.js";
import type { QualityStrategyConfig } from "../../evolution/types.js";

// ─── Helpers ────────────────────────────────────────────────

const baseConfig: QualityStrategyConfig = {
  enabled: true,
  min_samples: 3,
  threshold_ratio: 1.5,
  pass_rate_target: 0.7,
  token_overhead_ratio: 1.5,
};

type IndexEntry = {
  task_id: string;
  task_name: string;
  tags: string[];
  latest_run: string;
  latest_status: "success" | "failure" | "partial";
  latest_date: string;
  total_runs: number;
};

function makeIndex(tasks: IndexEntry[]) {
  return JSON.stringify({ version: "1", updated: "2026-04-16", max_active_tasks: 100, archive_threshold_days: 30, tasks });
}

function makeManifest(avgTokens: number) {
  return JSON.stringify({ task_id: "t", task_description_summary: "x", run_history: [], key_metrics: { pass_rate: 1.0, avg_tokens: avgTokens, avg_duration_s: 5 }, artifacts_available: [] });
}

let tmpDir: string;
let backend: LocalStorageBackend;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qs-analyzer-test-"));
  backend = new LocalStorageBackend(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────

describe("QualityStrategyAnalyzer", () => {
  describe("analyze()", () => {
    it("無 index.json 時應 skip（insufficient_samples）", async () => {
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();
      expect(result.skipped).toBe(true);
      expect(result.skip_reason).toBe("insufficient_samples");
    });

    it("任務數低於 min_samples 時應 skip", async () => {
      writeFileSync(join(tmpDir, "index.json"), makeIndex([
        { task_id: "t1", task_name: "T1", tags: ["docs"], latest_run: "r1", latest_status: "success", latest_date: "2026-04-16", total_runs: 1 },
        { task_id: "t2", task_name: "T2", tags: ["docs"], latest_run: "r1", latest_status: "success", latest_date: "2026-04-16", total_runs: 1 },
      ]));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();
      expect(result.skipped).toBe(true);
    });

    it("5+ 筆任務（< 50）應回傳 confidence: low", async () => {
      const tasks: IndexEntry[] = Array.from({ length: 5 }, (_, i) => ({
        task_id: `t${i}`, task_name: `T${i}`, tags: ["docs"],
        latest_run: "r1", latest_status: "success", latest_date: "2026-04-16", total_runs: 1,
      }));
      writeFileSync(join(tmpDir, "index.json"), makeIndex(tasks));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();
      expect(result.skipped).toBe(false);
      expect(result.confidence).toBe("low");
    });

    it("50+ 筆任務應回傳 confidence: high", async () => {
      const tasks: IndexEntry[] = Array.from({ length: 50 }, (_, i) => ({
        task_id: `t${i}`, task_name: `T${i}`, tags: ["feat"],
        latest_run: "r1", latest_status: "success", latest_date: "2026-04-16", total_runs: 1,
      }));
      writeFileSync(join(tmpDir, "index.json"), makeIndex(tasks));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();
      expect(result.confidence).toBe("high");
    });

    it("全部 success 且 token 接近中位數時不應產生問題", async () => {
      // 所有任務 avg_tokens = 1000（等於全域中位數），pass_rate = 1.0 → 不觸發任何 signal
      const tasks: IndexEntry[] = Array.from({ length: 5 }, (_, i) => ({
        task_id: `t${i}`, task_name: `T${i}`, tags: ["docs"],
        latest_run: "r1", latest_status: "success", latest_date: "2026-04-16", total_runs: 1,
      }));
      for (const t of tasks) {
        mkdirSync(join(tmpDir, t.task_id), { recursive: true });
        writeFileSync(join(tmpDir, t.task_id, "manifest.json"), makeManifest(1000));
      }
      writeFileSync(join(tmpDir, "index.json"), makeIndex(tasks));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();
      expect(result.issues).toHaveLength(0);
    });

    it("群組 pass_rate 低於 pass_rate_target 應標記 under_performing", async () => {
      // 3 個 failure 任務 → avg_pass_rate = 0.0 < 0.7
      const tasks: IndexEntry[] = Array.from({ length: 3 }, (_, i) => ({
        task_id: `t${i}`, task_name: `T${i}`, tags: ["bugfix"],
        latest_run: "r1", latest_status: "failure", latest_date: "2026-04-16", total_runs: 1,
      }));
      writeFileSync(join(tmpDir, "index.json"), makeIndex(tasks));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.signal).toBe("under_performing");
      expect(result.issues[0]!.tag_group).toEqual(["bugfix"]);
    });

    it("群組 pass_rate ≥ 0.95 且 token 超過中位數 1.5 倍應標記 over_provisioned", async () => {
      // docs 群組：all success + avg_tokens = 3000（中位數 = 1000，3x > 1.5x → over_provisioned）
      const docsTasks: IndexEntry[] = Array.from({ length: 3 }, (_, i) => ({
        task_id: `docs${i}`, task_name: `D${i}`, tags: ["docs"],
        latest_run: "r1", latest_status: "success", latest_date: "2026-04-16", total_runs: 1,
      }));
      // feat 群組：baseline token = 1000
      const featTasks: IndexEntry[] = Array.from({ length: 3 }, (_, i) => ({
        task_id: `feat${i}`, task_name: `F${i}`, tags: ["feat"],
        latest_run: "r1", latest_status: "success", latest_date: "2026-04-16", total_runs: 1,
      }));

      for (const t of docsTasks) {
        mkdirSync(join(tmpDir, t.task_id), { recursive: true });
        // docs avg_tokens = 4000，feat median = 1000，全域 median ≈ 1000~2000，4000 > median*1.5
        writeFileSync(join(tmpDir, t.task_id, "manifest.json"), makeManifest(4000));
      }
      for (const t of featTasks) {
        mkdirSync(join(tmpDir, t.task_id), { recursive: true });
        writeFileSync(join(tmpDir, t.task_id, "manifest.json"), makeManifest(1000));
      }

      writeFileSync(join(tmpDir, "index.json"), makeIndex([...docsTasks, ...featTasks]));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();

      const overProvisioned = result.issues.filter((i) => i.signal === "over_provisioned");
      expect(overProvisioned).toHaveLength(1);
      expect(overProvisioned[0]!.tag_group).toEqual(["docs"]);
    });

    it("issues 應按 severity_pct 降序排序", async () => {
      // docs: failure × 3（severity_pct = 70pp below target 0.7）
      // bugfix: partial × 3（severity_pct = 20pp below target 0.7）
      const docsTasks: IndexEntry[] = Array.from({ length: 3 }, (_, i) => ({
        task_id: `d${i}`, task_name: `D${i}`, tags: ["docs"],
        latest_run: "r1", latest_status: "failure", latest_date: "2026-04-16", total_runs: 1,
      }));
      const bugfixTasks: IndexEntry[] = Array.from({ length: 3 }, (_, i) => ({
        task_id: `b${i}`, task_name: `B${i}`, tags: ["bugfix"],
        latest_run: "r1", latest_status: "partial", latest_date: "2026-04-16", total_runs: 1,
      }));
      writeFileSync(join(tmpDir, "index.json"), makeIndex([...docsTasks, ...bugfixTasks]));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();

      expect(result.issues.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < result.issues.length; i++) {
        expect(result.issues[i - 1]!.severity_pct).toBeGreaterThanOrEqual(result.issues[i]!.severity_pct);
      }
    });

    it("total_groups_scanned 和 total_tasks_scanned 應準確計數", async () => {
      const tasks: IndexEntry[] = [
        ...Array.from({ length: 3 }, (_, i) => ({ task_id: `d${i}`, task_name: `D${i}`, tags: ["docs"], latest_run: "r1", latest_status: "success" as const, latest_date: "2026-04-16", total_runs: 1 })),
        ...Array.from({ length: 4 }, (_, i) => ({ task_id: `f${i}`, task_name: `F${i}`, tags: ["feat"], latest_run: "r1", latest_status: "success" as const, latest_date: "2026-04-16", total_runs: 1 })),
      ];
      writeFileSync(join(tmpDir, "index.json"), makeIndex(tasks));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();
      expect(result.total_tasks_scanned).toBe(7);
      expect(result.total_groups_scanned).toBe(2);
    });

    it("無 tag 的任務應被歸入 (no-tags) 群組", async () => {
      const tasks: IndexEntry[] = Array.from({ length: 3 }, (_, i) => ({
        task_id: `t${i}`, task_name: `T${i}`, tags: [],
        latest_run: "r1", latest_status: "failure", latest_date: "2026-04-16", total_runs: 1,
      }));
      writeFileSync(join(tmpDir, "index.json"), makeIndex(tasks));
      const analyzer = new QualityStrategyAnalyzer(backend, baseConfig);
      const result = await analyzer.analyze();
      // 可能有 under_performing issue，tag_group 應為空陣列
      if (result.issues.length > 0) {
        expect(result.issues[0]!.tag_group).toEqual([]);
      }
    });
  });
});
