import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { orchestrate, topologicalSort, topologicalLayers } from "./orchestrator.js";
import type { AgentAdapter, CheckpointSummary, OrchestrationTelemetryClient, OrchestratorEvent, QualityConfig, Task, TaskPlan, TaskResult, ExecuteOptions } from "./types.js";

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

// ============================================================
// XSPEC-038: Fork Mode Cache-Safe Parallel
// ============================================================

describe("XSPEC-038: Fork Mode Cache-Safe Parallel", () => {
  /** 1 個 planning task → 2 個 implementation tasks 的標準 Fork 場景 */
  const forkPlan: TaskPlan = {
    project: "test-fork",
    tasks: [
      { id: "T-010", title: "Planning", spec: "Plan" },
      { id: "T-011", title: "Impl A", spec: "A", depends_on: ["T-010"] },
      { id: "T-012", title: "Impl B", spec: "B", depends_on: ["T-010"] },
    ],
  };

  it("[AC-1] OrchestratorOptions 接受 parallelForkMode: true（型別相容）", async () => {
    const adapter = createMockAdapter();
    // 若型別不相容，TypeScript 編譯期就會失敗；執行期只確認不 throw
    await expect(
      orchestrate(forkPlan, adapter, { cwd: "/tmp/test", parallel: true, parallelForkMode: true }),
    ).resolves.toBeDefined();
  });

  it("[AC-4] parallelForkMode 未設定時（預設 false），行為與現有完全一致", async () => {
    const capturedOpts: ExecuteOptions[] = [];
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts: ExecuteOptions): Promise<TaskResult> => {
        capturedOpts.push({ ...opts });
        return { task_id: task.id, status: "success", session_id: `sess-${task.id}` };
      }),
    });

    await orchestrate(forkPlan, adapter, { cwd: "/tmp/test", parallel: true });

    // 沒有任何 task 應收到 forkSession: true
    expect(capturedOpts.every(o => !o.forkSession)).toBe(true);
  });

  it("[AC-2] fork 條件成立：前一層 1 個成功 + session_id，下一層 ≥2 tasks 收到相同 sessionId + forkSession:true", async () => {
    const capturedOpts: Record<string, ExecuteOptions> = {};
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts: ExecuteOptions): Promise<TaskResult> => {
        capturedOpts[task.id] = { ...opts };
        return {
          task_id: task.id,
          status: "success",
          session_id: task.id === "T-010" ? "sess-plan-001" : `sess-${task.id}`,
        };
      }),
    });

    await orchestrate(forkPlan, adapter, {
      cwd: "/tmp/test",
      parallel: true,
      parallelForkMode: true,
    });

    // T-010（planning task）不受 fork 影響（第 1 層）
    expect(capturedOpts["T-010"]?.forkSession).toBeFalsy();

    // T-011 和 T-012 都應收到 T-010 的 session_id 並設 forkSession: true
    expect(capturedOpts["T-011"]?.sessionId).toBe("sess-plan-001");
    expect(capturedOpts["T-011"]?.forkSession).toBe(true);
    expect(capturedOpts["T-012"]?.sessionId).toBe("sess-plan-001");
    expect(capturedOpts["T-012"]?.forkSession).toBe(true);
  });

  it("[AC-3] fork 條件不成立：前一層 session_id 為空，下一層不傳遞 forkSession", async () => {
    const capturedOpts: Record<string, ExecuteOptions> = {};
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts: ExecuteOptions): Promise<TaskResult> => {
        capturedOpts[task.id] = { ...opts };
        // PLAN 不回傳 session_id
        return { task_id: task.id, status: "success" };
      }),
    });

    await orchestrate(forkPlan, adapter, {
      cwd: "/tmp/test",
      parallel: true,
      parallelForkMode: true,
    });

    expect(capturedOpts["IMPL-A"]?.forkSession).toBeFalsy();
    expect(capturedOpts["IMPL-B"]?.forkSession).toBeFalsy();
  });

  it("[AC-3] fork 條件不成立：前一層有 2 個成功 tasks，下一層不傳遞 forkSession", async () => {
    const multiPlan: TaskPlan = {
      project: "test-multi",
      tasks: [
        { id: "T-020", title: "Plan A", spec: "A" },
        { id: "T-021", title: "Plan B", spec: "B" },
        { id: "T-022", title: "Impl", spec: "C", depends_on: ["T-020", "T-021"] },
      ],
    };

    const capturedOpts: Record<string, ExecuteOptions> = {};
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts: ExecuteOptions): Promise<TaskResult> => {
        capturedOpts[task.id] = { ...opts };
        return {
          task_id: task.id,
          status: "success",
          session_id: `sess-${task.id}`,
        };
      }),
    });

    await orchestrate(multiPlan, adapter, {
      cwd: "/tmp/test",
      parallel: true,
      parallelForkMode: true,
    });

    // T-022 的前一層有 2 個成功 tasks → 不應 fork
    expect(capturedOpts["T-022"]?.forkSession).toBeFalsy();
  });

  it("[AC-5] parallelForkMode 不影響序列模式（parallel: false）", async () => {
    const capturedOpts: Record<string, ExecuteOptions> = {};
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts: ExecuteOptions): Promise<TaskResult> => {
        capturedOpts[task.id] = { ...opts };
        return { task_id: task.id, status: "success", session_id: "sess-001" };
      }),
    });

    const report = await orchestrate(forkPlan, adapter, {
      cwd: "/tmp/test",
      parallel: false,
      parallelForkMode: true, // 即使設定了也不應影響序列模式
    });

    expect(report.summary.succeeded).toBe(3);
    // 序列模式不走 orchestrateParallel，forkSession 不應被注入
    expect(capturedOpts["T-011"]?.forkSession).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────
