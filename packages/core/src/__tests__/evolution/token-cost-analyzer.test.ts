import { describe, it, expect, vi } from "vitest";
import type { StorageBackend, HistoryIndex, TaskManifest } from "../../execution-history/types.js";
import { TokenCostAnalyzer } from "../../evolution/token-cost-analyzer.js";
import type { AnalyzerConfig } from "../../evolution/types.js";

// ─── Helpers ────────────────────────────────────────────

function createMockBackend(overrides?: Partial<StorageBackend>): StorageBackend {
  return {
    readFile: vi.fn(async () => null),
    writeFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    deleteDir: vi.fn(async () => {}),
    listDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    ...overrides,
  };
}

const defaultConfig: AnalyzerConfig = {
  enabled: true,
  min_samples: 3, // 測試用低門檻
  threshold_ratio: 1.5,
};

function makeIndex(tasks: Array<{ id: string; tags: string[]; status: "success" | "failure" | "partial" }>): HistoryIndex {
  return {
    version: "1.0.0",
    updated: "2026-01-01T00:00:00Z",
    max_active_tasks: 50,
    archive_threshold_days: 90,
    tasks: tasks.map((t) => ({
      task_id: t.id,
      task_name: `Task ${t.id}`,
      tags: t.tags,
      latest_run: "001",
      latest_status: t.status,
      latest_date: "2026-01-01",
      total_runs: 3,
    })),
  };
}

function makeManifest(taskId: string, avgTokens: number): TaskManifest {
  return {
    task_id: taskId,
    task_description_summary: `Task ${taskId}`,
    run_history: [
      { run: "001", status: "success", date: "2026-01-01", duration_s: 10, tokens_total: avgTokens },
    ],
    key_metrics: { pass_rate: 1, avg_tokens: avgTokens, avg_duration_s: 10 },
    artifacts_available: [],
  };
}

// ─── Tests ──────────────────────────────────────────────

