/**
 * 編排器（Orchestrator）
 *
 * 核心編排引擎：載入 task plan → 解析 DAG → 依序/並行執行 → 產出報告。
 * 支援並行模式：同層 tasks 使用 Promise.all() 並行執行。
 */

import { validatePlan } from "./plan-validator.js";
import { runFixLoop, type ExecuteResult } from "./fix-loop.js";
import { runQualityGate, type ShellExecutor } from "./quality-gate.js";
import { runJudge, shouldRunJudge } from "./judge.js";
import type {
  AgentAdapter,
  CheckpointAction,
  CheckpointSummary,
  ExecuteOptions,
  ExecutionReport,
  ExecutionSummary,
  OrchestratorOptions,
  QualityConfig,
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
 * 將 DAG 拓撲排序結果分層輸出
 *
 * 同一層的 tasks 彼此間無依賴關係，可並行執行。
 * 使用 Kahn's algorithm 的變體，每次將所有入度為 0 的節點作為一層。
 *
 * @param tasks - 任務列表
 * @returns 分層的任務列表，每層為可並行的 task 陣列
 * @throws 若存在循環依賴
 */
export function topologicalLayers(tasks: Task[]): Task[][] {
  const taskMap = new Map<string, Task>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const task of tasks) {
    taskMap.set(task.id, task);
    inDegree.set(task.id, 0);
    adj.set(task.id, []);
  }

  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      adj.get(dep)!.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  const layers: Task[][] = [];
  let remaining = tasks.length;

  while (remaining > 0) {
    // 收集所有入度為 0 的節點作為當前層
    const layer: Task[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        layer.push(taskMap.get(id)!);
      }
    }

    if (layer.length === 0) {
      throw new Error("依賴圖存在循環，無法排序");
    }

    // 移除當前層的節點，更新後續節點入度
    for (const task of layer) {
      inDegree.delete(task.id);
      for (const neighbor of adj.get(task.id) ?? []) {
        inDegree.set(neighbor, (inDegree.get(neighbor) ?? 1) - 1);
      }
    }

    layers.push(layer);
    remaining -= layer.length;
  }

  return layers;
}

/**
 * 合併 task 層級參數與 plan 預設值
 *
 * task 層級的值優先於 defaults。
 */
export function mergeDefaults(task: Task, plan: TaskPlan): Task {
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
 * 2. 拓撲排序（序列模式）或分層（並行模式）
 * 3. 依序/並行執行每個 task
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

  const startTime = Date.now();

  // 2. 選擇執行模式
  if (options.parallel) {
    const results = await orchestrateParallel(plan, adapter, options);
    return buildReport(results, Date.now() - startTime, options.qualityConfig);
  }

  // 序列模式（原有邏輯）
  const results = await orchestrateSequential(plan, adapter, options);
  return buildReport(results, Date.now() - startTime, options.qualityConfig);
}

/**
 * 序列模式：依拓撲順序逐一執行 task
 */
async function orchestrateSequential(
  plan: TaskPlan,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
): Promise<TaskResult[]> {
  const sortedTasks = topologicalSort(plan.tasks);
  const results: TaskResult[] = [];
  const completed = new Map<string, TaskResult>();
  const checkpointPolicy = options.checkpointPolicy ?? "never";

  for (let i = 0; i < sortedTasks.length; i++) {
    const task = mergeDefaults(sortedTasks[i], plan);
    const result = await executeOneTask(task, adapter, options, completed);
    results.push(result);
    completed.set(task.id, result);

    // 層間 Checkpoint（序列模式中每個 task 視為一層）
    if (checkpointPolicy === "after_each_layer" && options.onCheckpoint && i < sortedTasks.length - 1) {
      const action = await handleCheckpoint(options.onCheckpoint, i, sortedTasks.length, [result], results);
      if (action === "abort") {
        options.onProgress?.(`Checkpoint: 使用者中止，停止後續任務`);
        break;
      }
      // retry_layer in sequential mode: re-execute the current task
      if (action === "retry_layer") {
        results.pop();
        completed.delete(task.id);
        i--; // 回到同一 task 重新執行
        options.onProgress?.(`Checkpoint: 重做 ${task.id}`);
      }
    }
  }

  return results;
}

