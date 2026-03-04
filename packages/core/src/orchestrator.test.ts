import { describe, it, expect, vi } from "vitest";
import { orchestrate, topologicalSort } from "./orchestrator.js";
import type { AgentAdapter, Task, TaskPlan, TaskResult, ExecuteOptions } from "./types.js";

/** 建立 mock adapter */
function createMockAdapter(
  overrides?: Partial<AgentAdapter>,
): AgentAdapter {
  return {
    name: "claude",
    executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
      task_id: task.id,
      status: "success",
      cost_usd: 0.5,
      duration_ms: 100,
      verification_passed: true,
    })),
    isAvailable: vi.fn(async () => true),
    ...overrides,
  };
}

/** 基本 plan */
const simplePlan: TaskPlan = {
  project: "test",
  tasks: [
    { id: "T-001", title: "Init", spec: "Initialize" },
    { id: "T-002", title: "Build", spec: "Build", depends_on: ["T-001"] },
    { id: "T-003", title: "Test", spec: "Test", depends_on: ["T-002"] },
  ],
};

const defaultOptions = { cwd: "/tmp/test" };

describe("topologicalSort", () => {
  it("應正確排序線性依賴", () => {
    const sorted = topologicalSort(simplePlan.tasks);
    const ids = sorted.map((t) => t.id);
    expect(ids.indexOf("T-001")).toBeLessThan(ids.indexOf("T-002"));
    expect(ids.indexOf("T-002")).toBeLessThan(ids.indexOf("T-003"));
  });

  it("應正確排序無依賴的 tasks", () => {
    const tasks: Task[] = [
      { id: "T-001", title: "A", spec: "X" },
      { id: "T-002", title: "B", spec: "Y" },
      { id: "T-003", title: "C", spec: "Z" },
    ];
    const sorted = topologicalSort(tasks);
    expect(sorted).toHaveLength(3);
  });

  it("應正確排序菱形依賴", () => {
    const tasks: Task[] = [
      { id: "T-001", title: "Root", spec: "R" },
      { id: "T-002", title: "Left", spec: "L", depends_on: ["T-001"] },
      { id: "T-003", title: "Right", spec: "R", depends_on: ["T-001"] },
      { id: "T-004", title: "Merge", spec: "M", depends_on: ["T-002", "T-003"] },
    ];
    const sorted = topologicalSort(tasks);
    const ids = sorted.map((t) => t.id);
    expect(ids.indexOf("T-001")).toBeLessThan(ids.indexOf("T-002"));
    expect(ids.indexOf("T-001")).toBeLessThan(ids.indexOf("T-003"));
    expect(ids.indexOf("T-002")).toBeLessThan(ids.indexOf("T-004"));
    expect(ids.indexOf("T-003")).toBeLessThan(ids.indexOf("T-004"));
  });
});

describe("orchestrate", () => {
  it("應依序執行所有 tasks", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(simplePlan, adapter, defaultOptions);

    expect(report.summary.total_tasks).toBe(3);
    expect(report.summary.succeeded).toBe(3);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.skipped).toBe(0);
    expect(report.tasks).toHaveLength(3);
    expect(adapter.executeTask).toHaveBeenCalledTimes(3);
  });

  it("依賴失敗時應 skip 後續 tasks", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        if (task.id === "T-001") {
          return { task_id: task.id, status: "failed", error: "compile error" };
        }
        return { task_id: task.id, status: "success" };
      }),
    });

    const report = await orchestrate(simplePlan, adapter, defaultOptions);

    expect(report.summary.failed).toBe(1);
    expect(report.summary.skipped).toBe(2);
    expect(report.tasks[0].status).toBe("failed");
    expect(report.tasks[1].status).toBe("skipped");
    expect(report.tasks[2].status).toBe("skipped");
  });

  it("adapter 拋出例外時應記錄為 failed", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async () => {
        throw new Error("SDK crash");
      }),
    });

    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "Crash", spec: "This will crash" }],
    };

    const report = await orchestrate(plan, adapter, defaultOptions);

    expect(report.summary.failed).toBe(1);
    expect(report.tasks[0].status).toBe("failed");
    expect(report.tasks[0].error).toBe("SDK crash");
  });

  it("應正確合併 defaults", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts: ExecuteOptions): Promise<TaskResult> => {
        // 驗證 defaults 已合併
        expect(task.max_turns).toBe(50);
        expect(task.max_budget_usd).toBe(3.0);
        return { task_id: task.id, status: "success" };
      }),
    });

    const plan: TaskPlan = {
      project: "test",
      defaults: { max_turns: 50, max_budget_usd: 3.0 },
      tasks: [{ id: "T-001", title: "X", spec: "Y" }],
    };

    await orchestrate(plan, adapter, defaultOptions);
  });

  it("task 層級值應覆蓋 defaults", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        expect(task.max_turns).toBe(10);
        return { task_id: task.id, status: "success" };
      }),
    });

    const plan: TaskPlan = {
      project: "test",
      defaults: { max_turns: 50 },
      tasks: [{ id: "T-001", title: "X", spec: "Y", max_turns: 10 }],
    };

    await orchestrate(plan, adapter, defaultOptions);
  });

  it("應正確計算總成本", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
        task_id: task.id,
        status: "success",
        cost_usd: 1.5,
      })),
    });

    const plan: TaskPlan = {
      project: "test",
      tasks: [
        { id: "T-001", title: "A", spec: "X" },
        { id: "T-002", title: "B", spec: "Y" },
      ],
    };

    const report = await orchestrate(plan, adapter, defaultOptions);
    expect(report.summary.total_cost_usd).toBe(3.0);
  });

  it("應拒絕無效的 plan", async () => {
    const adapter = createMockAdapter();
    const invalidPlan = { project: "test", tasks: [] } as unknown as TaskPlan;

    await expect(
      orchestrate(invalidPlan, adapter, defaultOptions),
    ).rejects.toThrow("Plan 驗證失敗");
  });

  it("safety hook 應能攔截 task", async () => {
    const adapter = createMockAdapter();
    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "Danger", spec: "rm -rf /" }],
    };

    const report = await orchestrate(plan, adapter, {
      ...defaultOptions,
      safetyHooks: [() => false],
    });

    expect(report.tasks[0].status).toBe("failed");
    expect(report.tasks[0].error).toContain("safety hook");
    expect(adapter.executeTask).not.toHaveBeenCalled();
  });

  it("應呼叫 onProgress 回呼", async () => {
    const adapter = createMockAdapter();
    const messages: string[] = [];

    await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes("T-001"))).toBe(true);
  });
});
