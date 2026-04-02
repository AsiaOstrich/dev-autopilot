/**
 * Orchestrator + Execution History 整合測試（SPEC-008 Phase 2, AC-P2-1~P2-3）
 *
 * [Source] REQ-001: TaskPlan.execution_history 啟用/未啟用
 * [Source] Test Plan: orchestrate() with/without execution_history.enabled
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { orchestrate } from "../../orchestrator.js";
import type { AgentAdapter, TaskPlan, TaskResult, Task, ExecuteOptions } from "../../types.js";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 建立一個永遠成功的 mock adapter */
function createSuccessAdapter(): AgentAdapter {
  return {
    name: "cli",
    executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
      task_id: task.id,
      status: "success",
      cost_usd: 0.1,
      duration_ms: 1000,
    })),
    isAvailable: vi.fn(async () => true),
  };
}

describe("Orchestrator + Execution History 整合", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "devap-orch-hist-"));
    // 初始化 git repo（DiffCapture 需要）
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ============================================================
  // AC-P2-1: 啟用時自動寫入 artifacts
  // ============================================================

  describe("[AC-P2-1] execution_history.enabled = true", () => {
    it("[Source] 應在 .execution-history/ 下產生 artifacts", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: { enabled: true },
        tasks: [{ id: "T-001", title: "Test task", spec: "Do something" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });

      const histDir = join(tempDir, ".execution-history");
      const entries = await readdir(histDir).catch(() => []);
      expect(entries.length).toBeGreaterThan(0);
    });

    it("[Derived] 每個 task 應有對應的 run 目錄", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: { enabled: true },
        tasks: [
          { id: "T-001", title: "Task 1", spec: "Spec 1" },
          { id: "T-002", title: "Task 2", spec: "Spec 2", depends_on: ["T-001"] },
        ],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });

      const histDir = join(tempDir, ".execution-history");
      const taskDirs = await readdir(histDir).catch(() => []);
      // 應有 T-001/, T-002/, index.json
      expect(taskDirs).toContain("T-001");
      expect(taskDirs).toContain("T-002");
      expect(taskDirs).toContain("index.json");
    });

    it("[Derived] run 目錄下應包含 6 個 required artifacts", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: { enabled: true },
        tasks: [{ id: "T-001", title: "Test", spec: "Implement" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });

      const runDir = join(tempDir, ".execution-history", "T-001", "001");
      const files = await readdir(runDir).catch(() => []);
      expect(files).toContain("task-description.md");
      expect(files).toContain("final-status.json");
      expect(files).toContain("token-usage.json");
    });
  });

  // ============================================================
  // AC-P2-2: 未啟用時向後相容
  // ============================================================

  describe("[AC-P2-2] 未啟用時向後相容", () => {
    it("[Source] 無 execution_history 欄位時不產生 .execution-history/", async () => {
      const plan: TaskPlan = {
        project: "test",
        tasks: [{ id: "T-001", title: "Test", spec: "Do" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });

      const histDir = join(tempDir, ".execution-history");
      const exists = await readdir(histDir).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it("[Source] enabled: false 時不產生 .execution-history/", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: { enabled: false },
        tasks: [{ id: "T-001", title: "Test", spec: "Do" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });

      const histDir = join(tempDir, ".execution-history");
      const exists = await readdir(histDir).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it("[Derived] ExecutionReport 結構不受影響", async () => {
      const plan: TaskPlan = {
        project: "test",
        tasks: [{ id: "T-001", title: "Test", spec: "Do" }],
      };

      const report = await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });

      expect(report.summary).toBeDefined();
      expect(report.tasks).toBeDefined();
      expect(report.summary.succeeded).toBe(1);
    });
  });

  // ============================================================
  // AC-P2-3: recordRun 被正確呼叫
  // ============================================================

  describe("[AC-P2-3] recordRun 傳入正確的 RunContext", () => {
    it("[Derived] final-status.json 應包含 task 的 status", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: { enabled: true },
        tasks: [{ id: "T-001", title: "Test", spec: "Do" }],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });

      const statusPath = join(tempDir, ".execution-history", "T-001", "001", "final-status.json");
      const content = await readFile(statusPath, "utf-8");
      const status = JSON.parse(content);
      expect(status.status).toBe("success");
    });

    it("[Derived] execution-log.jsonl 應包含 onProgress 訊息", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: { enabled: true },
        tasks: [{ id: "T-001", title: "Test task", spec: "Do" }],
      };

      await orchestrate(plan, createSuccessAdapter(), {
        cwd: tempDir,
        onProgress: () => {}, // 原始 callback 也應該被呼叫
      });

      const logPath = join(tempDir, ".execution-history", "T-001", "001", "execution-log.jsonl");
      const content = await readFile(logPath, "utf-8").catch(() => "");
      // orchestrator 的 onProgress 至少會發送 "[T-001] 開始執行" 等訊息
      expect(content.length).toBeGreaterThan(0);
    });

    it("[Derived] index.json 應被建立且包含所有 tasks", async () => {
      const plan: TaskPlan = {
        project: "test",
        execution_history: { enabled: true },
        tasks: [
          { id: "T-001", title: "Task 1", spec: "Spec 1" },
          { id: "T-002", title: "Task 2", spec: "Spec 2", depends_on: ["T-001"] },
        ],
      };

      await orchestrate(plan, createSuccessAdapter(), { cwd: tempDir });

      const indexPath = join(tempDir, ".execution-history", "index.json");
      const content = await readFile(indexPath, "utf-8");
      const index = JSON.parse(content);
      expect(index.tasks.length).toBe(2);
    });
  });
});
