import { describe, it, expect, vi } from "vitest";
import type { StorageBackend } from "../../execution-history/types.js";
import { HookEfficiencyProposalGenerator } from "../../evolution/hook-efficiency-proposal-generator.js";
import type { HookEfficiencyAnalysisResult, AnalyzerConfig } from "../../evolution/types.js";

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
  threshold_ratio: 0.2,
};

function makeAnalysisResult(
  opts?: Partial<HookEfficiencyAnalysisResult>,
): HookEfficiencyAnalysisResult {
  return {
    analyzer: "hook-efficiency",
    timestamp: "2026-04-16T10:00:00Z",
    config: baseConfig,
    total_standards_scanned: 5,
    total_executions: 80,
    issues: [
      {
        standard_id: "testing",
        executions: 20,
        pass_rate: 0.3,
        fail_count: 14,
        avg_duration_ms: 120,
        degradation_pct: 50,
      },
    ],
    skipped: false,
    confidence: "high",
    ...opts,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe("HookEfficiencyProposalGenerator", () => {
  describe("generate()", () => {
    it("skipped 分析不應產出提案（但應寫入 analysis-log）", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const result = await gen.generate({
        ...makeAnalysisResult(),
        skipped: true,
        skip_reason: "no_telemetry_data",
        issues: [],
      });

      expect(result).toHaveLength(0);

      const logWrites = writes(backend).filter(([p]) => p.includes("analysis-log"));
      expect(logWrites).toHaveLength(1);
    });

    it("無問題時不應產出提案（但應寫入 analysis-log）", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const result = await gen.generate({
        ...makeAnalysisResult(),
        issues: [],
      });

      expect(result).toHaveLength(0);

      const logWrites = writes(backend).filter(([p]) => p.includes("analysis-log"));
      expect(logWrites).toHaveLength(1);
    });

    it("應為每個 issue 產生一個提案", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult());

      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.meta.status).toBe("pending");
      expect(proposals[0]!.meta.id).toMatch(/^PROP-2026-\d{4}$/);
      expect(proposals[0]!.meta.target.project).toBe("test-project");
    });

    it("target.file 應指向對應 standard 的 yaml 路徑", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult());

      expect(proposals[0]!.meta.target.file).toBe(".standards/testing.ai.yaml");
      expect(proposals[0]!.meta.target.field).toBe("enforcement.severity");
    });

    it("提案應寫入 proposals/ 目錄", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

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
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult());

      expect(proposals[0]!.meta.id).toBe("PROP-2026-0003");
    });

    it("應寫入 analysis-log.jsonl（analyzer 為 hook-efficiency）", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      await gen.generate(makeAnalysisResult());

      const logWrites = writes(backend).filter(([p]) => p.includes("analysis-log"));
      expect(logWrites).toHaveLength(1);

      const logEntry = JSON.parse(logWrites[0]![1]);
      expect(logEntry.analyzer).toBe("hook-efficiency");
      expect(logEntry.status).toBe("completed");
      expect(logEntry.proposals_generated).toBe(1);
      expect(logEntry.outliers_found).toBe(1);
    });

    it("impact 應根據 degradation_pct 判定（≥30% → high）", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      // degradation_pct = 50 → high
      const proposals = await gen.generate(makeAnalysisResult());
      expect(proposals[0]!.meta.impact).toBe("high");
    });

    it("impact medium：degradation_pct 15–29%", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        issues: [{
          standard_id: "commit-message",
          executions: 10,
          pass_rate: 0.65,
          fail_count: 3,
          avg_duration_ms: 80,
          degradation_pct: 15,   // exactly 15 → medium
        }],
      }));
      expect(proposals[0]!.meta.impact).toBe("medium");
    });

    it("impact low：degradation_pct < 15%", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        issues: [{
          standard_id: "api-design",
          executions: 10,
          pass_rate: 0.72,
          fail_count: 2,
          avg_duration_ms: 60,
          degradation_pct: 8,    // < 15 → low
        }],
      }));
      expect(proposals[0]!.meta.impact).toBe("low");
    });

    it("多個 issues 應各產出一個提案", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        issues: [
          {
            standard_id: "testing",
            executions: 10,
            pass_rate: 0.3,
            fail_count: 7,
            avg_duration_ms: 100,
            degradation_pct: 50,
          },
          {
            standard_id: "commit-message",
            executions: 10,
            pass_rate: 0.5,
            fail_count: 5,
            avg_duration_ms: 80,
            degradation_pct: 30,
          },
        ],
      }));

      expect(proposals).toHaveLength(2);
      expect(proposals[0]!.meta.id).toBe("PROP-2026-0001");
      expect(proposals[1]!.meta.id).toBe("PROP-2026-0002");
      expect(proposals[0]!.meta.target.file).toBe(".standards/testing.ai.yaml");
      expect(proposals[1]!.meta.target.file).toBe(".standards/commit-message.ai.yaml");
    });

    it("提案 body 應包含 standard_id 和通過率資訊", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult());
      const body = proposals[0]!.body;

      expect(body).toContain("testing");
      expect(body).toContain("30%");  // pass_rate 0.3 → 30.0%
    });

    it("low confidence 分析應在提案 body 加入警示", async () => {
      const backend = createMockBackend();
      const gen = new HookEfficiencyProposalGenerator(backend, "test-project");

      const proposals = await gen.generate(makeAnalysisResult({
        confidence: "low",
        total_executions: 20,
      }));

      expect(proposals[0]!.body).toContain("LOW CONFIDENCE");
    });
  });
});