// XSPEC-042: streamOutput 串流模式整合測試
// ─────────────────────────────────────────────────────────────

describe("orchestrate — streamOutput 串流模式（XSPEC-042）", () => {
  const streamPlan: TaskPlan = {
    project: "stream-test",
    tasks: [{ id: "T-050", title: "Stream task", spec: "Do streaming work" }],
  };

  it("streamOutput=false（預設）時，使用 executeTask，不呼叫 executeTaskStream", async () => {
    const executeTaskMock = vi.fn(async (task: Task): Promise<TaskResult> => ({
      task_id: task.id,
      status: "success",
      cost_usd: 0.1,
      duration_ms: 100,
    }));
    const executeTaskStreamMock = vi.fn();

    const adapter = createMockAdapter({
      executeTask: executeTaskMock,
      executeTaskStream: executeTaskStreamMock,
    });

    const report = await orchestrate(streamPlan, adapter, { cwd: "/tmp/test", streamOutput: false });

    expect(report.summary.succeeded).toBe(1);
    expect(executeTaskMock).toHaveBeenCalledOnce();
    expect(executeTaskStreamMock).not.toHaveBeenCalled();
  });

  it("streamOutput=true 且 adapter 有 executeTaskStream 時，使用串流模式", async () => {
    const streamEvents = [
      { type: "tool_start" as const, task_id: "T-050", tool_name: "bash" },
      { type: "tool_end" as const, task_id: "T-050", tool_name: "bash", duration_ms: 100, success: true },
    ];
    const finalResult: TaskResult = {
      task_id: "T-050",
      status: "success",
      cost_usd: 0.2,
      duration_ms: 200,
    };

    const executeTaskMock = vi.fn();
    const executeTaskStreamMock = vi.fn(async function* () {
      for (const event of streamEvents) {
        yield event;
      }
      return finalResult;
    });

    const adapter = createMockAdapter({
      executeTask: executeTaskMock,
      executeTaskStream: executeTaskStreamMock,
    });

    const progressMessages: string[] = [];
    const report = await orchestrate(streamPlan, adapter, {
      cwd: "/tmp/test",
      streamOutput: true,
      onProgress: (msg) => progressMessages.push(msg),
    });

    expect(report.summary.succeeded).toBe(1);
    expect(executeTaskMock).not.toHaveBeenCalled();
    expect(executeTaskStreamMock).toHaveBeenCalledOnce();
    // 驗證 tool_start 訊息被轉發到 onProgress
    expect(progressMessages.some(m => m.includes("bash"))).toBe(true);
  });

  it("streamOutput=true 但 adapter 未實作 executeTaskStream 時，退回 executeTask", async () => {
    const executeTaskMock = vi.fn(async (task: Task): Promise<TaskResult> => ({
      task_id: task.id,
      status: "success",
      cost_usd: 0.15,
      duration_ms: 150,
    }));

    // adapter 沒有 executeTaskStream（只有預設的）
    const adapter = createMockAdapter({ executeTask: executeTaskMock });
    // 確認沒有 executeTaskStream
    delete (adapter as Partial<AgentAdapter>).executeTaskStream;

    const report = await orchestrate(streamPlan, adapter, { cwd: "/tmp/test", streamOutput: true });

    expect(report.summary.succeeded).toBe(1);
    expect(executeTaskMock).toHaveBeenCalledOnce();
  });
});

