/**
 * 編排器（Orchestrator）
 *
 * 核心編排引擎：載入 task plan → 解析 DAG → 依序執行 → 產出報告。
 */

import { validatePlan } from "./plan-validator.js";
import type {
  AgentAdapter,
  ExecuteOptions,
  ExecutionReport,
  ExecutionSummary,
  OrchestratorOptions,
  SafetyHook,
  Task,
  TaskPlan,
  TaskResult,
  TaskStatus,
} from "./types.js";

/**
 * 對 DAG 做拓撲排序
 *
 * 使用 Kahn's algorithm，回傳依賴順序排列的 task 列表。
 *
 * @param tasks - 任務列表
 * @returns 拓撲排序後的任務列表
 * @throws 若存在循環依賴
 */
export function topologicalSort(tasks: Task[]): Task[] {
  const taskMap = new Map<string, Task>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const task of tasks) {
    taskMap.set(task.id, task);
    inDegree.set(task.id, 0);
    adj.set(task.id, []);
  }

  // 建立鄰接表與入度
  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      adj.get(dep)!.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: Task[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(taskMap.get(current)!);

    for (const neighbor of adj.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== tasks.length) {
    throw new Error("依賴圖存在循環，無法排序");
  }

  return sorted;
}

/**
 * 合併 task 層級參數與 plan 預設值
 *
 * task 層級的值優先於 defaults。
 */
function mergeDefaults(task: Task, plan: TaskPlan): Task {
  const defaults = plan.defaults ?? {};
  return {
    ...task,
    agent: task.agent ?? plan.agent,
    max_turns: task.max_turns ?? defaults.max_turns,
    max_budget_usd: task.max_budget_usd ?? defaults.max_budget_usd,
    allowed_tools: task.allowed_tools ?? defaults.allowed_tools,
    verify_command: task.verify_command ?? defaults.verify_command,
  };
}

/**
 * 執行編排流程
 *
 * 1. 驗證 plan
 * 2. 拓撲排序
 * 3. 依序執行每個 task
 * 4. 依賴失敗時 skip 後續 task
 * 5. 產出 ExecutionReport
 *
 * @param plan - 任務計畫
 * @param adapter - agent adapter 實例
 * @param options - 編排器選項
 * @returns 執行報告
 */
export async function orchestrate(
  plan: TaskPlan,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
): Promise<ExecutionReport> {
  // 1. 驗證 plan
  const validation = validatePlan(plan);
  if (!validation.valid) {
    throw new Error(`Plan 驗證失敗：${validation.errors.join("; ")}`);
  }

  // 2. 拓撲排序
  const sortedTasks = topologicalSort(plan.tasks);

  // 3. 依序執行
  const results: TaskResult[] = [];
  const completed = new Map<string, TaskResult>();
  const startTime = Date.now();

  for (const rawTask of sortedTasks) {
    const task = mergeDefaults(rawTask, plan);

    // 檢查依賴是否都成功
    const depsFailed = (task.depends_on ?? []).some(
      (dep) => completed.get(dep)?.status !== "success",
    );

    if (depsFailed) {
      const skipped: TaskResult = {
        task_id: task.id,
        status: "skipped",
        duration_ms: 0,
        error: "依賴任務失敗，跳過執行",
      };
      results.push(skipped);
      completed.set(task.id, skipped);
      options.onProgress?.(`[${task.id}] 跳過：依賴任務失敗`);
      continue;
    }

    // 執行 safety hooks
    if (options.safetyHooks) {
      const blocked = await runSafetyHooks(task, options.safetyHooks);
      if (blocked) {
        const denied: TaskResult = {
          task_id: task.id,
          status: "failed",
          duration_ms: 0,
          error: `Safety hook 攔截：${blocked}`,
        };
        results.push(denied);
        completed.set(task.id, denied);
        options.onProgress?.(`[${task.id}] 被攔截：${blocked}`);
        continue;
      }
    }

    // 執行 task
    options.onProgress?.(`[${task.id}] 開始執行：${task.title}`);
    const taskStartTime = Date.now();

    try {
      const execOpts: ExecuteOptions = {
        cwd: options.cwd,
        sessionId: options.sessionId,
        forkSession: task.fork_session,
        onProgress: options.onProgress,
      };

      const result = await adapter.executeTask(task, execOpts);
      result.duration_ms = result.duration_ms ?? Date.now() - taskStartTime;
      results.push(result);
      completed.set(task.id, result);
      options.onProgress?.(
        `[${task.id}] 完成：${result.status}`,
      );
    } catch (error) {
      const failed: TaskResult = {
        task_id: task.id,
        status: "failed",
        duration_ms: Date.now() - taskStartTime,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(failed);
      completed.set(task.id, failed);
      options.onProgress?.(`[${task.id}] 執行失敗：${failed.error}`);
    }
  }

  // 4. 產出報告
  const summary = buildSummary(results, Date.now() - startTime);
  return { summary, tasks: results };
}

/**
 * 執行所有 safety hooks
 *
 * @returns 攔截原因（null 表示通過）
 */
async function runSafetyHooks(
  task: Task,
  hooks: SafetyHook[],
): Promise<string | null> {
  for (const hook of hooks) {
    const allowed = await hook(task);
    if (!allowed) {
      return `Task ${task.id} 被 safety hook 拒絕`;
    }
  }
  return null;
}

/**
 * 彙整執行摘要
 */
function buildSummary(results: TaskResult[], totalDuration: number): ExecutionSummary {
  const statusCounts: Record<TaskStatus, number> = {
    success: 0,
    failed: 0,
    skipped: 0,
    timeout: 0,
  };

  let totalCost = 0;
  for (const r of results) {
    statusCounts[r.status]++;
    totalCost += r.cost_usd ?? 0;
  }

  return {
    total_tasks: results.length,
    succeeded: statusCounts.success,
    failed: statusCounts.failed + statusCounts.timeout,
    skipped: statusCounts.skipped,
    total_cost_usd: totalCost,
    total_duration_ms: totalDuration,
  };
}