describe("TokenCostAnalyzer", () => {
  describe("analyze()", () => {
    it("index 不存在時應回傳 skipped", async () => {
      const backend = createMockBackend();
      const analyzer = new TokenCostAnalyzer(backend, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(true);
      expect(result.skip_reason).toBe("insufficient_samples");
      expect(result.outliers).toHaveLength(0);
      expect(result.groups).toHaveLength(0);
    });

    it("樣本不足 min_samples 時應回傳 skipped", async () => {
      const index = makeIndex([
        { id: "T-001", tags: ["backend"], status: "success" },
      ]);
      const backend = createMockBackend({
        readFile: vi.fn(async (path: string) => {
          if (path === "index.json") return JSON.stringify(index);
          if (path.includes("manifest.json")) return JSON.stringify(makeManifest("T-001", 1000));
          return null;
        }),
      });

      const analyzer = new TokenCostAnalyzer(backend, { ...defaultConfig, min_samples: 5 });
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(true);
      expect(result.skip_reason).toBe("insufficient_samples");
      expect(result.total_tasks_scanned).toBe(1);
    });

    it("應正確分組並計算統計", async () => {
      const index = makeIndex([
        { id: "T-001", tags: ["backend"], status: "success" },
        { id: "T-002", tags: ["backend"], status: "success" },
        { id: "T-003", tags: ["backend"], status: "success" },
        { id: "T-004", tags: ["frontend"], status: "success" },
      ]);

      const manifests: Record<string, number> = {
        "T-001": 1000,
        "T-002": 1200,
        "T-003": 1100,
        "T-004": 500,
      };

      const backend = createMockBackend({
        readFile: vi.fn(async (path: string) => {
          if (path === "index.json") return JSON.stringify(index);
          for (const [id, tokens] of Object.entries(manifests)) {
            if (path === `${id}/manifest.json`) return JSON.stringify(makeManifest(id, tokens));
          }
          return null;
        }),
      });

      const analyzer = new TokenCostAnalyzer(backend, { ...defaultConfig, min_samples: 3 });
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(false);
      expect(result.total_tasks_scanned).toBe(4);
      expect(result.groups.length).toBeGreaterThanOrEqual(2);

      // backend,success 分組應有 3 個樣本
      const backendGroup = result.groups.find(
        (g) => g.group_key.tags.includes("backend") && g.group_key.quality === "success",
      );
      expect(backendGroup).toBeDefined();
      expect(backendGroup!.sample_count).toBe(3);
    });

    it("應識別超過 threshold_ratio 的異常值", async () => {
      const index = makeIndex([
        { id: "T-001", tags: ["api"], status: "success" },
        { id: "T-002", tags: ["api"], status: "success" },
        { id: "T-003", tags: ["api"], status: "success" },
        { id: "T-004", tags: ["api"], status: "success" }, // outlier
      ]);

      const manifests: Record<string, number> = {
        "T-001": 1000,
        "T-002": 1000,
        "T-003": 1000,
        "T-004": 5000, // 5x average → outlier
      };

      const backend = createMockBackend({
        readFile: vi.fn(async (path: string) => {
          if (path === "index.json") return JSON.stringify(index);
          for (const [id, tokens] of Object.entries(manifests)) {
            if (path === `${id}/manifest.json`) return JSON.stringify(makeManifest(id, tokens));
          }
          return null;
        }),
      });

      const analyzer = new TokenCostAnalyzer(backend, { ...defaultConfig, min_samples: 3, threshold_ratio: 1.5 });
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(false);
      expect(result.outliers.length).toBeGreaterThanOrEqual(1);

      const outlier = result.outliers.find((o) => o.task_id === "T-004");
      expect(outlier).toBeDefined();
      expect(outlier!.actual_tokens).toBe(5000);
      expect(outlier!.ratio).toBeGreaterThan(1.5);
      expect(outlier!.estimated_saving_pct).toBeGreaterThan(0);
    });

    it("無異常值時 outliers 應為空", async () => {
      const index = makeIndex([
        { id: "T-001", tags: ["api"], status: "success" },
        { id: "T-002", tags: ["api"], status: "success" },
        { id: "T-003", tags: ["api"], status: "success" },
      ]);

      // 所有 token 差不多
      const manifests: Record<string, number> = {
        "T-001": 1000,
        "T-002": 1050,
        "T-003": 1100,
      };

      const backend = createMockBackend({
        readFile: vi.fn(async (path: string) => {
          if (path === "index.json") return JSON.stringify(index);
          for (const [id, tokens] of Object.entries(manifests)) {
            if (path === `${id}/manifest.json`) return JSON.stringify(makeManifest(id, tokens));
          }
          return null;
        }),
      });

      const analyzer = new TokenCostAnalyzer(backend, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(false);
      expect(result.outliers).toHaveLength(0);
    });

    it("manifest 不存在的 task 應被跳過", async () => {
      const index = makeIndex([
        { id: "T-001", tags: ["api"], status: "success" },
        { id: "T-002", tags: ["api"], status: "success" },
        { id: "T-003", tags: ["api"], status: "success" },
        { id: "T-MISSING", tags: ["api"], status: "success" },
      ]);

      const backend = createMockBackend({
        readFile: vi.fn(async (path: string) => {
          if (path === "index.json") return JSON.stringify(index);
          if (path === "T-001/manifest.json") return JSON.stringify(makeManifest("T-001", 1000));
          if (path === "T-002/manifest.json") return JSON.stringify(makeManifest("T-002", 1000));
          if (path === "T-003/manifest.json") return JSON.stringify(makeManifest("T-003", 1000));
          return null; // T-MISSING returns null
        }),
      });

      const analyzer = new TokenCostAnalyzer(backend, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.total_tasks_scanned).toBe(3);
    });

    it("不同 quality 應分為不同組", async () => {
      const index = makeIndex([
        { id: "T-001", tags: ["api"], status: "success" },
        { id: "T-002", tags: ["api"], status: "success" },
        { id: "T-003", tags: ["api"], status: "success" },
        { id: "T-004", tags: ["api"], status: "failure" },
      ]);

      const manifests: Record<string, number> = {
        "T-001": 1000,
        "T-002": 1000,
        "T-003": 1000,
        "T-004": 3000, // failure group 只有一個，不算 outlier
      };

      const backend = createMockBackend({
        readFile: vi.fn(async (path: string) => {
          if (path === "index.json") return JSON.stringify(index);
          for (const [id, tokens] of Object.entries(manifests)) {
            if (path === `${id}/manifest.json`) return JSON.stringify(makeManifest(id, tokens));
          }
          return null;
        }),
      });

      const analyzer = new TokenCostAnalyzer(backend, { ...defaultConfig, min_samples: 3 });
      const result = await analyzer.analyze();

      const successGroup = result.groups.find((g) => g.group_key.quality === "success");
      const failureGroup = result.groups.find((g) => g.group_key.quality === "failure");

      expect(successGroup).toBeDefined();
      expect(successGroup!.sample_count).toBe(3);
      expect(failureGroup).toBeDefined();
      expect(failureGroup!.sample_count).toBe(1);
    });
  });
});
