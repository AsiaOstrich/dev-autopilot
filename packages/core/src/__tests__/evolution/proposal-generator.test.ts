import { describe, it, expect, vi } from "vitest";
import type { StorageBackend } from "../../execution-history/types.js";
import { ProposalGenerator, serializeProposal, parseProposal } from "../../evolution/proposal-generator.js";
import type { AnalysisResult, AnalyzerConfig, Proposal, ProposalMeta } from "../../evolution/types.js";

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

function writes(b: StorageBackend): Array<[string, string]> {
  return (b.writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string]>;
}

const baseConfig: AnalyzerConfig = {
  enabled: true,
  min_samples: 20,
  threshold_ratio: 1.5,
};

function makeAnalysisResult(opts?: Partial<AnalysisResult>): AnalysisResult {
  return {
    analyzer: "token-cost",
    timestamp: "2026-01-15T10:00:00Z",
    config: baseConfig,
    total_tasks_scanned: 25,
    groups: [
      {
        group_key: { tags: ["backend"], quality: "success" },
        sample_count: 20,
        avg_tokens: 1000,
        median_tokens: 950,
        std_dev: 200,
        min_tokens: 700,
        max_tokens: 5000,
        outlier_task_ids: ["T-005"],
      },
    ],
    outliers: [
      {
        task_id: "T-005",
        group_key: { tags: ["backend"], quality: "success" },
        actual_tokens: 5000,
        group_avg: 1000,
        ratio: 5.0,
        estimated_saving_pct: 80,
      },
    ],
    skipped: false,
    ...opts,
  };
}

// ─── Tests ──────────────────────────────────────────────

describe("ProposalGenerator", () => {
  describe("generate()", () => {
    it("skipped 分析不應產出提案", async () => {
      const backend = createMockBackend();
      const gen = new ProposalGenerator(backend, "test-project");

      const result = await gen.generate({
        ...makeAnalysisResult(),
        skipped: true,
        skip_reason: "insufficient_samples",
        outliers: [],
      });

      expect(result).toHaveLength(0);

      // 但應寫入 analysis-log
      const logWrites = writes(backend).filter(([p]) => p.includes("analysis-log"));
      expect(logWrites).toHaveLength(1);
    });

    it("無異常值時不應產出提案", async () => {
      const backend = createMockBackend();
      const gen = new ProposalGenerator(backend, "test-project");

      const result = await gen.generate({
        ...makeAnalysisResult(),
        outliers: [],
      });

      expect(result).toHaveLength(0);
    });

    it("應為每個 outlier 產生一個提案", async () => {
      const backend = createMockBackend();
      const gen = new ProposalGenerator(backend, "test-project");
      const analysis = makeAnalysisResult();

      const proposals = await gen.generate(analysis);

      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.meta.status).toBe("pending");
      expect(proposals[0]!.meta.id).toMatch(/^PROP-2026-\d{4}$/);
      expect(proposals[0]!.meta.target.project).toBe("test-project");
      expect(proposals[0]!.meta.target.file).toBe("T-005");
    });

    it("提案應寫入 proposals/ 目錄", async () => {
      const backend = createMockBackend();
      const gen = new ProposalGenerator(backend, "test-project");

      await gen.generate(makeAnalysisResult());

      const proposalWrites = writes(backend).filter(([p]) => p.startsWith("proposals/PROP-"));
      expect(proposalWrites).toHaveLength(1);
      expect(proposalWrites[0]![0]).toMatch(/^proposals\/PROP-2026-\d{4}\.md$/);
    });

    it("提案序號應遞增", async () => {
      const backend = createMockBackend({
        readFile: vi.fn(async () => null),
        writeFile: vi.fn(async () => {}),
        deleteFile: vi.fn(async () => {}),
        deleteDir: vi.fn(async () => {}),
        // 已有 2 個提案
        listDir: vi.fn(async () => ["PROP-2026-0001.md", "PROP-2026-0002.md"]),
        exists: vi.fn(async () => false),
      });

      const gen = new ProposalGenerator(backend, "test-project");
      const proposals = await gen.generate(makeAnalysisResult());

      expect(proposals[0]!.meta.id).toBe("PROP-2026-0003");
    });

    it("應寫入 analysis-log.jsonl", async () => {
      const backend = createMockBackend();
      const gen = new ProposalGenerator(backend, "test-project");

      await gen.generate(makeAnalysisResult());

      const logWrites = writes(backend).filter(([p]) => p.includes("analysis-log"));
      expect(logWrites).toHaveLength(1);

      const logEntry = JSON.parse(logWrites[0]![1]);
      expect(logEntry.analyzer).toBe("token-cost");
      expect(logEntry.status).toBe("completed");
      expect(logEntry.proposals_generated).toBe(1);
    });

    it("impact 應根據節省百分比判定", async () => {
      const backend = createMockBackend();
      const gen = new ProposalGenerator(backend, "test-project");

      // 80% saving → high impact
      const proposals = await gen.generate(makeAnalysisResult());
      expect(proposals[0]!.meta.impact).toBe("high");
    });
  });
});

describe("serializeProposal / parseProposal", () => {
  it("序列化後應可反序列化", () => {
    const meta: ProposalMeta = {
      id: "PROP-2026-0001",
      status: "pending",
      confidence: 0.75,
      impact: "high",
      target: { project: "test", file: "T-005", field: "token_usage" },
      created: "2026-01-15T10:00:00Z",
      updated: "2026-01-15T10:00:00Z",
      analysis_ref: "2026-01-15T10:00:00Z",
    };

    const proposal: Proposal = {
      meta,
      body: "## 問題描述\n\n測試內容",
    };

    const serialized = serializeProposal(proposal);
    const parsed = parseProposal(serialized);

    expect(parsed).not.toBeNull();
    expect(parsed!.meta.id).toBe("PROP-2026-0001");
    expect(parsed!.meta.status).toBe("pending");
    expect(parsed!.meta.confidence).toBe(0.75);
    expect(parsed!.meta.impact).toBe("high");
    expect(parsed!.meta.target.project).toBe("test");
  });

  it("reject_reason 應正確序列化", () => {
    const meta: ProposalMeta = {
      id: "PROP-2026-0001",
      status: "rejected",
      confidence: 0.5,
      impact: "low",
      target: { project: "test" },
      created: "2026-01-15T10:00:00Z",
      updated: "2026-01-15T10:00:00Z",
      analysis_ref: "2026-01-15T10:00:00Z",
      reject_reason: "不適用",
    };

    const proposal: Proposal = { meta, body: "test" };
    const serialized = serializeProposal(proposal);
    const parsed = parseProposal(serialized);

    expect(parsed!.meta.reject_reason).toBe("不適用");
  });

  it("無效內容應回傳 null", () => {
    expect(parseProposal("not a proposal")).toBeNull();
    expect(parseProposal("---\nno id\n---\nbody")).toBeNull();
  });
});
