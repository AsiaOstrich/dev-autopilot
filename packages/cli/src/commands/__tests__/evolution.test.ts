/**
 * XSPEC-004: devap evolution 命令測試
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  executeEvolutionAnalyze,
  executeEvolutionList,
  executeEvolutionApprove,
  executeEvolutionReject,
} from "../evolution.js";

// ─── 測試環境 ────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), `devap-evolution-test-${Date.now()}`);

async function setupTestDir(): Promise<void> {
  await mkdir(join(TEST_DIR, ".evolution", "proposals"), { recursive: true });
  await mkdir(join(TEST_DIR, ".evolution", "history"), { recursive: true });
  await mkdir(join(TEST_DIR, ".execution-history"), { recursive: true });
  await mkdir(join(TEST_DIR, ".standards"), { recursive: true });
}

async function writeTelemetry(
  events: Array<{ standard_id: string; passed: boolean; duration_ms: number }>,
): Promise<void> {
  const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(join(TEST_DIR, ".standards", "telemetry.jsonl"), content);
}

/** 建立假 pending 提案檔案 */
async function writeFakeProposal(id: string, status = "pending"): Promise<void> {
  const content = [
    `---`,
    `id: "${id}"`,
    `status: "${status}"`,
    `confidence: 0.7`,
    `impact: "medium"`,
    `target:`,
    `  project: "devap"`,
    `  file: ".standards/testing.ai.yaml"`,
    `created: "2026-04-16T00:00:00.000Z"`,
    `updated: "2026-04-16T00:00:00.000Z"`,
    `analysis_ref: "2026-04-16T00:00:00.000Z"`,
    `---`,
    ``,
    `# ${id}: Hook 效率問題`,
    ``,
    `## 問題描述`,
    ``,
    `測試提案內容。`,
  ].join("\n");
  await writeFile(join(TEST_DIR, ".evolution", "proposals", `${id}.md`), content);
}

// ─── Tests ──────────────────────────────────────────────────

describe("devap evolution", () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  // ── analyze ──────────────────────────────────────────────

  describe("executeEvolutionAnalyze()", () => {
    it("無 telemetry.jsonl 時 hook analyzer 應跳過（不拋錯）", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await expect(
        executeEvolutionAnalyze({ cwd: TEST_DIR, project: "test-proj" }),
      ).resolves.not.toThrow();
      consoleSpy.mockRestore();
    });

    it("有低通過率 hook 時應產生提案", async () => {
      // std-A: 2/10 pass = 0.2 pass_rate → issue
      await writeTelemetry([
        ...Array.from({ length: 2 }, () => ({ standard_id: "std-A", passed: true,  duration_ms: 80 })),
        ...Array.from({ length: 8 }, () => ({ standard_id: "std-A", passed: false, duration_ms: 120 })),
      ]);

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });

      await executeEvolutionAnalyze({ cwd: TEST_DIR, project: "test-proj" });
      consoleSpy.mockRestore();

      // 應有提案產生的訊息
      const hasProposalLine = logs.some((l) => l.includes("PROP-") || l.includes("產生"));
      expect(hasProposalLine).toBe(true);
    });

    it("全部 pass 時不產生提案", async () => {
      await writeTelemetry(
        Array.from({ length: 10 }, () => ({ standard_id: "std-A", passed: true, duration_ms: 50 })),
      );

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });

      await executeEvolutionAnalyze({ cwd: TEST_DIR, project: "test-proj" });
      consoleSpy.mockRestore();

      const noProposalLine = logs.some((l) => l.includes("無需改進的提案"));
      expect(noProposalLine).toBe(true);
    });

    it("config.yaml enabled:false 時應跳過分析", async () => {
      await mkdir(join(TEST_DIR, ".evolution"), { recursive: true });
      await writeFile(
        join(TEST_DIR, ".evolution", "config.yaml"),
        "enabled: false\n",
      );

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });

      await executeEvolutionAnalyze({ cwd: TEST_DIR });
      consoleSpy.mockRestore();

      expect(logs.some((l) => l.includes("未啟用"))).toBe(true);
    });
  });

  // ── list ─────────────────────────────────────────────────

  describe("executeEvolutionList()", () => {
    it("無提案時輸出提示訊息", async () => {
      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });

      await executeEvolutionList({ cwd: TEST_DIR });
      consoleSpy.mockRestore();

      expect(logs.some((l) => l.includes("沒有提案"))).toBe(true);
    });

    it("有提案時應列出 id 與狀態", async () => {
      await writeFakeProposal("PROP-2026-0001", "pending");

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });

      await executeEvolutionList({ cwd: TEST_DIR });
      consoleSpy.mockRestore();

      expect(logs.some((l) => l.includes("PROP-2026-0001"))).toBe(true);
    });

    it("--status 過濾應只顯示對應狀態", async () => {
      await writeFakeProposal("PROP-2026-0001", "pending");
      await writeFakeProposal("PROP-2026-0002", "approved");

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });

      await executeEvolutionList({ cwd: TEST_DIR, status: "approved" });
      consoleSpy.mockRestore();

      expect(logs.some((l) => l.includes("PROP-2026-0002"))).toBe(true);
      expect(logs.some((l) => l.includes("PROP-2026-0001"))).toBe(false);
    });
  });

  // ── approve ──────────────────────────────────────────────

  describe("executeEvolutionApprove()", () => {
    it("成功核准 pending 提案", async () => {
      await writeFakeProposal("PROP-2026-0001", "pending");

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });

      await executeEvolutionApprove("PROP-2026-0001", { cwd: TEST_DIR });
      consoleSpy.mockRestore();

      expect(logs.some((l) => l.includes("已核准"))).toBe(true);
    });

    it("不存在的提案應輸出錯誤", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await executeEvolutionApprove("PROP-2026-9999", { cwd: TEST_DIR });

      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  // ── reject ───────────────────────────────────────────────

  describe("executeEvolutionReject()", () => {
    it("成功駁回 pending 提案", async () => {
      await writeFakeProposal("PROP-2026-0001", "pending");

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });

      await executeEvolutionReject("PROP-2026-0001", {
        cwd: TEST_DIR,
        reason: "風險太高，先觀察",
      });
      consoleSpy.mockRestore();

      expect(logs.some((l) => l.includes("已拒絕"))).toBe(true);
    });
  });
});