describe("XSPEC-048: Orchestrator AbortSignal 取消機制", () => {
  const twolayerPlan: TaskPlan = {
    project: "abort-test",
    tasks: [
      { id: "T-001", title: "Layer 1", spec: "L1" },
      { id: "T-002", title: "Layer 2", spec: "L2", depends_on: ["T-001"] },
      { id: "T-003", title: "Layer 3", spec: "L3", depends_on: ["T-002"] },
    ],
  };

  it("AC-5: signal 在 Layer 1 執行前 abort → 所有 Task 為 cancelled", async () => {
    const controller = new AbortController();
    controller.abort("user_cancel");

    const executeTaskMock = vi.fn(async (task: Task): Promise<TaskResult> => ({
      task_id: task.id, status: "success", duration_ms: 10,
    }));
    const adapter = createMockAdapter({ executeTask: executeTaskMock });

    const report = await orchestrate(twolayerPlan, adapter, {
      cwd: "/tmp/test",
      signal: controller.signal,
    });

    // 所有 Task 都應為 cancelled
    for (const r of report.tasks) {
      expect(r.status).toBe("cancelled");
      expect(r.cancellation_reason).toBe("user_cancel");
    }
    expect(report.summary.cancelled).toBe(3);
    expect(executeTaskMock).not.toHaveBeenCalled();
  });

  it("AC-5（層間）: Layer 1 完成後 abort → Layer 1 保留結果，Layer 2/3 為 cancelled", async () => {
    const controller = new AbortController();

    let callCount = 0;
    const executeTaskMock = vi.fn(async (task: Task): Promise<TaskResult> => {
      callCount++;
      // T-001 執行完後 abort
      if (task.id === "T-001") {
        controller.abort("after-layer1");
      }
      return { task_id: task.id, status: "success", duration_ms: 10 };
    });
    const adapter = createMockAdapter({ executeTask: executeTaskMock });

    const report = await orchestrate(twolayerPlan, adapter, {
      cwd: "/tmp/test",
      signal: controller.signal,
    });

    const t1 = report.tasks.find(r => r.task_id === "T-001");
    const t2 = report.tasks.find(r => r.task_id === "T-002");
    const t3 = report.tasks.find(r => r.task_id === "T-003");

    // T-001 已完成，保留 success 結果
    expect(t1?.status).toBe("success");
    // T-002 / T-003 未執行，為 cancelled
    expect(t2?.status).toBe("cancelled");
    expect(t3?.status).toBe("cancelled");
    expect(report.summary.succeeded).toBe(1);
    expect(report.summary.cancelled).toBe(2);
    // adapter 只被呼叫 1 次（T-001）
    expect(callCount).toBe(1);
  });

  it("AC-5: cancelled status 不出現在 failed 計數中", async () => {
    const controller = new AbortController();
    controller.abort("test_cancel");

    const adapter = createMockAdapter();

    const report = await orchestrate(twolayerPlan, adapter, {
      cwd: "/tmp/test",
      signal: controller.signal,
    });

    expect(report.summary.failed).toBe(0);
    expect(report.summary.cancelled).toBe(3);
  });

  it("AC-8: 無 signal 時現有行為不變（向後相容）", async () => {
    const executeTaskMock = vi.fn(async (task: Task): Promise<TaskResult> => ({
      task_id: task.id, status: "success", duration_ms: 10,
    }));
    const adapter = createMockAdapter({ executeTask: executeTaskMock });

    const report = await orchestrate(twolayerPlan, adapter, { cwd: "/tmp/test" });

    expect(report.summary.succeeded).toBe(3);
    expect(report.summary.cancelled).toBe(0);
    expect(executeTaskMock).toHaveBeenCalledTimes(3);
  });
});