/**
 * 並行模式：同層 tasks 使用 Promise.all 並行執行
 *
 * 每層完成後才執行下一層，確保依賴順序正確。
 * 支援 maxParallel 限制同時執行的 task 數量。
 */
async function orchestrateParallel(
  plan: TaskPlan,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
): Promise<TaskResult[]> {
  const layers = topologicalLayers(plan.tasks);
  const results: TaskResult[] = [];
  const completed = new Map<string, TaskResult>();
  const maxParallel = options.maxParallel ?? plan.max_parallel ?? Infinity;

  options.onProgress?.(`並行模式啟動，共 ${layers.length} 層，最大並行數 ${maxParallel === Infinity ? "無限制" : maxParallel}`);

  const checkpointPolicy = options.checkpointPolicy ?? "never";

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    options.onProgress?.(`--- 第 ${layerIdx + 1}/${layers.length} 層：${layer.map(t => t.id).join(", ")} ---`);

    // 準備本層的 tasks（合併 defaults）
    const mergedTasks = layer.map(t => mergeDefaults(t, plan));

    // 分批執行（受 maxParallel 限制）
    const layerResults: TaskResult[] = [];
    for (let i = 0; i < mergedTasks.length; i += maxParallel) {
      const batch = mergedTasks.slice(i, i + maxParallel);
      const batchResults = await Promise.all(
        batch.map(task => executeOneTask(task, adapter, options, completed)),
      );
      layerResults.push(...batchResults);
    }

    // 記錄本層結果
    for (const result of layerResults) {
      results.push(result);
      completed.set(result.task_id, result);
    }

    // 層間 Checkpoint
    if (checkpointPolicy === "after_each_layer" && options.onCheckpoint && layerIdx < layers.length - 1) {
      const action = await handleCheckpoint(options.onCheckpoint, layerIdx, layers.length, layerResults, results);
      if (action === "abort") {
        options.onProgress?.(`Checkpoint: 使用者中止，停止後續層`);
        break;
      }
      if (action === "retry_layer") {
        // 重做本層：移除本層結果，重新執行
        for (const result of layerResults) {
          results.pop();
          completed.delete(result.task_id);
        }
        layerIdx--; // 回到同一層重新執行
        options.onProgress?.(`Checkpoint: 重做第 ${layerIdx + 2} 層`);
      }
    }
  }

  return results;
}

/**
 * 預設的 shell 執行器（用於 quality gate）
 */
const defaultShellExecutor: ShellExecutor = async (command, cwd) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
      cwd,
      timeout: 120_000,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error: unknown) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: err.code ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
};

/**
 * 執行單一 task（共用邏輯，序列/並行模式都使用）
 *
 * 若 options.qualityConfig 存在，完整流程為：
 * 1. adapter.executeTask()
 * 2. Quality Gate（verify + lint + type_check）
 * 3. Judge（依 policy）
 * 4. 若失敗 → Fix Loop 自動重試
 */
async function executeOneTask(
  task: Task,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
  completed: Map<string, TaskResult>,
): Promise<TaskResult> {
  // 檢查依賴是否都成功
  const depsFailed = (task.depends_on ?? []).some(
    (dep) => completed.get(dep)?.status !== "success",
  );

  if (depsFailed) {
    options.onProgress?.(`[${task.id}] 跳過：依賴任務失敗`);
    return {
      task_id: task.id,
      status: "skipped",
      duration_ms: 0,
      error: "依賴任務失敗，跳過執行",
    };
  }

  // 執行 safety hooks
  if (options.safetyHooks) {
    const blocked = await runSafetyHooks(task, options.safetyHooks);
    if (blocked) {
      options.onProgress?.(`[${task.id}] 被攔截：${blocked}`);
      return {
        task_id: task.id,
        status: "failed",
        duration_ms: 0,
        error: `Safety hook 攔截：${blocked}`,
      };
    }
  }

  const taskStartTime = Date.now();
  const qc = options.qualityConfig;

  // 無品質設定（none 或未設定）→ 走原有邏輯
  if (!qc || (!qc.verify && qc.judge_policy === "never" && qc.max_retries === 0)) {
    return executeTaskSimple(task, adapter, options, taskStartTime);
  }

  // 有品質設定 → 走 fix loop + quality gate + judge
  return executeTaskWithQuality(task, adapter, options, qc, taskStartTime);
}

