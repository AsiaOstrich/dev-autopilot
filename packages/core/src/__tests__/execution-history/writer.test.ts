/**
 * HistoryWriter 單元測試（SPEC-008 REQ-002, REQ-003, REQ-005）
 *
 * 使用 mock StorageBackend，不碰檔案系統。
 */

import { describe, it, expect, vi } from "vitest";
import { HistoryWriter } from "../../execution-history/writer.js";
import type {
  StorageBackend,
  ExecutionHistoryConfig,
  RunContext,
  TaskManifest,
  HistoryIndex,
} from "../../execution-history/types.js";
import type { Task, TaskResult } from "../../types.js";

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

/** 從 mock 取得所有 writeFile 呼叫 */
function writes(b: StorageBackend): Array<[string, string]> {
  return (b.writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string]>;
}

/** 找 path 含 substr 的 writeFile 呼叫 */
function findWrite(b: StorageBackend, substr: string): [string, string] | undefined {
  return writes(b).find(([p]) => p.includes(substr));
}

/** 過濾 path 不含 substr 的 writeFile 呼叫 */
function filterWrites(b: StorageBackend, exclude: string[]): Array<[string, string]> {
  return writes(b).filter(([p]) => !exclude.some(e => p.includes(e)));
}

const cfg: ExecutionHistoryConfig = { enabled: true };

const task: Task = {
  id: "T-001",
  title: "實作認證模組",
  spec: "使用 bcrypt 雜湊密碼，JWT 簽發 access token",
  acceptance_criteria: ["登入成功回傳 token", "密碼錯誤回傳 401"],
};

const ok: TaskResult = {
  task_id: "T-001",
  status: "success",
  cost_usd: 0.5,
  duration_ms: 30000,
  verification_evidence: [
    { command: "pnpm test", exit_code: 0, output: "5 passed", timestamp: "2026-04-02T10:00:00Z" },
  ],
};

const fail: TaskResult = {
  task_id: "T-001",
  status: "failed",
  cost_usd: 1.2,
  duration_ms: 60000,
  error: "pnpm test exit code 1",
};

const ctx: RunContext = {
  codeDiff: "diff --git a/src/auth.ts\n+export function login() {}",
  executionLog: [{ timestamp: "2026-04-02T10:00:00Z", message: "[T-001] 開始執行" }],
};

const manifest1: TaskManifest = {
  task_id: "T-001",
  task_description_summary: "test",
  run_history: [{ run: "001", status: "success", date: "2026-04-01", duration_s: 30, tokens_total: 1000 }],
  key_metrics: { pass_rate: 1, avg_tokens: 1000, avg_duration_s: 30 },
  artifacts_available: [],
};

const manifest2: TaskManifest = {
  ...manifest1,
  run_history: [
    { run: "001", status: "success", date: "2026-04-01", duration_s: 30, tokens_total: 1000 },
    { run: "002", status: "failure", date: "2026-04-02", duration_s: 60, tokens_total: 2000 },
  ],
  key_metrics: { pass_rate: 0.5, avg_tokens: 1500, avg_duration_s: 45 },
};

