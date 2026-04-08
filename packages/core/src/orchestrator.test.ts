import { describe, it, expect, vi } from "vitest";
import { orchestrate, topologicalSort, topologicalLayers } from "./orchestrator.js";
import type { AgentAdapter, CheckpointSummary, QualityConfig, Task, TaskPlan, TaskResult, ExecuteOptions } from "./types.js";

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

describe("topologicalLayers", () => {
  it("應將無依賴的 tasks 放在同一層", () => {
    const tasks: Task[] = [
      { id: "T-001", title: "A", spec: "X" },
      { id: "T-002", title: "B", spec: "Y" },
      { id: "T-003", title: "C", spec: "Z" },
    ];
    const layers = topologicalLayers(tasks);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveLength(3);
  });

  it("應將線性依賴分成多層", () => {
    const layers = topologicalLayers(simplePlan.tasks);
    expect(layers).toHaveLength(3);
    expect(layers[0].map(t => t.id)).toEqual(["T-001"]);
    expect(layers[1].map(t => t.id)).toEqual(["T-002"]);
    expect(layers[2].map(t => t.id)).toEqual(["T-003"]);
  });

  it("應將菱形依賴正確分層", () => {
    const tasks: Task[] = [
      { id: "T-001", title: "Root", spec: "R" },
      { id: "T-002", title: "Left", spec: "L", depends_on: ["T-001"] },
      { id: "T-003", title: "Right", spec: "R", depends_on: ["T-001"] },
      { id: "T-004", title: "Merge", spec: "M", depends_on: ["T-002", "T-003"] },
    ];
    const layers = topologicalLayers(tasks);
    expect(layers).toHaveLength(3);
    expect(layers[0].map(t => t.id)).toEqual(["T-001"]);
    expect(layers[1].map(t => t.id).sort()).toEqual(["T-002", "T-003"]);
    expect(layers[2].map(t => t.id)).toEqual(["T-004"]);
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

  it("並行模式應正確執行所有 tasks", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      parallel: true,
    });

    expect(report.summary.total_tasks).toBe(3);
    expect(report.summary.succeeded).toBe(3);
    expect(report.summary.failed).toBe(0);
    expect(adapter.executeTask).toHaveBeenCalledTimes(3);
  });

  it("並行模式下依賴失敗應 skip 後續 tasks", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        if (task.id === "T-001") {
          return { task_id: task.id, status: "failed", error: "compile error" };
        }
        return { task_id: task.id, status: "success" };
      }),
    });

    const report = await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      parallel: true,
    });

    expect(report.summary.failed).toBe(1);
    expect(report.summary.skipped).toBe(2);
  });

  it("並行模式應並行執行同層 tasks", async () => {
    const executionOrder: string[] = [];
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        executionOrder.push(task.id);
        return { task_id: task.id, status: "success", cost_usd: 0.5 };
      }),
    });

    const parallelPlan: TaskPlan = {
      project: "test",
      tasks: [
        { id: "T-001", title: "Root", spec: "R" },
        { id: "T-002", title: "Left", spec: "L", depends_on: ["T-001"] },
        { id: "T-003", title: "Right", spec: "R", depends_on: ["T-001"] },
        { id: "T-004", title: "Merge", spec: "M", depends_on: ["T-002", "T-003"] },
      ],
    };

    const report = await orchestrate(parallelPlan, adapter, {
      ...defaultOptions,
      parallel: true,
    });

    expect(report.summary.succeeded).toBe(4);
    // T-001 必須在 T-002、T-003 之前
    expect(executionOrder.indexOf("T-001")).toBeLessThan(executionOrder.indexOf("T-002"));
    expect(executionOrder.indexOf("T-001")).toBeLessThan(executionOrder.indexOf("T-003"));
    // T-002、T-003 必須在 T-004 之前
    expect(executionOrder.indexOf("T-002")).toBeLessThan(executionOrder.indexOf("T-004"));
    expect(executionOrder.indexOf("T-003")).toBeLessThan(executionOrder.indexOf("T-004"));
  });

  it("maxParallel 應限制同時執行的 task 數", async () => {
    const adapter = createMockAdapter();

    const plan: TaskPlan = {
      project: "test",
      tasks: [
        { id: "T-001", title: "A", spec: "X" },
        { id: "T-002", title: "B", spec: "Y" },
        { id: "T-003", title: "C", spec: "Z" },
      ],
    };

    const report = await orchestrate(plan, adapter, {
      ...defaultOptions,
      parallel: true,
      maxParallel: 2,
    });

    expect(report.summary.total_tasks).toBe(3);
    expect(report.summary.succeeded).toBe(3);
  });
});

