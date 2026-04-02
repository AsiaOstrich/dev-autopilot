/**
 * HistoryReader 單元測試（SPEC-008 REQ-004）
 *
 * [Source] REQ-004: L1/L2/L3 分層讀取 API
 * 使用 mock StorageBackend。
 */

import { describe, it, expect, vi } from "vitest";
import { HistoryReader } from "../../execution-history/reader.js";
import type { StorageBackend, HistoryIndex, TaskManifest } from "../../execution-history/types.js";

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

const sampleIndex: HistoryIndex = {
  version: "1.0.0",
  updated: "2026-04-02T10:00:00Z",
  max_active_tasks: 50,
  archive_threshold_days: 90,
  tasks: [
    { task_id: "T-001", task_name: "Auth", tags: [], latest_run: "002", latest_status: "success", latest_date: "2026-04-02", total_runs: 2 },
    { task_id: "T-002", task_name: "DB", tags: [], latest_run: "001", latest_status: "failure", latest_date: "2026-04-01", total_runs: 1 },
  ],
};

const sampleManifest: TaskManifest = {
  task_id: "T-001",
  task_description_summary: "Auth module",
  run_history: [
    { run: "001", status: "failure", date: "2026-04-01", duration_s: 60, tokens_total: 2000 },
    { run: "002", status: "success", date: "2026-04-02", duration_s: 30, tokens_total: 1000 },
  ],
  key_metrics: { pass_rate: 0.5, avg_tokens: 1500, avg_duration_s: 45 },
  artifacts_available: ["task-description.md", "final-status.json"],
};

describe("HistoryReader", () => {
  // ============================================================
  // [Source] REQ-004 Scenario: L1 快速篩選
  // ============================================================

  describe("L1: readIndex()", () => {
    it("[Source] 應回傳 HistoryIndex 物件", async () => {
      const backend = createMockBackend({
        readFile: vi.fn(async () => JSON.stringify(sampleIndex)),
      });
      const reader = new HistoryReader(backend);
      const index = await reader.readIndex();
      expect(index).not.toBeNull();
      expect(index!.tasks.length).toBe(2);
    });

    it("[Derived] index 不存在時應回傳 null", async () => {
      const backend = createMockBackend();
      const reader = new HistoryReader(backend);
      const index = await reader.readIndex();
      expect(index).toBeNull();
    });

    it("[Derived] index JSON 損毀時應回傳 null", async () => {
      const backend = createMockBackend({
        readFile: vi.fn(async () => "not json"),
      });
      const reader = new HistoryReader(backend);
      const index = await reader.readIndex();
      expect(index).toBeNull();
    });
  });

  // ============================================================
  // [Source] REQ-004 Scenario: L2 任務摘要
  // ============================================================

  describe("L2: readTaskManifest()", () => {
    it("[Source] 應回傳 TaskManifest 物件", async () => {
      const backend = createMockBackend({
        readFile: vi.fn(async () => JSON.stringify(sampleManifest)),
      });
      const reader = new HistoryReader(backend);
      const manifest = await reader.readTaskManifest("T-001");
      expect(manifest).not.toBeNull();
      expect(manifest!.task_id).toBe("T-001");
      expect(manifest!.run_history.length).toBe(2);
    });

    it("[Derived] task 不存在時應回傳 null", async () => {
      const backend = createMockBackend();
      const reader = new HistoryReader(backend);
      const manifest = await reader.readTaskManifest("T-999");
      expect(manifest).toBeNull();
    });

    it("[Derived] 應從正確路徑讀取 manifest", async () => {
      const readFile = vi.fn(async () => null);
      const backend = createMockBackend({ readFile });
      const reader = new HistoryReader(backend);
      await reader.readTaskManifest("T-001");
      expect(readFile).toHaveBeenCalledWith("T-001/manifest.json");
    });
  });

  // ============================================================
  // [Source] REQ-004 Scenario: L3 完整 artifact
  // ============================================================

  describe("L3: readArtifact()", () => {
    it("[Source] 應回傳 artifact 原始內容", async () => {
      const backend = createMockBackend({
        readFile: vi.fn(async () => "diff --git a/src/auth.ts"),
      });
      const reader = new HistoryReader(backend);
      const content = await reader.readArtifact("T-001", "002", "code-diff.patch");
      expect(content).toBe("diff --git a/src/auth.ts");
    });

    it("[Derived] artifact 不存在時應回傳 null", async () => {
      const backend = createMockBackend();
      const reader = new HistoryReader(backend);
      const content = await reader.readArtifact("T-001", "002", "nonexistent.txt");
      expect(content).toBeNull();
    });

    it("[Derived] 應從正確路徑讀取 artifact", async () => {
      const readFile = vi.fn(async () => null);
      const backend = createMockBackend({ readFile });
      const reader = new HistoryReader(backend);
      await reader.readArtifact("T-001", "002", "final-status.json");
      expect(readFile).toHaveBeenCalledWith("T-001/002/final-status.json");
    });
  });
});
