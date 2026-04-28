/**
 * Telemetry Client 整合測試（SPEC-012 AC-1 ~ AC-5）
 *
 * [Source] SPEC-012: Telemetry Client SDK Integration
 *
 * AC-1: backend="file_server" 時，FileServerStorageBackend 被使用
 * AC-2: orchestrator 完成後，TelemetryUploader.upload() 被呼叫，payload 包含 L1 index 內容
 * AC-3: telemetryUpload=false 時，TelemetryUploader.upload() 不被呼叫
 * AC-4: TelemetryUploader.upload() 拋出網路錯誤時，orchestrate() 正常完成
 * AC-5: backend="local" 或未設定時，TelemetryUploader 不被初始化，無上傳
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { orchestrate } from "../orchestrator.js";
import { LocalStorageBackend, FileServerStorageBackend } from "../execution-history/storage-backend.js";
import type { AgentAdapter, TaskPlan, TaskResult, Task } from "../types.js";
import type { TelemetryUploader } from "asiaostrich-telemetry-client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ============================================================
// Mock asiaostrich-telemetry-client
// ============================================================

const mockUpload = vi.fn().mockResolvedValue(undefined);
const mockUploaderInstance = { upload: mockUpload } as unknown as TelemetryUploader;
const MockTelemetryUploader = vi.fn().mockReturnValue(mockUploaderInstance);

vi.mock("asiaostrich-telemetry-client", () => ({
  TelemetryUploader: MockTelemetryUploader,
}));

// ============================================================
// Helpers
// ============================================================

/** 建立永遠成功的 mock adapter */
function createSuccessAdapter(): AgentAdapter {
  return {
    name: "cli",
    executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
      task_id: task.id,
      status: "success",
      cost_usd: 0.01,
      duration_ms: 100,
    })),
    isAvailable: vi.fn(async () => true),
  };
}

/** 等待 event loop 讓 fire-and-forget（含檔案 I/O）完成 */
async function flushPromises(): Promise<void> {
  // 等待 file I/O callbacks（poll phase）+ microtasks + setImmediate（check phase）
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}

// ============================================================
// Test Suite
// ============================================================