describe("orchestrate（品質模式）", () => {
  /** 品質設定：none → 行為與原有一致 */
  const noneQuality: QualityConfig = {
    verify: false,
    judge_policy: "never",
    max_retries: 0,
    max_retry_budget_usd: 0,
  };

  /** 品質設定：minimal → verify only */
  const minimalQuality: QualityConfig = {
    verify: true,
    judge_policy: "never",
    max_retries: 0,
    max_retry_budget_usd: 0,
  };

  it("qualityConfig=none → 與原有行為一致", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      qualityConfig: noneQuality,
    });
    expect(report.summary.succeeded).toBe(3);
    expect(adapter.executeTask).toHaveBeenCalledTimes(3);
  });

  it("qualityConfig=minimal + task 無 verify_command → 仍 success（verify 步驟跳過）", async () => {
    const adapter = createMockAdapter();
    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "A", spec: "do it" }],
    };

    const report = await orchestrate(plan, adapter, {
      ...defaultOptions,
      qualityConfig: minimalQuality,
    });

    // 無 verify_command → quality gate 無步驟 → 直接通過
    expect(report.summary.succeeded).toBe(1);
  });

  it("qualityConfig + adapter 失敗 → fix loop 首次即 fail（max_retries=0）", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
        task_id: task.id,
        status: "failed",
        error: "compile error",
        cost_usd: 0.5,
      })),
    });
    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "A", spec: "do it", verify_command: "pnpm test" }],
    };

    const report = await orchestrate(plan, adapter, {
      ...defaultOptions,
      qualityConfig: minimalQuality,
    });

    expect(report.summary.failed).toBe(1);
    expect(report.tasks[0].retry_count).toBe(0);
  });

  it("qualityConfig + max_retries=1 + 首次失敗第二次成功 → success", async () => {
    let callCount = 0;
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        callCount++;
        if (callCount === 1) {
          return { task_id: task.id, status: "failed", error: "first fail", cost_usd: 0.3 };
        }
        return { task_id: task.id, status: "success", cost_usd: 0.3 };
      }),
    });

    const retryQuality: QualityConfig = {
      verify: false, // 簡化：不跑 verify，只測 fix loop 機制
      judge_policy: "never",
      max_retries: 1,
      max_retry_budget_usd: 2.0,
    };

    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "A", spec: "do it" }],
    };

    const report = await orchestrate(plan, adapter, {
      ...defaultOptions,
      qualityConfig: retryQuality,
    });

    expect(report.summary.succeeded).toBe(1);
    expect(report.tasks[0].retry_count).toBe(1);
    expect(adapter.executeTask).toHaveBeenCalledTimes(2);
  });

  it("重試時 feedback 應注入到 task spec", async () => {
    const specs: string[] = [];
    let callCount = 0;
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        specs.push(task.spec);
        callCount++;
        if (callCount === 1) {
          return { task_id: task.id, status: "failed", error: "missing import", cost_usd: 0.2 };
        }
        return { task_id: task.id, status: "success", cost_usd: 0.2 };
      }),
    });

    const retryQuality: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 1,
      max_retry_budget_usd: 2.0,
    };

    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "A", spec: "implement feature" }],
    };

    await orchestrate(plan, adapter, {
      ...defaultOptions,
      qualityConfig: retryQuality,
    });

    // 第一次：原始 spec
    expect(specs[0]).toBe("implement feature");
    // 第二次：注入了 feedback
    expect(specs[1]).toContain("implement feature");
    expect(specs[1]).toContain("前次失敗回饋");
    expect(specs[1]).toContain("missing import");
  });

  it("品質模式應產出 quality_metrics", async () => {
    let callCount = 0;
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        callCount++;
        // T-001 首次失敗，重試成功
        if (task.id === "T-001" && callCount === 1) {
          return { task_id: task.id, status: "failed", error: "err", cost_usd: 0.2 };
        }
        return { task_id: task.id, status: "success", cost_usd: 0.3 };
      }),
    });

    const retryQuality: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 1,
      max_retry_budget_usd: 2.0,
    };

    const plan: TaskPlan = {
      project: "test",
      tasks: [
        { id: "T-001", title: "A", spec: "a" },
        { id: "T-002", title: "B", spec: "b", depends_on: ["T-001"] },
      ],
    };

    const report = await orchestrate(plan, adapter, {
      ...defaultOptions,
      qualityConfig: retryQuality,
    });

    expect(report.quality_metrics).toBeDefined();
    expect(report.quality_metrics!.verification_pass_rate).toBe(1); // 2/2
    expect(report.quality_metrics!.total_retries).toBe(1);
    expect(report.quality_metrics!.first_pass_rate).toBe(0.5); // T-002 首次通過，T-001 重試
  });

  it("qualityConfig=none → 不產出 quality_metrics", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      qualityConfig: noneQuality,
    });
    expect(report.quality_metrics).toBeUndefined();
  });
});

