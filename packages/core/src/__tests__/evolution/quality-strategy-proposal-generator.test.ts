import { describe, it, expect, vi } from "vitest";
import type { StorageBackend } from "../../execution-history/types.js";
import { QualityStrategyProposalGenerator } from "../../evolution/quality-strategy-proposal-generator.js";
import type { QualityStrategyAnalysisResult, AnalyzerConfig } from "../../evolution/types.js";

// ─── Helpers ────────────────────────────────────────────────

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

function writes(b: StorageBackend): Array<[string, string]> {
  return (b.writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string]>;
}

const baseConfig: AnalyzerConfig = {
  enabled: true,
  min_samples: 5,
  threshold_ratio: 1.5,
};

function makeAnalysisResult(
  opts?: Partial<QualityStrategyAnalysisResult>,
): QualityStrategyAnalysisResult {
  return {
    analyzer: "quality-strategy",
    timestamp: "2026-04-16T10:00:00Z",
    config: baseConfig,
    total_groups_scanned: 2,
    total_tasks_scanned: 10,
    issues: [
      {
        tag_group: ["docs"],
        signal: "over_provisioned",
        task_count: 5,
        avg_pass_rate: 0.98,
        avg_tokens: 50000,
        global_median_tokens: 20000,
        severity_pct: 150,
        suggested_action: "考慮降低品質等級",
      },
    ],
    skipped: false,
    confidence: "high",
    ...opts,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe("QualityStrategyProposalGenerator", () => {
  describe("generate()", () => {
    it("skipped 分析不應產出提案（但應寫入 analysis-log）", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const result = await gen.generate({
        ...makeAnalysisResult(),
        skipped: true,
        skip_reason: "insufficient_samples",
        issues: [],
      });

      expect(result).toHaveLength(0);
      const logWrites = writes(backend).filter(([p]) => p.includes("analysis-log"));
      expect(logWrites).toHaveLength(1);
    });

    it("無問題時不應產出提案（但應寫入 analysis-log）", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const result = await gen.generate({ ...makeAnalysisResult(), issues: [] });

      expect(result).toHaveLength(0);
      const logWrites = writes(backend).filter(([p]) => p.includes("analysis-log"));
      expect(logWrites).toHaveLength(1);
    });

    it("應為每個 issue 產生一個提案", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult());

      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.meta.status).toBe("pending");
      expect(proposals[0]!.meta.id).toMatch(/^PROP-2026-\d{4}$/);
      expect(proposals[0]!.meta.target.project).toBe("test-project");
    });

    it("target.field 應為 quality_profile", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult());

      expect(proposals[0]!.meta.target.field).toBe("quality_profile");
    });

    it("提案應寫入 proposals/ 目錄", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      await gen.generate(makeAnalysisResult());

      const proposalWrites = writes(backend).filter(([p]) => p.startsWith("proposals/PROP-"));
      expect(proposalWrites).toHaveLength(1);
      expect(proposalWrites[0]![0]).toMatch(/^proposals\/PROP-2026-\d{4}\.md$/);
    });

    it("提案序號應從現有提案之後遞增", async () => {
      const backend = createMockBackend({
        readFile: vi.fn(async () => null),
        writeFile: vi.fn(async () => {}),
        deleteFile: vi.fn(async () => {}),
        deleteDir: vi.fn(async () => {}),
        listDir: vi.fn(async () => ["PROP-2026-0001.md", "PROP-2026-0002.md"]),
        exists: vi.fn(async () => false),
      });
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult());

      expect(proposals[0]!.meta.id).toBe("PROP-2026-0003");
    });

    it("應寫入 analysis-log.jsonl（analyzer 為 quality-strategy）", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      await gen.generate(makeAnalysisResult());

      const logWrites = writes(backend).filter(([p]) => p.includes("analysis-log"));
      expect(logWrites).toHaveLength(1);

      const logEntry = JSON.parse(logWrites[0]![1]);
      expect(logEntry.analyzer).toBe("quality-strategy");
      expect(logEntry.status).toBe("completed");
      expect(logEntry.proposals_generated).toBe(1);
      expect(logEntry.outliers_found).toBe(1);
    });

    it("impact 應根據 severity_pct 判定（≥30% → high）", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      // severity_pct = 150 → high
      const proposals = await gen.generate(makeAnalysisResult());
      expect(proposals[0]!.meta.impact).toBe("high");
    });

    it("impact medium：severity_pct 15–29%", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        issues: [{
          tag_group: ["feat"],
          signal: "under_performing",
          task_count: 5,
          avg_pass_rate: 0.55,
          avg_tokens: 10000,
          global_median_tokens: 10000,
          severity_pct: 15,
          suggested_action: "評估提升品質等級",
        }],
      }));
      expect(proposals[0]!.meta.impact).toBe("medium");
    });

    it("impact low：severity_pct < 15%", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        issues: [{
          tag_group: ["bugfix"],
          signal: "under_performing",
          task_count: 5,
          avg_pass_rate: 0.62,
          avg_tokens: 10000,
          global_median_tokens: 10000,
          severity_pct: 8,
          suggested_action: "評估提升品質等級",
        }],
      }));
      expect(proposals[0]!.meta.impact).toBe("low");
    });

    it("多個 issues 應各產出一個提案（序號遞增）", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        issues: [
          {
            tag_group: ["docs"],
            signal: "over_provisioned",
            task_count: 5,
            avg_pass_rate: 0.98,
            avg_tokens: 50000,
            global_median_tokens: 20000,
            severity_pct: 150,
            suggested_action: "降低品質等級",
          },
          {
            tag_group: ["bugfix"],
            signal: "under_performing",
            task_count: 5,
            avg_pass_rate: 0.4,
            avg_tokens: 10000,
            global_median_tokens: 20000,
            severity_pct: 30,
            suggested_action: "提升品質等級",
          },
        ],
      }));

      expect(proposals).toHaveLength(2);
      expect(proposals[0]!.meta.id).toBe("PROP-2026-0001");
      expect(proposals[1]!.meta.id).toBe("PROP-2026-0002");
    });

    it("over_provisioned 提案 body 應包含 tag 和通過率資訊", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult());
      const body = proposals[0]!.body;

      expect(body).toContain("docs");
      expect(body).toContain("98%");   // avg_pass_rate 0.98 → 98.0%
    });

    it("under_performing 提案 body 應包含 under_performing 相關說明", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        issues: [{
          tag_group: ["api"],
          signal: "under_performing",
          task_count: 5,
          avg_pass_rate: 0.35,
          avg_tokens: 10000,
          global_median_tokens: 10000,
          severity_pct: 35,
          suggested_action: "提升品質等級",
        }],
      }));
      const body = proposals[0]!.body;

      expect(body).toContain("api");
      expect(body).toContain("35%");  // avg_pass_rate 0.35 → 35.0%
    });

    it("low confidence 分析應在提案 body 加入警示", async () => {
      const backend = createMockBackend();
      const gen = new QualityStrategyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        confidence: "low",
        total_tasks_scanned: 8,
      }));

      expect(proposals[0]!.body).toContain("LOW CONFIDENCE");
    });
  });
});
