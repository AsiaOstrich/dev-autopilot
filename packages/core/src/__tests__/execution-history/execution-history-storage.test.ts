/**
 * ExecutionHistoryManager + AccessReader + StorageRetentionManager 整合測試（SPEC-013）
 *
 * 全部使用 mock StorageBackend，不寫入真實目錄。
 * 透過 mock LocalStorageBackend 的 constructor 注入 in-memory store。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccessReader } from "../../execution-history/access-reader.js";
import { StorageRetentionManager } from "../../execution-history/retention-manager.js";
import type {
  StorageBackend,
  HistoryIndex,
  ManifestL2,
  ArtifactType,
} from "../../execution-history/types.js";

// ─── Mock Backend Factory ─────────────────────────────────────────────────────

function makeMockBackend(
  initialFiles: Record<string, string> = {},
): StorageBackend & { written: Map<string, string>; deleted: string[] } {
  const store = new Map<string, string>(Object.entries(initialFiles));
  const written = new Map<string, string>();
  const deleted: string[] = [];
  return {
    written,
    deleted,
    readFile: vi.fn(async (path: string) => store.get(path) ?? null),
    writeFile: vi.fn(async (path: string, content: string) => {
      store.set(path, content);
      written.set(path, content);
    }),
    deleteFile: vi.fn(async (path: string) => {
      store.delete(path);
      deleted.push(path);
    }),
    deleteDir: vi.fn(async (path: string) => {
      deleted.push(path);
      // 刪除 store 中以此 path 開頭的所有 key
      for (const key of store.keys()) {
        if (key.startsWith(path)) store.delete(key);
      }
    }),
    listDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
  };
}

// ─── AccessReader Tests ───────────────────────────────────────────────────────

describe("AccessReader（SPEC-013 REQ-013-003）", () => {
  it("[AC-3-L1] readL1 在 index.json 不存在時回傳 null", async () => {
    const reader = new AccessReader(makeMockBackend());
    expect(await reader.readL1()).toBeNull();
  });

  it("[AC-3-L1] readL1 成功回傳 HistoryIndex", async () => {
    const index: HistoryIndex = {
      version: "1.0.0",
      updated: "2026-04-01T00:00:00Z",
      max_active_tasks: 50,
      archive_threshold_days: 90,
      tasks: [
        { task_id: "t1", task_name: "Task 1", tags: ["feat"], latest_run: "001", latest_status: "success", latest_date: "2026-04-01", total_runs: 1 },
      ],
    };
    const reader = new AccessReader(makeMockBackend({ "index.json": JSON.stringify(index) }));
    const result = await reader.readL1();
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0].task_id).toBe("t1");
  });

  it("[AC-3-L2] readL2 在 manifest.json 不存在時回傳 null", async () => {
    const reader = new AccessReader(makeMockBackend());
    expect(await reader.readL2("unknown-task")).toBeNull();
  });

  it("[AC-3-L2] readL2 成功回傳 ManifestL2", async () => {
    const manifest: ManifestL2 = {
      task_id: "t1",
      task_description_summary: "Task 1 summary",
      run_history: [{ run: "001", status: "success", date: "2026-04-01T00:00:00Z", duration_s: 10, tokens_total: 500 }],
      key_metrics: { pass_rate: 1, avg_tokens: 500, avg_duration_s: 10 },
      artifacts_available: ["task-description", "final-status"],
    };
    const reader = new AccessReader(makeMockBackend({ "t1/manifest.json": JSON.stringify(manifest) }));
    const result = await reader.readL2("t1");
    expect(result).not.toBeNull();
    expect(result!.task_id).toBe("t1");
    expect(result!.run_history).toHaveLength(1);
  });

  it("[AC-3-L3] readL3 回傳 artifact 原始字串", async () => {
    const content = "# Task Description\nThis is a task.";
    const reader = new AccessReader(
      makeMockBackend({ "t1/001/task-description.md": content }),
    );
    const result = await reader.readL3("t1", "001", "task-description" as ArtifactType);
    expect(result).toBe(content);
  });

  it("[AC-3-L3] readL3 在 artifact 不存在時回傳 null", async () => {
    const reader = new AccessReader(makeMockBackend());
    expect(await reader.readL3("t1", "001", "code-diff" as ArtifactType)).toBeNull();
  });

  it("[AC-3-L3] readL3 使用正確的副檔名（execution-log → .jsonl）", async () => {
    const logContent = '{"timestamp":"2026-04-01","message":"done"}';
    const reader = new AccessReader(
      makeMockBackend({ "t1/001/execution-log.jsonl": logContent }),
    );
    const result = await reader.readL3("t1", "001", "execution-log" as ArtifactType);
    expect(result).toBe(logContent);
  });
});

// ─── StorageRetentionManager Tests ───────────────────────────────────────────

describe("StorageRetentionManager（SPEC-013 REQ-013-004）", () => {
  it("[AC-7] 未超過 max_runs 時不刪除任何 L3", async () => {
    const manifest: ManifestL2 = {
      task_id: "t1",
      task_description_summary: "s",
      run_history: [
        { run: "001", status: "success", date: "2026-01-01T00:00:00Z", duration_s: 5, tokens_total: 100 },
        { run: "002", status: "success", date: "2026-01-02T00:00:00Z", duration_s: 5, tokens_total: 100 },
      ],
      key_metrics: { pass_rate: 1, avg_tokens: 100, avg_duration_s: 5 },
      artifacts_available: [],
    };
    const backend = makeMockBackend({ "t1/manifest.json": JSON.stringify(manifest) });
    const retention = new StorageRetentionManager(backend, { max_runs_per_task: 3 });
    await retention.enforce("t1");
    expect(backend.deleted).toHaveLength(0);
  });

  it("[AC-7] 超過 max_runs 時刪除最舊 run 的 L3 目錄", async () => {
    const manifest: ManifestL2 = {
      task_id: "t1",
      task_description_summary: "s",
      run_history: [
        { run: "001", status: "success", date: "2026-01-01T00:00:00Z", duration_s: 5, tokens_total: 100 },
        { run: "002", status: "success", date: "2026-01-02T00:00:00Z", duration_s: 5, tokens_total: 100 },
        { run: "003", status: "success", date: "2026-01-03T00:00:00Z", duration_s: 5, tokens_total: 100 },
        { run: "004", status: "success", date: "2026-01-04T00:00:00Z", duration_s: 5, tokens_total: 100 },
      ],
      key_metrics: { pass_rate: 1, avg_tokens: 100, avg_duration_s: 5 },
      artifacts_available: [],
    };
    const backend = makeMockBackend({ "t1/manifest.json": JSON.stringify(manifest) });
    const retention = new StorageRetentionManager(backend, { max_runs_per_task: 3 });
    await retention.enforce("t1");
    // 超出 1 個，刪除最舊的 run 001
    expect(backend.deleted).toContain("t1/001");
    expect(backend.deleted).not.toContain("t1/002");
  });

  it("[AC-7] 超過多個時刪除多個最舊 L3 目錄", async () => {
    const manifest: ManifestL2 = {
      task_id: "t1",
      task_description_summary: "s",
      run_history: [
        { run: "001", status: "success", date: "2026-01-01T00:00:00Z", duration_s: 5, tokens_total: 100 },
        { run: "002", status: "success", date: "2026-01-02T00:00:00Z", duration_s: 5, tokens_total: 100 },
        { run: "003", status: "success", date: "2026-01-03T00:00:00Z", duration_s: 5, tokens_total: 100 },
        { run: "004", status: "success", date: "2026-01-04T00:00:00Z", duration_s: 5, tokens_total: 100 },
        { run: "005", status: "success", date: "2026-01-05T00:00:00Z", duration_s: 5, tokens_total: 100 },
      ],
      key_metrics: { pass_rate: 1, avg_tokens: 100, avg_duration_s: 5 },
      artifacts_available: [],
    };
    const backend = makeMockBackend({ "t1/manifest.json": JSON.stringify(manifest) });
    const retention = new StorageRetentionManager(backend, { max_runs_per_task: 3 });
    await retention.enforce("t1");
    // 超出 2 個，刪除 001 和 002
    expect(backend.deleted).toContain("t1/001");
    expect(backend.deleted).toContain("t1/002");
    expect(backend.deleted).not.toContain("t1/003");
  });

  it("[AC-7] task 不存在時 enforce 不拋錯", async () => {
    const backend = makeMockBackend();
    const retention = new StorageRetentionManager(backend, { max_runs_per_task: 3 });
    await expect(retention.enforce("non-existent")).resolves.toBeUndefined();
  });

  it("[AC-7] 預設 max_runs_per_task 為 50", async () => {
    const runs = Array.from({ length: 51 }, (_, i) => ({
      run: String(i + 1).padStart(3, "0"),
      status: "success" as const,
      date: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      duration_s: 5,
      tokens_total: 100,
    }));
    const manifest: ManifestL2 = {
      task_id: "t1",
      task_description_summary: "s",
      run_history: runs,
      key_metrics: { pass_rate: 1, avg_tokens: 100, avg_duration_s: 5 },
      artifacts_available: [],
    };
    const backend = makeMockBackend({ "t1/manifest.json": JSON.stringify(manifest) });
    const retention = new StorageRetentionManager(backend); // no policy → default 50
    await retention.enforce("t1");
    expect(backend.deleted).toContain("t1/001");
    expect(backend.deleted).toHaveLength(1);
  });
});