describe("orchestrate（Implementer 狀態協定 — Superpowers 借鑑）", () => {
  it("done_with_concerns 狀態應記錄 concerns 並允許後續 task 繼續", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        if (task.id === "T-001") {
          return {
            task_id: task.id,
            status: "done_with_concerns",
            concerns: ["效能可能不佳"],
            cost_usd: 0.5,
          };
        }
        return { task_id: task.id, status: "success", cost_usd: 0.3 };
      }),
    });

    const plan: TaskPlan = {
      project: "test",
      tasks: [
        { id: "T-001", title: "A", spec: "do it" },
        { id: "T-002", title: "B", spec: "follow", depends_on: ["T-001"] },
      ],
    };

    const report = await orchestrate(plan, adapter, defaultOptions);

    // done_with_concerns 不阻塞後續 task
    expect(report.tasks[0].status).toBe("done_with_concerns");
    expect(report.tasks[1].status).toBe("success");
    expect(report.summary.done_with_concerns).toBe(1);
    expect(report.summary.succeeded).toBe(1);
  });

  it("blocked 狀態在品質模式中應被 fix loop 處理", async () => {
    let callCount = 0;
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        callCount++;
        if (callCount === 1) {
          return {
            task_id: task.id,
            status: "blocked",
            block_reason: "需要資料庫存取權限",
            cost_usd: 0.3,
          };
        }
        return { task_id: task.id, status: "success", cost_usd: 0.3 };
      }),
    });

    const retryQuality: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 1,
      max_retry_budget_usd: 2.0,
    };

    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "A", spec: "do it" }],
    };

    const report = await orchestrate(plan, adapter, {
      ...defaultOptions,
      qualityConfig: retryQuality,
    });

    expect(report.summary.succeeded).toBe(1);
    expect(report.tasks[0].retry_count).toBe(1);
  });

  it("needs_context 狀態在品質模式中應被 fix loop 處理", async () => {
    let callCount = 0;
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        callCount++;
        if (callCount === 1) {
          return {
            task_id: task.id,
            status: "needs_context",
            needed_context: "需要 API 文件",
            cost_usd: 0.2,
          };
        }
        return { task_id: task.id, status: "success", cost_usd: 0.3 };
      }),
    });

    const retryQuality: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 1,
      max_retry_budget_usd: 2.0,
    };

    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "A", spec: "do it" }],
    };

    const report = await orchestrate(plan, adapter, {
      ...defaultOptions,
      qualityConfig: retryQuality,
    });

    expect(report.summary.succeeded).toBe(1);
    expect(report.tasks[0].retry_count).toBe(1);
  });

  it("model_tier 應透過 ExecuteOptions 傳遞", async () => {
    let receivedModelTier: string | undefined;
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts: ExecuteOptions): Promise<TaskResult> => {
        receivedModelTier = opts.modelTier;
        return { task_id: task.id, status: "success", cost_usd: 0.3 };
      }),
    });

    const plan: TaskPlan = {
      project: "test",
      tasks: [{ id: "T-001", title: "A", spec: "do it", model_tier: "capable" }],
    };

    await orchestrate(plan, adapter, defaultOptions);
    expect(receivedModelTier).toBe("capable");
  });

  it("ExecutionSummary 應包含新狀態的計數", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        const statuses: Record<string, TaskResult> = {
          "T-001": { task_id: "T-001", status: "success", cost_usd: 0.1 },
          "T-002": { task_id: "T-002", status: "done_with_concerns", concerns: ["x"], cost_usd: 0.1 },
          "T-003": { task_id: "T-003", status: "blocked", block_reason: "y", cost_usd: 0.1 },
        };
        return statuses[task.id] ?? { task_id: task.id, status: "failed" };
      }),
    });

    const plan: TaskPlan = {
      project: "test",
      tasks: [
        { id: "T-001", title: "A", spec: "a" },
        { id: "T-002", title: "B", spec: "b" },
        { id: "T-003", title: "C", spec: "c" },
      ],
    };

    const report = await orchestrate(plan, adapter, defaultOptions);
    expect(report.summary.succeeded).toBe(1);
    expect(report.summary.done_with_concerns).toBe(1);
    expect(report.summary.blocked).toBe(1);
  });
});