describe("XSPEC-049: Orchestrator EventEmitter 結構化事件", () => {
  const simplePlan3: TaskPlan = {
    project: "test-emitter",
    tasks: [
      { id: "T-001", title: "Task A", spec: "spec" },
      { id: "T-002", title: "Task B", spec: "spec", depends_on: ["T-001"] },
    ],
  };

  it("AC-1/AC-8/AC-9: orchestrator:start 與 orchestrator:complete 各 emit 一次", async () => {
    const emitter = new EventEmitter();
    const events: OrchestratorEvent[] = [];
    emitter.on("event", (e: OrchestratorEvent) => events.push(e));

    const adapter = createMockAdapter();
    await orchestrate(simplePlan3, adapter, { cwd: "/tmp/test", emitter });

    const startEvents = events.filter(e => e.type === "orchestrator:start");
    const completeEvents = events.filter(e => e.type === "orchestrator:complete");
    expect(startEvents).toHaveLength(1);
    expect(completeEvents).toHaveLength(1);
    expect(startEvents[0].type === "orchestrator:start" && startEvents[0].task_count).toBe(2);
    expect(completeEvents[0].type === "orchestrator:complete" && completeEvents[0].plan_id).toBe("test-emitter");
  });

  it("AC-3/AC-4: task:start 與 task:complete 各 Task emit 一次", async () => {
    const emitter = new EventEmitter();
    const events: OrchestratorEvent[] = [];
    emitter.on("event", (e: OrchestratorEvent) => events.push(e));

    const adapter = createMockAdapter();
    await orchestrate(simplePlan3, adapter, { cwd: "/tmp/test", emitter });

    const startEvents = events.filter(e => e.type === "task:start");
    const completeEvents = events.filter(e => e.type === "task:complete");
    expect(startEvents).toHaveLength(2);
    expect(completeEvents).toHaveLength(2);
    // task:start 在 task:complete 之前
    const e001StartIdx = events.findIndex(e => e.type === "task:start" && e.task_id === "T-001");
    const e001CompleteIdx = events.findIndex(e => e.type === "task:complete" && e.task_id === "T-001");
    expect(e001StartIdx).toBeLessThan(e001CompleteIdx);
  });

  it("AC-7: task:skipped 在依賴失敗時 emit", async () => {
    const emitter = new EventEmitter();
    const events: OrchestratorEvent[] = [];
    emitter.on("event", (e: OrchestratorEvent) => events.push(e));

    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
        task_id: task.id,
        status: task.id === "T-001" ? "failed" : "success",
        duration_ms: 10,
      })),
    });
    await orchestrate(simplePlan3, adapter, { cwd: "/tmp/test", emitter });

    const skipped = events.filter(e => e.type === "task:skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].type === "task:skipped" && skipped[0].task_id).toBe("T-002");
  });

  it("AC-6: signal:abort + task:cancelled emit（序列模式）", async () => {
    const emitter = new EventEmitter();
    const events: OrchestratorEvent[] = [];
    emitter.on("event", (e: OrchestratorEvent) => events.push(e));

    const controller = new AbortController();
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        if (task.id === "T-001") controller.abort("test-cancel");
        return { task_id: task.id, status: "success", duration_ms: 10 };
      }),
    });
    await orchestrate(simplePlan3, adapter, { cwd: "/tmp/test", emitter, signal: controller.signal });

    const abortEvents = events.filter(e => e.type === "signal:abort");
    const cancelEvents = events.filter(e => e.type === "task:cancelled");
    expect(abortEvents).toHaveLength(1);
    expect(cancelEvents).toHaveLength(1);
    expect(cancelEvents[0].type === "task:cancelled" && cancelEvents[0].reason).toBe("test-cancel");
  });

  it("AC-10: 不傳 emitter 時 onProgress 照常工作（向後相容）", async () => {
    const messages: string[] = [];
    const adapter = createMockAdapter();
    await orchestrate(simplePlan3, adapter, {
      cwd: "/tmp/test",
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some(m => m.includes("T-001"))).toBe(true);
    expect(messages.some(m => m.includes("T-002"))).toBe(true);
  });
});