describe("HistoryWriter", () => {
  // === REQ-002: 成功 task 寫入 ===

  describe("REQ-002: 成功 task 寫入 6 個 artifacts", () => {
    it("應寫入 task-description.md", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(findWrite(b, "task-description.md")).toBeDefined();
    });

    it("應寫入 code-diff.patch", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(findWrite(b, "code-diff.patch")).toBeDefined();
    });

    it("應寫入 test-results.json", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(findWrite(b, "test-results.json")).toBeDefined();
    });

    it("應寫入 execution-log.jsonl", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(findWrite(b, "execution-log.jsonl")).toBeDefined();
    });

    it("應寫入 token-usage.json", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(findWrite(b, "token-usage.json")).toBeDefined();
    });

    it("應寫入 final-status.json", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(findWrite(b, "final-status.json")).toBeDefined();
    });

    it("成功 task 應恰好寫入 6 個 artifact 檔案", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(filterWrites(b, ["manifest.json", "index.json"]).length).toBe(6);
    });
  });

  // === REQ-002: 失敗 task 額外 artifact ===

  describe("REQ-002: 失敗 task 額外 artifact", () => {
    it("失敗 task 應額外寫入 error-analysis.md", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, fail, { ...ctx, previousAttempts: [{ hypothesis: "typo", result: "still fails" }] });
      expect(findWrite(b, "error-analysis.md")).toBeDefined();
    });

    it("失敗 task 應恰好寫入 7 個 artifact 檔案", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, fail, { ...ctx, previousAttempts: [] });
      expect(filterWrites(b, ["manifest.json", "index.json"]).length).toBe(7);
    });

    it("error-analysis.md 應包含 previous_attempts 資訊", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, fail, { ...ctx, previousAttempts: [{ hypothesis: "缺少依賴", result: "npm install 後仍失敗" }] });
      const call = findWrite(b, "error-analysis.md");
      expect(call![1]).toContain("缺少依賴");
    });
  });

  // === REQ-002: Run number 遞增 ===

  describe("REQ-002: Run number 遞增", () => {
    it("首次執行的 run number 應為 001", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(writes(b).some(([p]) => p.includes("/001/"))).toBe(true);
    });

    it("已有 001 和 002 時，新 run 應為 003", async () => {
      const b = createMockBackend({
        readFile: vi.fn(async (p: string) => p.includes("manifest.json") ? JSON.stringify(manifest2) : null),
      });
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(writes(b).some(([p]) => p.includes("/003/"))).toBe(true);
    });

    it("run number 應為三位數零填充格式", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      expect(writes(b).some(([p]) => /\/\d{3}\//.test(p))).toBe(true);
    });
  });

  // === REQ-003: Manifest 更新 ===

  describe("REQ-003: Manifest 更新", () => {
    it("首次執行應建立新的 manifest.json", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      const call = findWrite(b, "manifest.json");
      expect(call).toBeDefined();
      const m: TaskManifest = JSON.parse(call![1]);
      expect(m.task_id).toBe("T-001");
      expect(m.run_history.length).toBe(1);
    });

    it("後續執行應在 run_history 中新增 entry", async () => {
      const b = createMockBackend({
        readFile: vi.fn(async (p: string) => p.includes("manifest.json") ? JSON.stringify(manifest1) : null),
      });
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      const m: TaskManifest = JSON.parse(findWrite(b, "manifest.json")![1]);
      expect(m.run_history.length).toBe(2);
    });

    it("key_metrics 應正確計算 pass_rate", async () => {
      const b = createMockBackend({
        readFile: vi.fn(async (p: string) => p.includes("manifest.json") ? JSON.stringify(manifest1) : null),
      });
      await new HistoryWriter(b, cfg).recordRun(task, fail, ctx);
      const m: TaskManifest = JSON.parse(findWrite(b, "manifest.json")![1]);
      expect(m.key_metrics.pass_rate).toBe(0.5);
    });

    it("失敗 task 的 manifest 應包含 failure_summary", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, fail, ctx);
      const m: TaskManifest = JSON.parse(findWrite(b, "manifest.json")![1]);
      expect(m.failure_summary).toBeDefined();
    });

    it("artifacts_available 應列出所有 artifact 檔名", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      const m: TaskManifest = JSON.parse(findWrite(b, "manifest.json")![1]);
      expect(m.artifacts_available).toContain("task-description.md");
      expect(m.artifacts_available).toContain("final-status.json");
    });
  });

  // === REQ-003: Index 更新 ===

  describe("REQ-003: Index 更新", () => {
    it("新 task 應在 index 中新增 entry", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      const call = writes(b).find(([p]) => p.endsWith("index.json"));
      const idx: HistoryIndex = JSON.parse(call![1]);
      expect(idx.tasks.some(t => t.task_id === "T-001")).toBe(true);
    });

    it("已存在 task 的新 run 應更新 index entry", async () => {
      const existingIndex: HistoryIndex = {
        version: "1.0.0", updated: "2026-04-01", max_active_tasks: 50, archive_threshold_days: 90,
        tasks: [{ task_id: "T-001", task_name: "test", tags: [], latest_run: "001", latest_status: "success", latest_date: "2026-04-01", total_runs: 1 }],
      };
      const b = createMockBackend({
        readFile: vi.fn(async (p: string) => {
          if (p.endsWith("index.json")) return JSON.stringify(existingIndex);
          if (p.includes("manifest.json")) return JSON.stringify(manifest1);
          return null;
        }),
      });
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      const call = writes(b).find(([p]) => p.endsWith("index.json"));
      const idx: HistoryIndex = JSON.parse(call![1]);
      expect(idx.tasks.find(t => t.task_id === "T-001")?.total_runs).toBe(2);
    });

    it("index entry 應包含正確的 latest_status", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      const call = writes(b).find(([p]) => p.endsWith("index.json"));
      const idx: HistoryIndex = JSON.parse(call![1]);
      expect(idx.tasks.find(t => t.task_id === "T-001")?.latest_status).toBe("success");
    });

    it("index 不存在時應初始化含預設值", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, ctx);
      const call = writes(b).find(([p]) => p.endsWith("index.json"));
      const idx: HistoryIndex = JSON.parse(call![1]);
      expect(idx.max_active_tasks).toBe(50);
      expect(idx.archive_threshold_days).toBe(90);
    });
  });

  // === REQ-005: 寫入前 redaction ===

  describe("REQ-005: 寫入前 redaction", () => {
    it("artifact 中的敏感資訊應被 redact", async () => {
      const b = createMockBackend();
      const sensitiveCtx: RunContext = { ...ctx, codeDiff: "diff\n+const key = 'sk-proj-abc123def456ghi789';" };
      await new HistoryWriter(b, cfg).recordRun(task, ok, sensitiveCtx);
      const call = findWrite(b, "code-diff.patch");
      expect(call![1]).toContain("[REDACTED:API_KEY]");
      expect(call![1]).not.toContain("sk-proj-");
    });

    it("manifest 中不應包含敏感資訊", async () => {
      const b = createMockBackend();
      const sensitiveTask: Task = { ...task, spec: "使用 password: secret123 連線" };
      await new HistoryWriter(b, cfg).recordRun(sensitiveTask, ok, ctx);
      const call = findWrite(b, "manifest.json");
      expect(call![1]).not.toContain("secret123");
    });
  });

  // === 邊界情況 ===

  describe("邊界情況", () => {
    it("codeDiff 為空字串時應寫入空的 code-diff.patch", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, ok, { ...ctx, codeDiff: "" });
      const call = findWrite(b, "code-diff.patch");
      expect(call).toBeDefined();
      expect(call![1]).toBe("");
    });

    it("verification_evidence 為 undefined 時應寫入 test-results.json", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, { ...ok, verification_evidence: undefined }, ctx);
      expect(findWrite(b, "test-results.json")).toBeDefined();
    });

    it("cost_usd 為 undefined 時 token-usage cost 應為 0", async () => {
      const b = createMockBackend();
      await new HistoryWriter(b, cfg).recordRun(task, { ...ok, cost_usd: undefined }, ctx);
      const call = findWrite(b, "token-usage.json");
      expect(JSON.parse(call![1]).total.cost_usd).toBe(0);
    });

    it("backend.writeFile 失敗時應拋出錯誤", async () => {
      const b = createMockBackend({
        writeFile: vi.fn(async () => { throw new Error("disk full"); }),
      });
      await expect(new HistoryWriter(b, cfg).recordRun(task, ok, ctx)).rejects.toThrow();
    });
  });
});