describe("orchestrate（Checkpoint）", () => {
  it("checkpoint_policy=never → 不呼叫 onCheckpoint", async () => {
    const adapter = createMockAdapter();
    const onCheckpoint = vi.fn(async () => "continue" as const);

    await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      parallel: true,
      checkpointPolicy: "never",
      onCheckpoint,
    });

    expect(onCheckpoint).not.toHaveBeenCalled();
  });

  it("checkpoint_policy=after_each_layer → 每層完成後呼叫 onCheckpoint", async () => {
    const adapter = createMockAdapter();
    const onCheckpoint = vi.fn(async () => "continue" as const);

    await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      parallel: true,
      checkpointPolicy: "after_each_layer",
      onCheckpoint,
    });

    // simplePlan 有 3 層線性依賴，最後一層不觸發 checkpoint
    expect(onCheckpoint).toHaveBeenCalledTimes(2);

    // 驗證 checkpoint summary 結構
    const firstCall = onCheckpoint.mock.calls[0] as unknown as [CheckpointSummary];
    expect(firstCall[0].layer_index).toBe(0);
    expect(firstCall[0].total_layers).toBe(3);
    expect(firstCall[0].layer_results).toHaveLength(1);
    expect(firstCall[0].layer_results[0].task_id).toBe("T-001");
  });

  it("onCheckpoint 回傳 abort → 停止後續層", async () => {
    const adapter = createMockAdapter();
    const onCheckpoint = vi.fn(async () => "abort" as const);

    const report = await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      parallel: true,
      checkpointPolicy: "after_each_layer",
      onCheckpoint,
    });

    // 只執行第一層後中止
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect(report.summary.succeeded).toBe(1);
    expect(report.summary.total_tasks).toBe(1);
  });

  it("序列模式下 checkpoint_policy=after_each_layer → 每個 task 後呼叫", async () => {
    const adapter = createMockAdapter();
    const onCheckpoint = vi.fn(async () => "continue" as const);

    await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      checkpointPolicy: "after_each_layer",
      onCheckpoint,
    });

    // 序列模式 3 個 task，最後一個不觸發
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
  });

  it("序列模式下 onCheckpoint 回傳 abort → 停止後續 task", async () => {
    const adapter = createMockAdapter();
    const onCheckpoint = vi.fn(async () => "abort" as const);

    const report = await orchestrate(simplePlan, adapter, {
      ...defaultOptions,
      checkpointPolicy: "after_each_layer",
      onCheckpoint,
    });

    expect(report.summary.succeeded).toBe(1);
    expect(report.summary.total_tasks).toBe(1);
  });
});

// ============================================================
// DEC-011: Stigmergic Coordination — ActivationPredicate 評估
// [Source] specs/DEC-011-stigmergic-coordination.md
// ============================================================