/**
 * 簡單執行模式（無品質門檻，與原有行為一致）
 */
async function executeTaskSimple(
  task: Task,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
  taskStartTime: number,
): Promise<TaskResult> {
  options.onProgress?.(`[${task.id}] 開始執行：${task.title}`);
  try {
    const execOpts: ExecuteOptions = {
      cwd: options.cwd,
      sessionId: options.sessionId,
      forkSession: task.fork_session,
      onProgress: options.onProgress,
    };
    const result = await adapter.executeTask(task, execOpts);
    result.duration_ms = result.duration_ms ?? Date.now() - taskStartTime;
    options.onProgress?.(`[${task.id}] 完成：${result.status}`);
    return result;
  } catch (error) {
    const failed: TaskResult = {
      task_id: task.id,
      status: "failed",
      duration_ms: Date.now() - taskStartTime,
      error: error instanceof Error ? error.message : String(error),
    };
    options.onProgress?.(`[${task.id}] 執行失敗：${failed.error}`);
    return failed;
  }
}

/**
 * 品質增強執行模式（quality gate + judge + fix loop）
 */
async function executeTaskWithQuality(
  task: Task,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
  qc: QualityConfig,
  taskStartTime: number,
): Promise<TaskResult> {
  options.onProgress?.(`[${task.id}] 開始執行（品質模式）：${task.title}`);

  const fixLoopResult = await runFixLoop(
    { max_retries: qc.max_retries, max_retry_budget_usd: qc.max_retry_budget_usd },
    {
      execute: async (feedback, attempt): Promise<ExecuteResult> => {
        // 構建執行 prompt（重試時注入 feedback）
        const taskWithFeedback = feedback
          ? { ...task, spec: `${task.spec}\n\n---\n\n## 前次失敗回饋（請針對性修正）\n\n${feedback}` }
          : task;

        // 1. 執行 task
        let taskResult: TaskResult;
        try {
          const execOpts: ExecuteOptions = {
            cwd: options.cwd,
            sessionId: options.sessionId,
            forkSession: task.fork_session,
            onProgress: options.onProgress,
          };
          taskResult = await adapter.executeTask(taskWithFeedback, execOpts);
        } catch (error) {
          return {
            success: false,
            cost_usd: 0,
            feedback: `執行錯誤：${error instanceof Error ? error.message : String(error)}`,
          };
        }

        if (taskResult.status === "failed") {
          return {
            success: false,
            cost_usd: taskResult.cost_usd ?? 0,
            feedback: `Task 執行失敗：${taskResult.error ?? "未知錯誤"}`,
          };
        }

        // 2. Quality Gate
        const gateResult = await runQualityGate(task, qc, {
          cwd: options.cwd,
          shellExecutor: defaultShellExecutor,
          onProgress: options.onProgress,
        });

        if (!gateResult.passed) {
          options.onProgress?.(`[${task.id}] Quality Gate 失敗（attempt ${attempt}）`);
          return {
            success: false,
            cost_usd: taskResult.cost_usd ?? 0,
            feedback: gateResult.feedback,
          };
        }

        // 3. Judge（依 policy）
        const needJudge = shouldRunJudge(qc.judge_policy, task, true);
        if (needJudge) {
          options.onProgress?.(`[${task.id}] 啟動 Judge 審查`);
          const judgeResult = await runJudge(task, taskResult, {
            cwd: options.cwd,
            onProgress: options.onProgress,
          });

          if (judgeResult.verdict === "REJECT") {
            options.onProgress?.(`[${task.id}] Judge REJECT（attempt ${attempt}）`);
            return {
              success: false,
              cost_usd: (taskResult.cost_usd ?? 0) + (judgeResult.cost_usd ?? 0),
              feedback: `Judge 審查未通過：${judgeResult.reasoning}`,
            };
          }
        }

        // 全部通過
        return {
          success: true,
          cost_usd: taskResult.cost_usd ?? 0,
        };
      },
      onProgress: options.onProgress,
    },
  );

  const duration = Date.now() - taskStartTime;
  const retryCount = fixLoopResult.attempts.length - 1;

  if (fixLoopResult.success) {
    options.onProgress?.(`[${task.id}] 完成：success${retryCount > 0 ? `（重試 ${retryCount} 次）` : ""}`);
    return {
      task_id: task.id,
      status: "success",
      duration_ms: duration,
      cost_usd: fixLoopResult.attempts.reduce((sum, a) => sum + a.cost_usd, 0),
      verification_passed: true,
      retry_count: retryCount,
      retry_cost_usd: fixLoopResult.total_retry_cost_usd,
    };
  }

  const lastAttempt = fixLoopResult.attempts[fixLoopResult.attempts.length - 1];
  options.onProgress?.(`[${task.id}] 失敗：${fixLoopResult.stop_reason}（${retryCount} 次重試後）`);
  return {
    task_id: task.id,
    status: "failed",
    duration_ms: duration,
    cost_usd: fixLoopResult.attempts.reduce((sum, a) => sum + a.cost_usd, 0),
    error: `${fixLoopResult.stop_reason}: ${lastAttempt?.feedback ?? "未知錯誤"}`,
    retry_count: retryCount,
    retry_cost_usd: fixLoopResult.total_retry_cost_usd,
  };
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
 * 處理層間 Checkpoint
 */
async function handleCheckpoint(
  onCheckpoint: (summary: CheckpointSummary) => Promise<CheckpointAction>,
  layerIndex: number,
  totalLayers: number,
  layerResults: TaskResult[],
  allResults: TaskResult[],
): Promise<CheckpointAction> {
  const summary: CheckpointSummary = {
    layer_index: layerIndex,
    total_layers: totalLayers,
    layer_results: layerResults,
    all_results: [...allResults],
  };
  return onCheckpoint(summary);
}

/**
 * 彙整執行報告（含品質指標）
 */
function buildReport(
  results: TaskResult[],
  totalDuration: number,
  qualityConfig?: QualityConfig,
): ExecutionReport {
  const summary = buildSummary(results, totalDuration);
  const report: ExecutionReport = { summary, tasks: results };

  // 若啟用品質模式，計算 quality_metrics
  if (qualityConfig && !(
    !qualityConfig.verify && qualityConfig.judge_policy === "never" && qualityConfig.max_retries === 0
  )) {
    report.quality_metrics = buildQualityMetrics(results);
  }

  return report;
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

/**
 * 計算品質指標
 */
function buildQualityMetrics(results: TaskResult[]): import("./types.js").QualityMetrics {
  const executed = results.filter((r) => r.status !== "skipped");
  const succeeded = results.filter((r) => r.status === "success");
  const total = executed.length || 1; // 避免除以零

  const totalRetries = results.reduce((sum, r) => sum + (r.retry_count ?? 0), 0);
  const totalRetryCost = results.reduce((sum, r) => sum + (r.retry_cost_usd ?? 0), 0);
  const firstPassCount = succeeded.filter((r) => (r.retry_count ?? 0) === 0).length;

  return {
    verification_pass_rate: succeeded.length / total,
    judge_pass_rate: succeeded.length / total, // 品質模式下，success 意味著 judge 也通過
    total_retries: totalRetries,
    total_retry_cost_usd: totalRetryCost,
    safety_issues_count: 0, // 由 plan-resolver 階段報告，此處為執行階段
    first_pass_rate: firstPassCount / total,
  };
}
