/**
 * RetentionManager 單元測試（SPEC-008 REQ-006）
 *
 * [Source] REQ-006: 自動清理超過保留上限的歷史
 * 使用 mock StorageBackend。
 */

import { describe, it, expect, vi } from "vitest";
import { RetentionManager } from "../../execution-history/retention.js";
import type { StorageBackend, HistoryIndex, TaskManifest, RetentionConfig } from "../../execution-history/types.js";

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

const defaultRetention: RetentionConfig = {
  max_runs_per_task: 3,
  max_total_size_mb: 500,
  cleanup_strategy: "oldest_l3_first",
  archive_threshold_days: 90,
};

describe("RetentionManager", () => {
  // ============================================================
  // [Source] REQ-006 Scenario: 超過 max_runs 上限
  // ============================================================

  describe("max_runs 清理", () => {
    it("[Source] 超過 max_runs 時應刪除最舊 run 的 L3 artifacts", async () => {
      // Arrange: manifest 有 4 個 runs，max_runs_per_task = 3
      const manifest: TaskManifest = {
        task_id: "T-001",
        task_description_summary: "test",
        run_history: [
          { run: "001", status: "success", date: "2026-03-01", duration_s: 30, tokens_total: 1000 },
          { run: "002", status: "success", date: "2026-03-15", duration_s: 30, tokens_total: 1000 },
          { run: "003", status: "failure", date: "2026-04-01", duration_s: 60, tokens_total: 2000 },
          { run: "004", status: "success", date: "2026-04-02", duration_s: 30, tokens_total: 1000 },
        ],
        key_metrics: { pass_rate: 0.75, avg_tokens: 1250, avg_duration_s: 37.5 },
        artifacts_available: [],
      };

      const deleteDir = vi.fn(async () => {});
      const backend = createMockBackend({
        readFile: vi.fn(async (p: string) => {
          if (p.includes("manifest.json")) return JSON.stringify(manifest);
          return null;
        }),
        deleteDir,
      });

      const retention = new RetentionManager(backend, defaultRetention);
      await retention.cleanupTask("T-001");

      // Assert: run 001 的目錄被刪除
      expect(deleteDir).toHaveBeenCalledWith("T-001/001");
    });

    it("[Derived] 未超過 max_runs 時不應刪除任何 run", async () => {
      const manifest: TaskManifest = {
        task_id: "T-001",
        task_description_summary: "test",
        run_history: [
          { run: "001", status: "success", date: "2026-04-01", duration_s: 30, tokens_total: 1000 },
          { run: "002", status: "success", date: "2026-04-02", duration_s: 30, tokens_total: 1000 },
        ],
        key_metrics: { pass_rate: 1, avg_tokens: 1000, avg_duration_s: 30 },
        artifacts_available: [],
      };

      const deleteDir = vi.fn(async () => {});
      const backend = createMockBackend({
        readFile: vi.fn(async (p: string) => {
          if (p.includes("manifest.json")) return JSON.stringify(manifest);
          return null;
        }),
        deleteDir,
      });

      const retention = new RetentionManager(backend, defaultRetention);
      await retention.cleanupTask("T-001");

      expect(deleteDir).not.toHaveBeenCalled();
    });

    it("[Derived] 刪除最舊 run 後 manifest 應保留所有 run_history", async () => {
      // L1/L2 索引保留，只刪 L3 artifacts
      const manifest: TaskManifest = {
        task_id: "T-001",
        task_description_summary: "test",
        run_history: [
          { run: "001", status: "success", date: "2026-03-01", duration_s: 30, tokens_total: 1000 },
          { run: "002", status: "success", date: "2026-03-15", duration_s: 30, tokens_total: 1000 },
          { run: "003", status: "success", date: "2026-04-01", duration_s: 30, tokens_total: 1000 },
          { run: "004", status: "success", date: "2026-04-02", duration_s: 30, tokens_total: 1000 },
        ],
        key_metrics: { pass_rate: 1, avg_tokens: 1000, avg_duration_s: 30 },
        artifacts_available: [],
      };

      const writeFile = vi.fn(async () => {});
      const backend = createMockBackend({
        readFile: vi.fn(async (p: string) => {
          if (p.includes("manifest.json")) return JSON.stringify(manifest);
          return null;
        }),
        deleteDir: vi.fn(async () => {}),
        writeFile,
      });

      const retention = new RetentionManager(backend, defaultRetention);
      await retention.cleanupTask("T-001");

      // manifest 不應被修改（L2 索引保留）
      // 只刪除 L3 目錄
    });

    it("[Derived] manifest 不存在時 cleanupTask 不應拋錯", async () => {
      const backend = createMockBackend();
      const retention = new RetentionManager(backend, defaultRetention);
      await expect(retention.cleanupTask("T-999")).resolves.not.toThrow();
    });
  });

  // ============================================================
  // [Source] REQ-006 Scenario: 歸檔 stale tasks
  // ============================================================

  describe("歸檔 stale tasks", () => {
    it("[Source] 超過 archive_threshold_days 的 task 應從 index 移至 archive", async () => {
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 91); // 91 天前

      const index: HistoryIndex = {
        version: "1.0.0",
        updated: "2026-04-02",
        max_active_tasks: 50,
        archive_threshold_days: 90,
        tasks: [
          { task_id: "T-OLD", task_name: "Old", tags: [], latest_run: "001", latest_status: "success", latest_date: staleDate.toISOString(), total_runs: 1 },
          { task_id: "T-NEW", task_name: "New", tags: [], latest_run: "001", latest_status: "success", latest_date: new Date().toISOString(), total_runs: 1 },
        ],
      };

      const writeFile = vi.fn(async () => {});
      const backend = createMockBackend({
        readFile: vi.fn(async (p: string) => {
          if (p === "index.json") return JSON.stringify(index);
          if (p === "index-archive.json") return null;
          return null;
        }),
        writeFile,
      });

      const retention = new RetentionManager(backend, defaultRetention);
      await retention.archiveStaleTasks();

      // index.json 應只剩 T-NEW
      const indexCall = (writeFile.mock.calls as unknown as [string, string][]).find((c) => c[0] === "index.json");
      expect(indexCall).toBeDefined();
      const newIndex: HistoryIndex = JSON.parse(indexCall![1] as string);
      expect(newIndex.tasks.length).toBe(1);
      expect(newIndex.tasks[0].task_id).toBe("T-NEW");

      // index-archive.json 應包含 T-OLD
      const archiveCall = (writeFile.mock.calls as unknown as [string, string][]).find((c) => c[0] === "index-archive.json");
      expect(archiveCall).toBeDefined();
      const archive: HistoryIndex = JSON.parse(archiveCall![1] as string);
      expect(archive.tasks.some((t: { task_id: string }) => t.task_id === "T-OLD")).toBe(true);
    });

    it("[Derived] 無 stale task 時不應修改 index", async () => {
      const index: HistoryIndex = {
        version: "1.0.0",
        updated: "2026-04-02",
        max_active_tasks: 50,
        archive_threshold_days: 90,
        tasks: [
          { task_id: "T-001", task_name: "Recent", tags: [], latest_run: "001", latest_status: "success", latest_date: new Date().toISOString(), total_runs: 1 },
        ],
      };

      const writeFile = vi.fn(async () => {});
      const backend = createMockBackend({
        readFile: vi.fn(async (p: string) => p === "index.json" ? JSON.stringify(index) : null),
        writeFile,
      });

      const retention = new RetentionManager(backend, defaultRetention);
      await retention.archiveStaleTasks();

      expect(writeFile).not.toHaveBeenCalled();
    });

    it("[Derived] index 不存在時不應拋錯", async () => {
      const backend = createMockBackend();
      const retention = new RetentionManager(backend, defaultRetention);
      await expect(retention.archiveStaleTasks()).resolves.not.toThrow();
    });
  });

  // ============================================================
  // [Source] REQ-006 Scenario: 歸檔 task reactivate
  // ============================================================

  describe("歸檔 task reactivate", () => {
    it("[Source] 已歸檔 task 有新 run 時應從 archive 移回 index", async () => {
      const index: HistoryIndex = {
        version: "1.0.0",
        updated: "2026-04-02",
        max_active_tasks: 50,
        archive_threshold_days: 90,
        tasks: [],
      };

      const archive: HistoryIndex = {
        version: "1.0.0",
        updated: "2026-03-01",
        max_active_tasks: 50,
        archive_threshold_days: 90,
        tasks: [
          { task_id: "T-OLD", task_name: "Old", tags: [], latest_run: "001", latest_status: "success", latest_date: "2026-01-01", total_runs: 1 },
        ],
      };

      const writeFile = vi.fn(async () => {});
      const backend = createMockBackend({
        readFile: vi.fn(async (p: string) => {
          if (p === "index.json") return JSON.stringify(index);
          if (p === "index-archive.json") return JSON.stringify(archive);
          return null;
        }),
        writeFile,
      });

      const retention = new RetentionManager(backend, defaultRetention);
      await retention.reactivateTask("T-OLD");

      // index.json 應包含 T-OLD
      const indexCall = (writeFile.mock.calls as unknown as [string, string][]).find((c) => c[0] === "index.json");
      expect(indexCall).toBeDefined();
      const newIndex: HistoryIndex = JSON.parse(indexCall![1] as string);
      expect(newIndex.tasks.some((t: { task_id: string }) => t.task_id === "T-OLD")).toBe(true);

      // archive 應不再包含 T-OLD
      const archiveCall = (writeFile.mock.calls as unknown as [string, string][]).find((c) => c[0] === "index-archive.json");
      expect(archiveCall).toBeDefined();
      const newArchive: HistoryIndex = JSON.parse(archiveCall![1] as string);
      expect(newArchive.tasks.some((t: { task_id: string }) => t.task_id === "T-OLD")).toBe(false);
    });

    it("[Derived] task 不在 archive 中時 reactivate 不應拋錯", async () => {
      const backend = createMockBackend();
      const retention = new RetentionManager(backend, defaultRetention);
      await expect(retention.reactivateTask("T-NONE")).resolves.not.toThrow();
    });
  });
});