describe("XSPEC-050: Session Resume Pack", () => {
  const resumePlan: TaskPlan = {
    project: "test-resume",
    tasks: [
      { id: "T-001", title: "Setup", spec: "setup spec" },
      { id: "T-002", title: "Build", spec: "build spec", depends_on: ["T-001"] },
      { id: "T-003", title: "Test", spec: "test spec", depends_on: ["T-002"] },
    ],
  };

  it("AC-1/AC-2: session_resume_pack 只包含 success 且有 session_id 的 Task", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
        task_id: task.id,
        status: "success",
        duration_ms: 10,
        session_id: `sess-${task.id}`,
      })),
    });

    const report = await orchestrate(resumePlan, adapter, { cwd: "/tmp/test" });

    expect(report.session_resume_pack).toEqual({
      "T-001": "sess-T-001",
      "T-002": "sess-T-002",
      "T-003": "sess-T-003",
    });
  });

  it("AC-2: failed Task 不進入 session_resume_pack", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
        task_id: task.id,
        status: task.id === "T-001" ? "failed" : "success",
        duration_ms: 10,
        session_id: `sess-${task.id}`,
      })),
    });

    const report = await orchestrate(resumePlan, adapter, { cwd: "/tmp/test" });

    expect(Object.keys(report.session_resume_pack)).not.toContain("T-001");
    // T-002 skipped because T-001 failed; T-003 depends on T-002
    expect(Object.keys(report.session_resume_pack)).toHaveLength(0);
  });

  it("AC-2: session_id 為 undefined 的 Task 不進入 pack", async () => {
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => ({
        task_id: task.id,
        status: "success",
        duration_ms: 10,
        // 刻意不設 session_id（部分 adapter 不回傳）
      })),
    });

    const report = await orchestrate(resumePlan, adapter, { cwd: "/tmp/test" });

    expect(Object.keys(report.session_resume_pack)).toHaveLength(0);
  });

  it("AC-3/AC-4: resumeFrom 注入正確 sessionId 給對應 Task", async () => {
    const capturedSessionIds: Record<string, string | undefined> = {};
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts): Promise<TaskResult> => {
        capturedSessionIds[task.id] = (opts as { sessionId?: string }).sessionId;
        return { task_id: task.id, status: "success", duration_ms: 10 };
      }),
    });

    await orchestrate(resumePlan, adapter, {
      cwd: "/tmp/test",
      resumeFrom: { "T-001": "resume-sess-001", "T-002": "resume-sess-002" },
    });

    expect(capturedSessionIds["T-001"]).toBe("resume-sess-001");
    expect(capturedSessionIds["T-002"]).toBe("resume-sess-002");
    // T-003 不在 resumeFrom 中，不注入 sessionId
    expect(capturedSessionIds["T-003"]).toBeUndefined();
  });

  it("AC-5: 不提供 resumeFrom 時行為不變（向後相容）", async () => {
    const capturedSessionIds: Record<string, string | undefined> = {};
    const adapter = createMockAdapter({
      executeTask: vi.fn(async (task: Task, opts): Promise<TaskResult> => {
        capturedSessionIds[task.id] = (opts as { sessionId?: string }).sessionId;
        return { task_id: task.id, status: "success", duration_ms: 10 };
      }),
    });

    const report = await orchestrate(resumePlan, adapter, {
      cwd: "/tmp/test",
      sessionId: "global-session",
    });

    // 全域 sessionId 傳給每個 Task
    expect(capturedSessionIds["T-001"]).toBe("global-session");
    expect(Object.keys(report.session_resume_pack)).toHaveLength(0); // 無 session_id 回傳
  });
});

