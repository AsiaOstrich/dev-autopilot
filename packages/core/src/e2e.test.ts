/**
 * 端到端測試
 *
 * 用 specs/examples/new-project-plan.json 跑完整編排流程。
 * 使用 mock adapter 模擬實際執行。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { orchestrate, mergeDefaults } from "./orchestrator.js";
import { validatePlan } from "./plan-validator.js";
import { createDefaultSafetyHook } from "./safety-hook.js";
import type { AgentAdapter, CheckpointAction, Task, TaskResult, TaskPlan, QualityConfig } from "./types.js";

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

describe("端到端測試：品質模式", () => {
  it("quality mode 全部成功時應產出 quality_metrics", async () => {
    const adapter = createSuccessAdapter();
    const qualityConfig: QualityConfig = {
      verify: true,
      judge_policy: "never",
      max_retries: 0,
      max_retry_budget_usd: 0,
    };

    const simplePlan: TaskPlan = {
      project: "test",
      tasks: [
        { id: "T-001", title: "Task 1", spec: "spec 1" },
        { id: "T-002", title: "Task 2", spec: "spec 2", depends_on: ["T-001"] },
      ],
    };

    const report = await orchestrate(simplePlan, adapter, {
      cwd: "/tmp/test",
      qualityConfig,
    });

    expect(report.summary.succeeded).toBe(2);
    expect(report.quality_metrics).toBeDefined();
    expect(report.quality_metrics!.verification_pass_rate).toBe(1);
    expect(report.quality_metrics!.first_pass_rate).toBe(1);
    expect(report.quality_metrics!.total_retries).toBe(0);
  });
});

describe("端到端測試：並行模式", () => {
  it("無依賴的 tasks 應能並行執行", async () => {
    const adapter = createSuccessAdapter();

    const parallelPlan: TaskPlan = {
      project: "parallel-test",
      tasks: [
        { id: "T-001", title: "Task A", spec: "Independent A" },
        { id: "T-002", title: "Task B", spec: "Independent B" },
        { id: "T-003", title: "Task C", spec: "Depends on A+B", depends_on: ["T-001", "T-002"] },
      ],
    };

    const report = await orchestrate(parallelPlan, adapter, {
      cwd: "/tmp/test",
      parallel: true,
    });

    expect(report.summary.total_tasks).toBe(3);
    expect(report.summary.succeeded).toBe(3);
    // T-001 和 T-002 在同一層，T-003 在第二層
    const ids = report.tasks.map((t) => t.task_id);
    expect(ids).toContain("T-001");
    expect(ids).toContain("T-002");
    expect(ids).toContain("T-003");
  });

  it("maxParallel 限制並行數", async () => {
    const adapter = createSuccessAdapter();

    const manyTasksPlan: TaskPlan = {
      project: "max-parallel-test",
      tasks: [
        { id: "T-001", title: "A", spec: "a" },
        { id: "T-002", title: "B", spec: "b" },
        { id: "T-003", title: "C", spec: "c" },
      ],
    };

    const report = await orchestrate(manyTasksPlan, adapter, {
      cwd: "/tmp/test",
      parallel: true,
      maxParallel: 1,
    });

    expect(report.summary.succeeded).toBe(3);
  });
});

describe("端到端測試：checkpoint", () => {
  it("checkpoint abort 應中止後續任務", async () => {
    const adapter = createSuccessAdapter();

    const plan: TaskPlan = {
      project: "checkpoint-test",
      tasks: [
        { id: "T-001", title: "A", spec: "a" },
        { id: "T-002", title: "B", spec: "b", depends_on: ["T-001"] },
        { id: "T-003", title: "C", spec: "c", depends_on: ["T-002"] },
      ],
    };

    const report = await orchestrate(plan, adapter, {
      cwd: "/tmp/test",
      checkpointPolicy: "after_each_layer",
      onCheckpoint: vi.fn(async (): Promise<CheckpointAction> => "abort"),
    });

    // 第一個 task 完成後 checkpoint abort
    expect(report.summary.succeeded).toBe(1);
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0].task_id).toBe("T-001");
  });

  it("checkpoint continue 應繼續執行", async () => {
    const adapter = createSuccessAdapter();

    const plan: TaskPlan = {
      project: "checkpoint-continue",
      tasks: [
        { id: "T-001", title: "A", spec: "a" },
        { id: "T-002", title: "B", spec: "b", depends_on: ["T-001"] },
      ],
    };

    const report = await orchestrate(plan, adapter, {
      cwd: "/tmp/test",
      checkpointPolicy: "after_each_layer",
      onCheckpoint: vi.fn(async (): Promise<CheckpointAction> => "continue"),
    });

    expect(report.summary.succeeded).toBe(2);
    expect(report.tasks).toHaveLength(2);
  });
});

describe("端到端測試：多層級 test_levels", () => {
  it("mergeDefaults 應合併 test_levels", () => {
    const plan: TaskPlan = {
      project: "test",
      defaults: {
        test_levels: [
          { name: "unit", command: "pnpm test:unit" },
          { name: "integration", command: "pnpm test:integration" },
        ],
      },
      tasks: [{ id: "T-001", title: "A", spec: "a" }],
    };

    const merged = mergeDefaults(plan.tasks[0], plan);
    expect(merged.test_levels).toHaveLength(2);
    expect(merged.test_levels![0].name).toBe("unit");
  });

  it("task 層級 test_levels 優先於 defaults", () => {
    const plan: TaskPlan = {
      project: "test",
      defaults: {
        test_levels: [{ name: "unit", command: "pnpm test:unit" }],
      },
      tasks: [
        {
          id: "T-001",
          title: "A",
          spec: "a",
          test_levels: [{ name: "e2e", command: "pnpm test:e2e" }],
        },
      ],
    };

    const merged = mergeDefaults(plan.tasks[0], plan);
    expect(merged.test_levels).toHaveLength(1);
    expect(merged.test_levels![0].name).toBe("e2e");
  });

  it("含 test_levels 的 plan 應通過驗證", () => {
    const plan: TaskPlan = {
      project: "test",
      defaults: {
        test_levels: [
          { name: "unit", command: "pnpm test:unit" },
        ],
      },
      tasks: [
        {
          id: "T-001",
          title: "A",
          spec: "a",
          test_levels: [
            { name: "unit", command: "pnpm test:unit" },
            { name: "integration", command: "pnpm test:integration" },
            { name: "e2e", command: "pnpm test:e2e" },
          ],
        },
      ],
    };

    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
  });
});

describe("端到端測試：Superpowers 整合", () => {
  it("done_with_concerns 不阻塞後續依賴，且品質報告正確計數", async () => {
    const adapter: AgentAdapter = {
      name: "claude",
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        if (task.id === "T-001") {
          return {
            task_id: task.id,
            status: "done_with_concerns",
            concerns: ["效能未最佳化"],
            cost_usd: 0.5,
            duration_ms: 100,
          };
        }
        return {
          task_id: task.id,
          session_id: `mock-${task.id}`,
          status: "success",
          cost_usd: 0.5,
          duration_ms: 100,
          verification_passed: true,
        };
      }),
      isAvailable: vi.fn(async () => true),
    };

    const plan: TaskPlan = {
      project: "superpowers-e2e",
      tasks: [
        { id: "T-001", title: "Base", spec: "基礎功能" },
        { id: "T-002", title: "Extend", spec: "擴充功能", depends_on: ["T-001"] },
        { id: "T-003", title: "Final", spec: "最終功能", depends_on: ["T-002"] },
      ],
    };

    const report = await orchestrate(plan, adapter, { cwd: "/tmp/test" });

    // done_with_concerns 不阻塞後續
    expect(report.summary.total_tasks).toBe(3);
    expect(report.summary.done_with_concerns).toBe(1);
    expect(report.summary.succeeded).toBe(2);
    expect(report.summary.skipped).toBe(0);
    expect(report.tasks[0].status).toBe("done_with_concerns");
    expect(report.tasks[1].status).toBe("success");
    expect(report.tasks[2].status).toBe("success");
  });

  it("結構化除錯回饋在品質模式中正確升級（3-Strike Rule）", async () => {
    const receivedSpecs: string[] = [];
    let callCount = 0;
    const adapter: AgentAdapter = {
      name: "claude",
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        receivedSpecs.push(task.spec);
        callCount++;
        if (callCount <= 3) {
          return {
            task_id: task.id,
            status: "failed",
            error: `錯誤 ${callCount}`,
            cost_usd: 0.2,
            duration_ms: 50,
          };
        }
        return {
          task_id: task.id,
          status: "success",
          cost_usd: 0.3,
          duration_ms: 100,
        };
      }),
      isAvailable: vi.fn(async () => true),
    };

    const plan: TaskPlan = {
      project: "3-strike-e2e",
      tasks: [{ id: "T-001", title: "Hard task", spec: "實作複雜功能" }],
    };

    const qualityConfig: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 4,
      max_retry_budget_usd: 5.0,
    };

    const report = await orchestrate(plan, adapter, {
      cwd: "/tmp/test",
      qualityConfig,
    });

    expect(report.summary.succeeded).toBe(1);
    expect(report.tasks[0].retry_count).toBe(3);

    // 第 2 次嘗試（重試 1）：Root Cause Investigation
    expect(receivedSpecs[1]).toContain("Root Cause Investigation");
    // 第 3 次嘗試（重試 2）：Pattern Analysis
    expect(receivedSpecs[2]).toContain("Pattern Analysis");
    // 第 4 次嘗試（重試 3）：架構問題升級 3-Strike Rule
    expect(receivedSpecs[3]).toContain("3-Strike Rule");
    expect(receivedSpecs[3]).toContain("停止猜測性修復");
  });

  it("model_tier 在品質模式中正確傳遞到 adapter", async () => {
    let receivedModelTier: string | undefined;
    const adapter: AgentAdapter = {
      name: "claude",
      executeTask: vi.fn(async (task: Task, opts): Promise<TaskResult> => {
        receivedModelTier = opts.modelTier;
        return {
          task_id: task.id,
          status: "success",
          cost_usd: 0.3,
          duration_ms: 100,
        };
      }),
      isAvailable: vi.fn(async () => true),
    };

    const plan: TaskPlan = {
      project: "model-tier-e2e",
      tasks: [
        { id: "T-001", title: "Fast task", spec: "簡單任務", model_tier: "fast" },
      ],
    };

    const qualityConfig: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 0,
      max_retry_budget_usd: 0,
    };

    await orchestrate(plan, adapter, {
      cwd: "/tmp/test",
      qualityConfig,
    });

    expect(receivedModelTier).toBe("fast");
  });

  it("blocked → 重試 → success 完整品質流程", async () => {
    let callCount = 0;
    const adapter: AgentAdapter = {
      name: "claude",
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        callCount++;
        if (callCount === 1) {
          return {
            task_id: task.id,
            status: "blocked",
            block_reason: "缺少 API key",
            cost_usd: 0.1,
            duration_ms: 20,
          };
        }
        return {
          task_id: task.id,
          status: "success",
          cost_usd: 0.5,
          duration_ms: 100,
        };
      }),
      isAvailable: vi.fn(async () => true),
    };

    const plan: TaskPlan = {
      project: "blocked-retry-e2e",
      tasks: [
        { id: "T-001", title: "API task", spec: "呼叫外部 API" },
        { id: "T-002", title: "Follow up", spec: "後續處理", depends_on: ["T-001"] },
      ],
    };

    const qualityConfig: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 2,
      max_retry_budget_usd: 3.0,
    };

    const report = await orchestrate(plan, adapter, {
      cwd: "/tmp/test",
      qualityConfig,
    });

    expect(report.summary.succeeded).toBe(2);
    expect(report.tasks[0].retry_count).toBe(1);
    expect(report.tasks[1].retry_count).toBe(0);
  });

  it("混合狀態的並行執行（success + done_with_concerns + blocked）", async () => {
    const adapter: AgentAdapter = {
      name: "claude",
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        const responses: Record<string, TaskResult> = {
          "T-001": { task_id: "T-001", status: "success", cost_usd: 0.3 },
          "T-002": { task_id: "T-002", status: "done_with_concerns", concerns: ["效能"], cost_usd: 0.3 },
          "T-003": { task_id: "T-003", status: "success", cost_usd: 0.3 },
        };
        return responses[task.id] ?? { task_id: task.id, status: "failed" };
      }),
      isAvailable: vi.fn(async () => true),
    };

    const plan: TaskPlan = {
      project: "mixed-parallel-e2e",
      tasks: [
        { id: "T-001", title: "A", spec: "a" },
        { id: "T-002", title: "B", spec: "b" },
        { id: "T-003", title: "Merge", spec: "c", depends_on: ["T-001", "T-002"] },
      ],
    };

    const report = await orchestrate(plan, adapter, {
      cwd: "/tmp/test",
      parallel: true,
    });

    // T-002 是 done_with_concerns，T-003 依賴它仍可繼續
    expect(report.summary.total_tasks).toBe(3);
    expect(report.summary.succeeded).toBe(2);
    expect(report.summary.done_with_concerns).toBe(1);
    expect(report.summary.skipped).toBe(0);
    expect(report.tasks.find(t => t.task_id === "T-003")?.status).toBe("success");
  });
});

describe("端到端測試：含 test_policy 的 plan", () => {
  it("含 test_policy 的完整 plan 應通過驗證並正確執行", async () => {
    const adapter = createSuccessAdapter();

    const plan: TaskPlan = {
      project: "test-policy-e2e",
      test_policy: {
        pyramid_ratio: { unit: 70, integration: 20, system: 7, e2e: 3 },
        static_analysis_command: "echo static-ok",
        completion_criteria: [
          { name: "docs_check", command: "echo docs-ok", required: true },
          { name: "judge_review", required: false },
        ],
      },
      quality: "standard",
      tasks: [
        {
          id: "T-001",
          title: "Task with policy",
          spec: "Implement feature",
          test_levels: [
            { name: "unit", command: "echo unit-ok" },
            { name: "system", command: "echo system-ok" },
          ],
        },
      ],
    };

    // 驗證 plan 格式
    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);

    // 執行 orchestration
    const report = await orchestrate(plan, adapter, {
      cwd: "/tmp/test",
    });

    expect(report.summary.total_tasks).toBe(1);
    expect(report.summary.succeeded).toBe(1);
  });

  it("test_policy 向後相容：無 test_policy 的 plan 行為不變", async () => {
    const adapter = createSuccessAdapter();

    const plan: TaskPlan = {
      project: "no-policy",
      tasks: [
        { id: "T-001", title: "Simple task", spec: "Do something" },
      ],
    };

    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);

    const report = await orchestrate(plan, adapter, { cwd: "/tmp/test" });
    expect(report.summary.succeeded).toBe(1);
  });
});