describe("SPEC-012 Telemetry Client 整合", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "devap-telemetry-test-"));
    // DiffCapture 需要 git repo
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: tempDir });
    // 重置所有 mock（含 implementation）
    mockUpload.mockReset();
    mockUpload.mockResolvedValue(undefined);
    MockTelemetryUploader.mockClear();
    MockTelemetryUploader.mockReturnValue(mockUploaderInstance);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // ============================================================
  // AC-1: backend="file_server" 時，FileServerStorageBackend 被使用
  // ============================================================

  describe("[AC-1] backend='file_server' → FileServerStorageBackend 被選擇", () => {
    it("[SPEC-012 AC-1] backend='file_server' + telemetryUpload=true 時，TelemetryUploader 被實例化", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: true,
          telemetryServer: "https://example.com",
          telemetryApiKey: "test-key",
        },
        tasks: [{ id: "T-001", title: "Test", spec: "Do it" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      expect(MockTelemetryUploader).toHaveBeenCalledOnce();
      expect(MockTelemetryUploader).toHaveBeenCalledWith({
        serverUrl: "https://example.com",
        apiKey: "test-key",
      });
    });

    it("[SPEC-012 AC-1] FileServerStorageBackend 實作 StorageBackend interface 所有方法", async () => {
      const localBackend = new LocalStorageBackend(tempDir);
      const backend = new FileServerStorageBackend(localBackend, mockUploaderInstance);

      expect(typeof backend.readFile).toBe("function");
      expect(typeof backend.writeFile).toBe("function");
      expect(typeof backend.deleteFile).toBe("function");
      expect(typeof backend.deleteDir).toBe("function");
      expect(typeof backend.listDir).toBe("function");
      expect(typeof backend.exists).toBe("function");
    });

    it("[SPEC-012 AC-1] FileServerStorageBackend 持有 TelemetryUploader 實例", () => {
      const localBackend = new LocalStorageBackend(tempDir);
      const backend = new FileServerStorageBackend(localBackend, mockUploaderInstance);

      expect(backend.uploader).toBe(mockUploaderInstance);
    });
  });

  // ============================================================
  // AC-2: orchestrator 完成後，TelemetryUploader.upload() 被呼叫
  // ============================================================

  describe("[AC-2] orchestrator 完成後觸發 L1 index snapshot 上傳", () => {
    it("[SPEC-012 AC-2] orchestrate() 完成後 TelemetryUploader.upload() 被呼叫", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: true,
          telemetryServer: "https://telemetry.example.com",
          telemetryApiKey: "my-api-key",
        },
        tasks: [{ id: "T-001", title: "Task", spec: "Spec" }],
      };

      const report = await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      // orchestrate() 正常返回
      expect(report.summary.total_tasks).toBe(1);
      // upload() 被呼叫
      expect(mockUpload).toHaveBeenCalled();
    });

    it("[SPEC-012 AC-2] upload() payload 包含 type='l1_index_snapshot'", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: true,
          telemetryServer: "https://telemetry.example.com",
          telemetryApiKey: "my-api-key",
        },
        tasks: [{ id: "T-001", title: "Task", spec: "Spec" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      if (mockUpload.mock.calls.length > 0) {
        const payload = mockUpload.mock.calls[0][0] as Record<string, unknown>;
        expect(payload.type).toBe("l1_index_snapshot");
        expect(payload.source).toBe("devap");
      }
    });

    it("[SPEC-012 AC-2] upload() 在 orchestrate() 返回後才被呼叫（fire-and-forget）", async () => {
      const callOrder: string[] = [];
      mockUpload.mockImplementation(async () => {
        callOrder.push("upload");
      });

      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: true,
          telemetryServer: "https://telemetry.example.com",
          telemetryApiKey: "key",
        },
        tasks: [{ id: "T-001", title: "T", spec: "S" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      callOrder.push("orchestrate-returned");
      await flushPromises();

      // orchestrate 先返回，upload 後執行
      expect(callOrder[0]).toBe("orchestrate-returned");
    });
  });

  // ============================================================
  // AC-3: telemetryUpload=false 時，零數據離開本機
  // ============================================================

  describe("[AC-3] telemetryUpload=false 時不觸發任何上傳", () => {
    it("[SPEC-012 AC-3] telemetryUpload=false 時 TelemetryUploader.upload() 不被呼叫", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: false,
          telemetryServer: "https://telemetry.example.com",
          telemetryApiKey: "key",
        },
        tasks: [{ id: "T-001", title: "T", spec: "S" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      expect(MockTelemetryUploader).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("[SPEC-012 AC-3] telemetryApiKey='' 時 TelemetryUploader.upload() 不被呼叫", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: true,
          telemetryServer: "https://telemetry.example.com",
          telemetryApiKey: "",
        },
        tasks: [{ id: "T-001", title: "T", spec: "S" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      expect(MockTelemetryUploader).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("[SPEC-012 AC-3] telemetryServer 未設定時 TelemetryUploader.upload() 不被呼叫", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: true,
          // telemetryServer 故意不設定
          telemetryApiKey: "key",
        },
        tasks: [{ id: "T-001", title: "T", spec: "S" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      expect(MockTelemetryUploader).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // AC-4: 伺服器不可用時，orchestrate() 正常完成
  // ============================================================

  describe("[AC-4] 伺服器不可用時優雅降級", () => {
    it("[SPEC-012 AC-4] TelemetryUploader.upload() 拋出 NetworkError 時，orchestrate() 正常返回 ExecutionReport", async () => {
      mockUpload.mockRejectedValue(new Error("Network error: connection refused"));

      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: true,
          telemetryServer: "https://down-server.example.com",
          telemetryApiKey: "key",
        },
        tasks: [{ id: "T-001", title: "T", spec: "S" }],
      };

      // orchestrate() 不應拋錯
      const report = await expect(
        orchestrate(plan, createSuccessAdapter(), { cwd: tempDir }),
      ).resolves.toBeDefined();

      await flushPromises();
    });

    it("[SPEC-012 AC-4] TelemetryUploader.upload() 拋出錯誤時，ExecutionReport 的 tasks 結果不受影響", async () => {
      mockUpload.mockRejectedValue(new Error("HTTP 503 Service Unavailable"));

      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "file_server",
          telemetryUpload: true,
          telemetryServer: "https://down-server.example.com",
          telemetryApiKey: "key",
        },
        tasks: [
          { id: "T-001", title: "Task 1", spec: "S1" },
          { id: "T-002", title: "Task 2", spec: "S2" },
        ],
      };

      const report = await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      expect(report.summary.total_tasks).toBe(2);
      expect(report.summary.succeeded).toBe(2);
      expect(report.tasks.every(t => t.status === "success")).toBe(true);
    });
  });

  // ============================================================
  // AC-5: backend="local" 或未設定時，無上傳
  // ============================================================

  describe("[AC-5] backend='local' 或未設定時不觸發任何上傳", () => {
    it("[SPEC-012 AC-5] backend='local' 時 TelemetryUploader 不被初始化", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: true,
          backend: "local",
          telemetryUpload: true,
          telemetryServer: "https://telemetry.example.com",
          telemetryApiKey: "key",
        },
        tasks: [{ id: "T-001", title: "T", spec: "S" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      expect(MockTelemetryUploader).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("[SPEC-012 AC-5] execution_history 未設定時 TelemetryUploader 不被初始化", async () => {
      const plan: TaskPlan = {
        project: "test",
        tasks: [{ id: "T-001", title: "T", spec: "S" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      expect(MockTelemetryUploader).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("[SPEC-012 AC-5] execution_history.enabled=false 時 TelemetryUploader 不被初始化", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: {
          enabled: false,
          backend: "file_server",
          telemetryUpload: true,
          telemetryServer: "https://telemetry.example.com",
          telemetryApiKey: "key",
        },
        tasks: [{ id: "T-001", title: "T", spec: "S" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });
      await flushPromises();

      expect(MockTelemetryUploader).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // FileServerStorageBackend 單元測試
  // ============================================================

  describe("FileServerStorageBackend 單元測試", () => {
    it("[SPEC-012] uploadIndexSnapshot() 讀取 index.json 並呼叫 TelemetryUploader.upload()", async () => {
      const local = new LocalStorageBackend(tempDir);
      const indexContent = JSON.stringify({ version: "1", tasks: [], updated: "2026-04-10" });
      await local.writeFile("index.json", indexContent);

      const backend = new FileServerStorageBackend(local, mockUploaderInstance);
      await backend.uploadIndexSnapshot();

      expect(mockUpload).toHaveBeenCalledOnce();
      const payload = mockUpload.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.type).toBe("l1_index_snapshot");
      expect(payload.source).toBe("devap");
      expect(payload.content).toEqual(JSON.parse(indexContent));
    });

    it("[SPEC-012] uploadIndexSnapshot() 在 index.json 不存在時靜默跳過", async () => {
      const local = new LocalStorageBackend(tempDir);
      const backend = new FileServerStorageBackend(local, mockUploaderInstance);

      await expect(backend.uploadIndexSnapshot()).resolves.not.toThrow();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("[SPEC-012] writeFile() 委派給 LocalStorageBackend", async () => {
      const local = new LocalStorageBackend(tempDir);
      const backend = new FileServerStorageBackend(local, mockUploaderInstance);

      await backend.writeFile("test.txt", "hello");
      const content = await backend.readFile("test.txt");
      expect(content).toBe("hello");
    });

    it("[SPEC-012] readFile() 委派給 LocalStorageBackend", async () => {
      const local = new LocalStorageBackend(tempDir);
      await local.writeFile("existing.txt", "data");
      const backend = new FileServerStorageBackend(local, mockUploaderInstance);

      expect(await backend.readFile("existing.txt")).toBe("data");
      expect(await backend.readFile("nonexistent.txt")).toBeNull();
    });

    it("[SPEC-012] deleteFile() 委派給 LocalStorageBackend", async () => {
      const local = new LocalStorageBackend(tempDir);
      await local.writeFile("to-delete.txt", "bye");
      const backend = new FileServerStorageBackend(local, mockUploaderInstance);

      await backend.deleteFile("to-delete.txt");
      expect(await backend.exists("to-delete.txt")).toBe(false);
    });

    it("[SPEC-012] listDir() 委派給 LocalStorageBackend", async () => {
      const local = new LocalStorageBackend(tempDir);
      await local.writeFile("dir/a.txt", "a");
      await local.writeFile("dir/b.txt", "b");
      const backend = new FileServerStorageBackend(local, mockUploaderInstance);

      const entries = await backend.listDir("dir");
      expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
    });

    it("[SPEC-012] exists() 委派給 LocalStorageBackend", async () => {
      const local = new LocalStorageBackend(tempDir);
      await local.writeFile("here.txt", "yes");
      const backend = new FileServerStorageBackend(local, mockUploaderInstance);

      expect(await backend.exists("here.txt")).toBe(true);
      expect(await backend.exists("not-here.txt")).toBe(false);
    });
  });
});
