/**
 * 端到端測試
 *
 * 用 specs/examples/new-project-plan.json 跑完整編排流程。
 * 使用 mock adapter 模擬實際執行。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { orchestrate } from "./orchestrator.js";
import { validatePlan } from "./plan-validator.js";
import { createDefaultSafetyHook } from "./safety-hook.js";
import type { AgentAdapter, Task, TaskResult, TaskPlan } from "./types.js";

// 載入範例 plan
const planPath = resolve(import.meta.dirname, "../../../specs/examples/new-project-plan.json");
const planContent = readFileSync(planPath, "utf-8");
const examplePlan: TaskPlan = JSON.parse(planContent);

/** Mock adapter：所有 task 都成功 */
function createSuccessAdapter(): AgentAdapter {
  return {
    name: "claude",
    executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
      task_id: task.id,
      session_id: `mock-session-${task.id}`,
      status: "success",
      cost_usd: 0.5,
      duration_ms: 100,
      verification_passed: true,
    })),
    isAvailable: vi.fn(async () => true),
  };
}

/** Mock adapter：第二個 task 失敗 */
function createPartialFailAdapter(): AgentAdapter {
  return {
    name: "claude",
    executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
      if (task.id === "T-002") {
        return {
          task_id: task.id,
          status: "failed",
          cost_usd: 0.3,
          duration_ms: 50,
          verification_passed: false,
          error: "Schema migration failed",
        };
      }
      return {
        task_id: task.id,
        session_id: `mock-session-${task.id}`,
        status: "success",
        cost_usd: 0.5,
        duration_ms: 100,
        verification_passed: true,
      };
    }),
    isAvailable: vi.fn(async () => true),
  };
}

describe("端到端測試：new-project-plan.json", () => {
  it("範例 plan 應通過驗證", () => {
    const result = validatePlan(examplePlan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("全部成功時應正確產出報告", async () => {
    const adapter = createSuccessAdapter();
    const report = await orchestrate(examplePlan, adapter, {
      cwd: "/tmp/test",
      safetyHooks: [createDefaultSafetyHook()],
    });

    expect(report.summary.total_tasks).toBe(5);
    expect(report.summary.succeeded).toBe(5);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.skipped).toBe(0);
    expect(report.summary.total_cost_usd).toBe(2.5);
    expect(report.tasks).toHaveLength(5);

    // 驗證執行順序（依賴圖正確）
    const ids = report.tasks.map((t) => t.task_id);
    expect(ids).toEqual(["T-001", "T-002", "T-003", "T-004", "T-005"]);

    // 驗證所有 task 都有 session_id
    for (const task of report.tasks) {
      expect(task.session_id).toBeDefined();
      expect(task.status).toBe("success");
    }
  });

  it("部分失敗時應正確 skip 後續依賴", async () => {
    const adapter = createPartialFailAdapter();
    const report = await orchestrate(examplePlan, adapter, {
      cwd: "/tmp/test",
      safetyHooks: [createDefaultSafetyHook()],
    });

    expect(report.summary.total_tasks).toBe(5);
    expect(report.summary.succeeded).toBe(1); // T-001
    expect(report.summary.failed).toBe(1);    // T-002
    expect(report.summary.skipped).toBe(3);   // T-003, T-004, T-005

    // T-001 成功
    expect(report.tasks[0].status).toBe("success");
    // T-002 失敗
    expect(report.tasks[1].status).toBe("failed");
    expect(report.tasks[1].error).toBe("Schema migration failed");
    // T-003~T-005 跳過
    expect(report.tasks[2].status).toBe("skipped");
    expect(report.tasks[3].status).toBe("skipped");
    expect(report.tasks[4].status).toBe("skipped");
  });

  it("safety hook 應攔截危險 plan", async () => {
    const dangerousPlan: TaskPlan = {
      project: "dangerous",
      tasks: [
        {
          id: "T-001",
          title: "Clean up",
          spec: "執行 rm -rf / 清除所有檔案",
        },
      ],
    };

    const adapter = createSuccessAdapter();
    const report = await orchestrate(dangerousPlan, adapter, {
      cwd: "/tmp/test",
      safetyHooks: [createDefaultSafetyHook()],
    });

    expect(report.summary.failed).toBe(1);
    expect(report.tasks[0].status).toBe("failed");
    expect(report.tasks[0].error).toContain("safety hook");
    // adapter 不應被呼叫
    expect(adapter.executeTask).not.toHaveBeenCalled();
  });

  it("plan 的 defaults 應正確套用到 task", async () => {
    const adapter = createSuccessAdapter();
    adapter.executeTask = vi.fn(async (task: Task): Promise<TaskResult> => {
      // T-001 有自訂 max_turns 和 max_budget_usd
      if (task.id === "T-001") {
        expect(task.max_turns).toBe(10);
        expect(task.max_budget_usd).toBe(0.5);
      }
      // T-002 沒有自訂，應使用 defaults
      if (task.id === "T-002") {
        expect(task.max_turns).toBe(30);
        expect(task.max_budget_usd).toBe(2.0);
      }
      return {
        task_id: task.id,
        status: "success",
        cost_usd: 0.1,
        duration_ms: 10,
      };
    });

    await orchestrate(examplePlan, adapter, { cwd: "/tmp/test" });
  });
});