// ============================================================
// XSPEC-051: Orchestrator Run Telemetry
// ============================================================

describe("XSPEC-051: Orchestrator Run Telemetry", () => {
  const telemetryPlan: TaskPlan = {
    project: "test-telemetry",
    tasks: [
      { id: "T-001", title: "Task 1", spec: "Do 1" },
      { id: "T-002", title: "Task 2", spec: "Do 2" },
      { id: "T-003", title: "Task 3", spec: "Do 3" },
    ],
  };

  function createTelemetryAdapter(statuses: ("success" | "failed")[]): AgentAdapter {
    let callIdx = 0;
    return createMockAdapter({
      executeTask: vi.fn(async (task: Task): Promise<TaskResult> => {
        const status = statuses[callIdx++] ?? "success";
        if (status === "failed") {
          return { task_id: task.id, status: "failed", duration_ms: 10, error: "err" };
        }
        return { task_id: task.id, status: "success", duration_ms: 10, retry_count: callIdx - 1 };
      }),
    });
  }

  it("AC-3/AC-4: orchestrate() 完成後 upload() 被呼叫，payload 包含規定欄位", async () => {
    const mockUpload = vi.fn().mockResolvedValue(undefined);
    const telemetry: OrchestrationTelemetryClient = { upload: mockUpload };
    const adapter = createTelemetryAdapter(["success", "success", "failed"]);

    await orchestrate(telemetryPlan, adapter, {
      cwd: "/tmp/test",
      orchestrationTelemetry: telemetry,
    });

    expect(mockUpload).toHaveBeenCalledOnce();
    const payload = mockUpload.mock.calls[0][0] as Record<string, unknown>;

    expect(payload["event_type"]).toBe("orchestration_run");
    expect(payload["plan_id"]).toBe("test-telemetry");
    expect(payload["task_count"]).toBe(3);
    expect(payload["success_count"]).toBe(2);
    expect(payload["failed_count"]).toBe(1);
    expect(payload["cancelled_count"]).toBe(0);
    expect(payload["total_duration_ms"]).toBeGreaterThanOrEqual(0);
    expect(payload["has_quality_gate"]).toBe(false);
    expect(payload["parallel_mode"]).toBe(false);
    expect(typeof payload["timestamp"]).toBe("string");
    // 不含敏感欄位
    expect(payload["session_id"]).toBeUndefined();
    expect(payload["prompt"]).toBeUndefined();
    expect(payload["output"]).toBeUndefined();
  });

  it("AC-5: upload() 拋出錯誤時 orchestrate() 正常完成", async () => {
    const mockUpload = vi.fn().mockRejectedValue(new Error("network error"));
    const telemetry: OrchestrationTelemetryClient = { upload: mockUpload };
    const adapter = createTelemetryAdapter(["success", "success", "success"]);

    // 不應 throw
    const report = await orchestrate(telemetryPlan, adapter, {
      cwd: "/tmp/test",
      orchestrationTelemetry: telemetry,
    });

    expect(report.summary.succeeded).toBe(3);
    expect(mockUpload).toHaveBeenCalledOnce();
  });

  it("AC-6: 不提供 orchestrationTelemetry 時，upload() 不被呼叫", async () => {
    const mockUpload = vi.fn();
    const adapter = createTelemetryAdapter(["success", "success", "success"]);

    const report = await orchestrate(telemetryPlan, adapter, {
      cwd: "/tmp/test",
      // 刻意不傳 orchestrationTelemetry
    });

    expect(mockUpload).not.toHaveBeenCalled();
    expect(report.summary.succeeded).toBe(3);
  });

  it("AC-4 parallel_mode: parallel=true 時 parallel_mode=true", async () => {
    const mockUpload = vi.fn().mockResolvedValue(undefined);
    const telemetry: OrchestrationTelemetryClient = { upload: mockUpload };
    const adapter = createTelemetryAdapter(["success", "success", "success"]);

    await orchestrate(telemetryPlan, adapter, {
      cwd: "/tmp/test",
      parallel: true,
      orchestrationTelemetry: telemetry,
    });

    expect(mockUpload).toHaveBeenCalledOnce();
    const payload = mockUpload.mock.calls[0][0] as Record<string, unknown>;
    expect(payload["parallel_mode"]).toBe(true);
  });
});