describe("DEC-011: ActivationPredicate 評估", () => {
  describe("[AC-011-007] threshold 類型評估", () => {
    it("[Source] 條件不滿足時 task 被 skip", async () => {
      const adapter = createMockAdapter({
        executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
          task_id: task.id,
          status: "success",
          cost_usd: 0.1,
          // T-001 回傳 metrics，fail_rate = 0.1（不超過 0.3）
          metrics: { fail_rate: 0.1 },
        })),
      });

      const plan: TaskPlan = {
        project: "test",
        tasks: [
          { id: "T-001", title: "Run tests", spec: "run all tests" },
          {
            id: "T-002",
            title: "Refactor",
            spec: "refactor if fail rate high",
            depends_on: ["T-001"],
            activationPredicate: {
              type: "threshold",
              metric: "fail_rate",
              operator: ">",
              value: 0.3,
              description: "失敗率超過 30% 才觸發重構",
            },
          },
        ],
      };

      const report = await orchestrate(plan, adapter, defaultOptions);

      expect(report.tasks[1].status).toBe("skipped");
      expect(report.tasks[1].error).toContain("activation predicate not met");
      expect(report.tasks[1].error).toContain("失敗率超過 30% 才觸發重構");
      // adapter 只被呼叫一次（T-001），T-002 被 skip 不執行
      expect(adapter.executeTask).toHaveBeenCalledTimes(1);
    });

    it("[Source] 條件滿足時 task 正常執行", async () => {
      let callCount = 0;
      const adapter = createMockAdapter({
        executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
          callCount++;
          if (task.id === "T-001") {
            return {
              task_id: task.id,
              status: "success",
              cost_usd: 0.1,
              metrics: { fail_rate: 0.5 }, // 超過 0.3
            };
          }
          return { task_id: task.id, status: "success", cost_usd: 0.1 };
        }),
      });

      const plan: TaskPlan = {
        project: "test",
        tasks: [
          { id: "T-001", title: "Run tests", spec: "run all tests" },
          {
            id: "T-002",
            title: "Refactor",
            spec: "refactor",
            depends_on: ["T-001"],
            activationPredicate: {
              type: "threshold",
              metric: "fail_rate",
              operator: ">",
              value: 0.3,
              description: "失敗率超過 30%",
            },
          },
        ],
      };

      const report = await orchestrate(plan, adapter, defaultOptions);

      expect(report.tasks[1].status).toBe("success");
      expect(adapter.executeTask).toHaveBeenCalledTimes(2);
    });

    it("[Derived] 前置任務無 metrics 時條件不滿足 → skip", async () => {
      const adapter = createMockAdapter({
        executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
          task_id: task.id,
          status: "success",
          cost_usd: 0.1,
          // 無 metrics 欄位
        })),
      });

      const plan: TaskPlan = {
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
          {
            id: "T-002",
            title: "B",
            spec: "Y",
            depends_on: ["T-001"],
            activationPredicate: {
              type: "threshold",
              metric: "fail_rate",
              operator: ">",
              value: 0.3,
              description: "需要 fail_rate 度量",
            },
          },
        ],
      };

      const report = await orchestrate(plan, adapter, defaultOptions);

      expect(report.tasks[1].status).toBe("skipped");
      expect(report.tasks[1].error).toContain("activation predicate not met");
    });
  });

  describe("[AC-011-008] state_flag 類型評估", () => {
    it("[Source] 條件不滿足時 task 被 skip", async () => {
      const adapter = createMockAdapter({
        executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
          task_id: task.id,
          status: "success", // T-001 是 success，不是 failed
          cost_usd: 0.1,
        })),
      });

      const plan: TaskPlan = {
        project: "test",
        tasks: [
          { id: "T-001", title: "Run tests", spec: "run tests" },
          {
            id: "T-002",
            title: "Fix",
            spec: "fix if failed",
            depends_on: ["T-001"],
            activationPredicate: {
              type: "state_flag",
              taskId: "T-001",
              expectedStatus: "failed",
              description: "T-001 失敗時才執行修復",
            },
          },
        ],
      };

      const report = await orchestrate(plan, adapter, defaultOptions);

      expect(report.tasks[1].status).toBe("skipped");
    });

    it("[Source] 條件滿足時 task 正常執行", async () => {
      const adapter = createMockAdapter({
        executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
          if (task.id === "T-001") {
            return { task_id: task.id, status: "done_with_concerns", cost_usd: 0.1, concerns: ["perf"] };
          }
          return { task_id: task.id, status: "success", cost_usd: 0.1 };
        }),
      });

      const plan: TaskPlan = {
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
          {
            id: "T-002",
            title: "Review concerns",
            spec: "review",
            depends_on: ["T-001"],
            activationPredicate: {
              type: "state_flag",
              taskId: "T-001",
              expectedStatus: "done_with_concerns",
              description: "T-001 有疑慮時才審查",
            },
          },
        ],
      };

      const report = await orchestrate(plan, adapter, defaultOptions);

      expect(report.tasks[1].status).toBe("success");
      expect(adapter.executeTask).toHaveBeenCalledTimes(2);
    });
  });

  describe("[AC-011-009] custom 類型評估", () => {
    it("[Source] 指令回傳非零時 task 被 skip", async () => {
      const adapter = createMockAdapter();

      const plan: TaskPlan = {
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
          {
            id: "T-002",
            title: "Conditional",
            spec: "Y",
            depends_on: ["T-001"],
            activationPredicate: {
              type: "custom",
              command: "test -f nonexistent_file_that_does_not_exist",
              description: "檔案存在時才執行",
            },
          },
        ],
      };

      const report = await orchestrate(plan, adapter, defaultOptions);

      expect(report.tasks[1].status).toBe("skipped");
      expect(report.tasks[1].error).toContain("activation predicate not met");
    });

    it("[Source] 指令回傳零時 task 正常執行", async () => {
      const adapter = createMockAdapter();

      const plan: TaskPlan = {
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
          {
            id: "T-002",
            title: "Conditional",
            spec: "Y",
            depends_on: ["T-001"],
            activationPredicate: {
              type: "custom",
              command: "true", // 永遠回傳 0
              description: "永遠通過",
            },
          },
        ],
      };

      // 使用實際存在的目錄（custom command 需要 cwd 存在）
      const report = await orchestrate(plan, adapter, { cwd: "/tmp" });

      expect(report.tasks[1].status).toBe("success");
      expect(adapter.executeTask).toHaveBeenCalledTimes(2);
    });
  });

  describe("[AC-011-010] 向後相容", () => {
    it("[Source] 無 activationPredicate 時行為不變", async () => {
      const adapter = createMockAdapter();
      const report = await orchestrate(simplePlan, adapter, defaultOptions);

      expect(report.summary.total_tasks).toBe(3);
      expect(report.summary.succeeded).toBe(3);
      expect(report.summary.skipped).toBe(0);
    });

    it("[Derived] 並行模式無 activationPredicate 時行為不變", async () => {
      const adapter = createMockAdapter();
      const report = await orchestrate(simplePlan, adapter, {
        ...defaultOptions,
        parallel: true,
      });

      expect(report.summary.total_tasks).toBe(3);
      expect(report.summary.succeeded).toBe(3);
    });
  });

  describe("[AC-011-011] TaskResult.metrics 欄位", () => {
    it("[Source] adapter 回傳的 metrics 應保留在 TaskResult 中", async () => {
      const adapter = createMockAdapter({
        executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
          task_id: task.id,
          status: "success",
          cost_usd: 0.1,
          metrics: { test_coverage: 0.85, fail_rate: 0.05 },
        })),
      });

      const plan: TaskPlan = {
        project: "test",
        tasks: [{ id: "T-001", title: "A", spec: "X" }],
      };

      const report = await orchestrate(plan, adapter, defaultOptions);

      expect(report.tasks[0].metrics).toBeDefined();
      expect(report.tasks[0].metrics!.test_coverage).toBe(0.85);
      expect(report.tasks[0].metrics!.fail_rate).toBe(0.05);
    });

    it("[Source] 無 metrics 時欄位為 undefined", async () => {
      const adapter = createMockAdapter();

      const plan: TaskPlan = {
        project: "test",
        tasks: [{ id: "T-001", title: "A", spec: "X" }],
      };

      const report = await orchestrate(plan, adapter, defaultOptions);

      expect(report.tasks[0].metrics).toBeUndefined();
    });
  });

  describe("[AC-011-014] 既有測試零回歸", () => {
    it("[Derived] 依賴失敗仍然 skip（不受 predicate 影響）", async () => {
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
    });
  });
});
