/**
 * ManifestManager 測試（SPEC-013 REQ-013-002）
 *
 * 全部使用 mock StorageBackend，不寫入真實目錄。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ManifestManager } from "../../execution-history/manifest-manager.js";
import type { StorageBackend, HistoryIndex, ManifestL2 } from "../../execution-history/types.js";

function makeMockBackend(
  initialFiles: Record<string, string> = {},
): StorageBackend & { written: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initialFiles));
  const written = new Map<string, string>();
  return {
    written,
    readFile: vi.fn(async (path: string) => store.get(path) ?? null),
    writeFile: vi.fn(async (path: string, content: string) => {
      store.set(path, content);
      written.set(path, content);
    }),
    deleteFile: vi.fn(async () => {}),
    deleteDir: vi.fn(async () => {}),
    listDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
  };
}

describe("ManifestManager（SPEC-013）", () => {
  let backend: ReturnType<typeof makeMockBackend>;
  let mgr: ManifestManager;

  beforeEach(() => {
    backend = makeMockBackend();
    mgr = new ManifestManager(backend, 50, 90);
  });

  // ─── Run Number ──────────────────────────────────────────────────────────

  it("[AC-3] 新 task 的 getNextRunNumber 回傳 '001'", async () => {
    const run = await mgr.getNextRunNumber("new-task");
    expect(run).toBe("001");
  });

  it("[AC-3] 已有 2 個 runs 的 task 回傳 '003'", async () => {
    const manifest: ManifestL2 = {
      task_id: "t1",
      task_description_summary: "s",
      run_history: [
        { run: "001", status: "failure", date: "2026-01-01T00:00:00Z", duration_s: 10, tokens_total: 100 },
        { run: "002", status: "success", date: "2026-01-02T00:00:00Z", duration_s: 20, tokens_total: 200 },
      ],
      key_metrics: { pass_rate: 0.5, avg_tokens: 150, avg_duration_s: 15 },
      artifacts_available: [],
    };
    backend = makeMockBackend({ "t1/manifest.json": JSON.stringify(manifest) });
    mgr = new ManifestManager(backend);
    expect(await mgr.getNextRunNumber("t1")).toBe("003");
  });

  // ─── L2 Manifest ─────────────────────────────────────────────────────────

  it("[AC-1] updateL2 建立新的 manifest.json", async () => {
    await mgr.updateL2(
      "task-a",
      { run: "001", status: "success", date: "2026-04-01T00:00:00Z", duration_s: 10, tokens_total: 500 },
      "Task A",
      ["task-description", "final-status"],
    );
    const raw = backend.written.get("task-a/manifest.json");
    expect(raw).toBeTruthy();
    const manifest = JSON.parse(raw!) as ManifestL2;
    expect(manifest.task_id).toBe("task-a");
    expect(manifest.run_history).toHaveLength(1);
    expect(manifest.run_history[0].run).toBe("001");
  });

  it("[AC-1] updateL2 累加 run_history（不覆蓋）", async () => {
    const existingManifest: ManifestL2 = {
      task_id: "task-b",
      task_description_summary: "Task B",
      run_history: [
        { run: "001", status: "failure", date: "2026-01-01T00:00:00Z", duration_s: 5, tokens_total: 100 },
      ],
      key_metrics: { pass_rate: 0, avg_tokens: 100, avg_duration_s: 5 },
      artifacts_available: [],
    };
    backend = makeMockBackend({ "task-b/manifest.json": JSON.stringify(existingManifest) });
    mgr = new ManifestManager(backend);

    await mgr.updateL2(
      "task-b",
      { run: "002", status: "success", date: "2026-04-01T00:00:00Z", duration_s: 10, tokens_total: 200 },
      "Task B",
      ["final-status"],
    );

    const raw = backend.written.get("task-b/manifest.json");
    const manifest = JSON.parse(raw!) as ManifestL2;
    expect(manifest.run_history).toHaveLength(2);
    expect(manifest.key_metrics.pass_rate).toBe(0.5);
  });

  // ─── L1 Index ────────────────────────────────────────────────────────────

  it("[AC-1] updateL1 建立新的 index.json", async () => {
    await mgr.updateL1("task-x", "Task X", ["feat"], {
      latest_run: "001",
      latest_status: "success",
      latest_date: "2026-04-01T00:00:00Z",
      total_runs: 1,
    });
    const raw = backend.written.get("index.json");
    const index = JSON.parse(raw!) as HistoryIndex;
    expect(index.tasks).toHaveLength(1);
    expect(index.tasks[0].task_id).toBe("task-x");
    expect(index.tasks[0].tags).toEqual(["feat"]);
  });

  it("[AC-4] index.json 超過 50 個 tasks 時，最舊的移至 index-archive.json", async () => {
    // 建立含 50 個 task 的 index
    const tasks = Array.from({ length: 50 }, (_, i) => ({
      task_id: `task-${i}`,
      task_name: `Task ${i}`,
      tags: [],
      latest_run: "001",
      latest_status: "success" as const,
      // task-0 最舊
      latest_date: new Date(Date.now() - (50 - i) * 24 * 60 * 60 * 1000).toISOString(),
      total_runs: 1,
    }));
    const index: HistoryIndex = {
      version: "1.0.0",
      updated: new Date().toISOString(),
      max_active_tasks: 50,
      archive_threshold_days: 90,
      tasks,
    };
    backend = makeMockBackend({ "index.json": JSON.stringify(index) });
    mgr = new ManifestManager(backend, 50, 90);

    // 新增第 51 個 task
    await mgr.updateL1("task-new", "Task New", [], {
      latest_run: "001",
      latest_status: "success",
      latest_date: new Date().toISOString(),
      total_runs: 1,
    });

    const indexRaw = backend.written.get("index.json");
    const newIndex = JSON.parse(indexRaw!) as HistoryIndex;
    const archiveRaw = backend.written.get("index-archive.json");
    const archive = JSON.parse(archiveRaw!) as HistoryIndex;

    expect(newIndex.tasks).toHaveLength(50);
    expect(archive.tasks.some(t => t.task_id === "task-0")).toBe(true);
    expect(newIndex.tasks.some(t => t.task_id === "task-new")).toBe(true);
  });

  // ─── Archive / Reactivate ────────────────────────────────────────────────

  it("[AC-5] archiveStaleTasks 將超過 90 天的 task 移至 archive", async () => {
    const staleDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const freshDate = new Date().toISOString();
    const index: HistoryIndex = {
      version: "1.0.0",
      updated: freshDate,
      max_active_tasks: 50,
      archive_threshold_days: 90,
      tasks: [
        { task_id: "stale-task", task_name: "Stale", tags: [], latest_run: "001", latest_status: "success", latest_date: staleDate, total_runs: 1 },
        { task_id: "fresh-task", task_name: "Fresh", tags: [], latest_run: "001", latest_status: "success", latest_date: freshDate, total_runs: 1 },
      ],
    };
    backend = makeMockBackend({ "index.json": JSON.stringify(index) });
    mgr = new ManifestManager(backend, 50, 90);

    await mgr.archiveStaleTasks();

    const newIndex = JSON.parse(backend.written.get("index.json")!) as HistoryIndex;
    const archive = JSON.parse(backend.written.get("index-archive.json")!) as HistoryIndex;

    expect(newIndex.tasks.map(t => t.task_id)).not.toContain("stale-task");
    expect(archive.tasks.map(t => t.task_id)).toContain("stale-task");
    expect(newIndex.tasks.map(t => t.task_id)).toContain("fresh-task");
  });

  it("[AC-6] reactivateTask 將 archive 中的 task 移回 active index", async () => {
    const archive: HistoryIndex = {
      version: "1.0.0",
      updated: new Date().toISOString(),
      max_active_tasks: 50,
      archive_threshold_days: 90,
      tasks: [
        { task_id: "archived-task", task_name: "Archived", tags: [], latest_run: "001", latest_status: "failure", latest_date: "2025-01-01T00:00:00Z", total_runs: 1 },
      ],
    };
    backend = makeMockBackend({ "index-archive.json": JSON.stringify(archive) });
    mgr = new ManifestManager(backend, 50, 90);

    await mgr.reactivateTask("archived-task");

    const newIndex = JSON.parse(backend.written.get("index.json")!) as HistoryIndex;
    const newArchive = JSON.parse(backend.written.get("index-archive.json")!) as HistoryIndex;

    expect(newIndex.tasks.map(t => t.task_id)).toContain("archived-task");
    expect(newArchive.tasks.map(t => t.task_id)).not.toContain("archived-task");
  });

  it("[AC-6] reactivateTask 對不在 archive 的 task 不做任何事", async () => {
    // 空 archive
    backend = makeMockBackend({});
    mgr = new ManifestManager(backend, 50, 90);

    // 不應拋錯
    await expect(mgr.reactivateTask("non-existent")).resolves.toBeUndefined();
    // 不應寫入 index.json
    expect(backend.written.has("index.json")).toBe(false);
  });
});