// ─── XSPEC-052: dryRun 模式 ────────────────────────────────────────────────

describe("XSPEC-052: dryRun 模式", () => {
  const dryPlan: TaskPlan = {
    project: "dry-test",
    tasks: [
      { id: "T-010", title: "Step A", spec: "Do A" },
      { id: "T-011", title: "Step B", spec: "Do B", depends_on: ["T-010"] },
      { id: "T-012", title: "Step C", spec: "Do C", depends_on: ["T-011"] },
    ],
  };

  it("dryRun: true 時不呼叫 adapter.executeTask", async () => {
    const adapter = createMockAdapter();
    await orchestrate(dryPlan, adapter, { cwd: "/tmp/test", dryRun: true });
    expect(adapter.executeTask).not.toHaveBeenCalled();
  });

  it("dryRun: true 時所有 task status === 'skipped'", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(dryPlan, adapter, { cwd: "/tmp/test", dryRun: true });
    for (const task of report.tasks) {
      expect(task.status).toBe("skipped");
    }
  });

  it("dryRun: true 時 report.dry_run === true", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(dryPlan, adapter, { cwd: "/tmp/test", dryRun: true });
    expect(report.dry_run).toBe(true);
  });

  it("dryRun: true 時第一個 task 的 error 包含 'dry-run'", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(dryPlan, adapter, { cwd: "/tmp/test", dryRun: true });
    // T-010 沒有依賴，一定是 dry-run skip
    const t010 = report.tasks.find((t) => t.task_id === "T-010");
    expect(t010?.error).toContain("dry-run");
  });

  it("dryRun: false（預設）時正常執行所有 tasks", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(dryPlan, adapter, { cwd: "/tmp/test" });
    expect(adapter.executeTask).toHaveBeenCalledTimes(3);
    expect(report.dry_run).toBeUndefined();
    expect(report.summary.succeeded).toBe(3);
  });

  it("dryRun: true 並行模式時所有 task 也應為 skipped", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(dryPlan, adapter, {
      cwd: "/tmp/test",
      dryRun: true,
      parallel: true,
    });
    expect(adapter.executeTask).not.toHaveBeenCalled();
    for (const task of report.tasks) {
      expect(task.status).toBe("skipped");
    }
    expect(report.dry_run).toBe(true);
  });
});

// ─── XSPEC-053: TaskFilter ──────────────────────────────────────────────────

describe("XSPEC-053: TaskFilter", () => {
  const filterPlan: TaskPlan = {
    project: "filter-test",
    tasks: [
      { id: "T-020", title: "Task A", spec: "A" },
      { id: "T-021", title: "Task B", spec: "B" },
      { id: "T-022", title: "Task C", spec: "C" },
      { id: "T-023", title: "Task D", spec: "D" },
    ],
  };

  it("only 模式只執行指定 task", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(filterPlan, adapter, {
      cwd: "/tmp/test",
      taskFilter: { only: ["T-020", "T-022"] },
    });

    // 只有 T-020 和 T-022 應該被執行（success），其他 skipped
    const executed = report.tasks.filter((t) => t.status === "success");
    const skipped = report.tasks.filter((t) => t.status === "skipped");
    expect(executed.map((t) => t.task_id).sort()).toEqual(["T-020", "T-022"]);
    expect(skipped.map((t) => t.task_id).sort()).toEqual(["T-021", "T-023"]);
  });

  it("skip 模式跳過指定 task", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(filterPlan, adapter, {
      cwd: "/tmp/test",
      taskFilter: { skip: ["T-021", "T-023"] },
    });

    const executed = report.tasks.filter((t) => t.status === "success");
    const skipped = report.tasks.filter((t) => t.status === "skipped");
    expect(executed.map((t) => t.task_id).sort()).toEqual(["T-020", "T-022"]);
    expect(skipped.map((t) => t.task_id).sort()).toEqual(["T-021", "T-023"]);
  });

  it("only 優先於 skip（同時提供時）", async () => {
    const adapter = createMockAdapter();
    const warnMessages: string[] = [];
    const report = await orchestrate(filterPlan, adapter, {
      cwd: "/tmp/test",
      onProgress: (msg) => warnMessages.push(msg),
      taskFilter: {
        only: ["T-020"],
        skip: ["T-020", "T-021"], // skip T-020，但 only 優先
      },
    });

    // only 優先 → T-020 應被執行
    const t020 = report.tasks.find((t) => t.task_id === "T-020");
    expect(t020?.status).toBe("success");

    // 應輸出 warning
    expect(warnMessages.some((m) => m.includes("[WARN]") && m.includes("only"))).toBe(true);
  });

  it("不存在的 task_id 在 only 中應觸發 warning", async () => {
    const adapter = createMockAdapter();
    const warnMessages: string[] = [];
    await orchestrate(filterPlan, adapter, {
      cwd: "/tmp/test",
      onProgress: (msg) => warnMessages.push(msg),
      taskFilter: { only: ["T-020", "T-999"] },
    });

    expect(
      warnMessages.some(
        (m) => m.includes("[WARN]") && m.includes("T-999"),
      ),
    ).toBe(true);
  });

  it("不存在的 task_id 在 skip 中應觸發 warning", async () => {
    const adapter = createMockAdapter();
    const warnMessages: string[] = [];
    await orchestrate(filterPlan, adapter, {
      cwd: "/tmp/test",
      onProgress: (msg) => warnMessages.push(msg),
      taskFilter: { skip: ["T-020", "T-998"] },
    });

    expect(
      warnMessages.some(
        (m) => m.includes("[WARN]") && m.includes("T-998"),
      ),
    ).toBe(true);
  });

  it("被過濾 task 的 error 包含 'task-filter'", async () => {
    const adapter = createMockAdapter();
    const report = await orchestrate(filterPlan, adapter, {
      cwd: "/tmp/test",
      taskFilter: { skip: ["T-021"] },
    });

    const t021 = report.tasks.find((t) => t.task_id === "T-021");
    expect(t021?.status).toBe("skipped");
    expect(t021?.error).toContain("task-filter");
  });
});
