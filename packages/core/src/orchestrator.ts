/**
 * 編排器（Orchestrator）
 *
 * 核心編排引擎：載入 task plan → 解析 DAG → 依序/並行執行 → 產出報告。
 * 支援並行模式：同層 tasks 使用 Promise.all() 並行執行。
 */

import { validatePlan } from "./plan-validator.js";
import { runFixLoop, type ExecuteResult } from "./fix-loop.js";
import { runQualityGate, type ShellExecutor } from "./quality-gate.js";
import { runDualStageJudge, shouldRunJudge } from "./judge.js";
import { WorktreeManager } from "./worktree-manager.js";
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
    test_levels: task.test_levels ?? defaults.test_levels,
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

  // 2. Worktree 隔離模式（借鑑 Superpowers Git Worktree 隔離執行）
  let worktreeManager: WorktreeManager | undefined;
  if (options.isolation === "worktree") {
    worktreeManager = new WorktreeManager(options.cwd);
    options.onProgress?.("啟用 Worktree 隔離模式");
  }

  // 3. 選擇執行模式
  try {
    if (options.parallel) {
      const results = await orchestrateParallel(plan, adapter, options, worktreeManager);
      return buildReport(results, Date.now() - startTime, options.qualityConfig);
    }

    // 序列模式（原有邏輯）
    const results = await orchestrateSequential(plan, adapter, options, worktreeManager);
    return buildReport(results, Date.now() - startTime, options.qualityConfig);
  } finally {
    // 清理所有 worktree
    if (worktreeManager) {
      await worktreeManager.cleanupAll().catch(() => {});
    }
  }
}

/**
 * 序列模式：依拓撲順序逐一執行 task
 */
async function orchestrateSequential(
  plan: TaskPlan,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
  worktreeManager?: WorktreeManager,
): Promise<TaskResult[]> {
  const sortedTasks = topologicalSort(plan.tasks);
  const results: TaskResult[] = [];
  const completed = new Map<string, TaskResult>();
  const checkpointPolicy = options.checkpointPolicy ?? "never";
  let totalCostAccum = 0;

  for (let i = 0; i < sortedTasks.length; i++) {
    // Plan 層級預算檢查（SPEC-005 AC-005-003）
    if (plan.max_total_budget_usd && totalCostAccum >= plan.max_total_budget_usd) {
      options.onProgress?.(`⚠️ 總成本 $${totalCostAccum.toFixed(2)} 已達上限 $${plan.max_total_budget_usd}，停止執行`);
      // 將剩餘 tasks 標記為 skipped
      for (let j = i; j < sortedTasks.length; j++) {
        results.push({
          task_id: sortedTasks[j].id,
          status: "skipped",
          duration_ms: 0,
          error: `Plan 總預算上限 $${plan.max_total_budget_usd} 已達到`,
        });
      }
      break;
    }

    const task = mergeDefaults(sortedTasks[i], plan);
    const result = await executeOneTask(task, adapter, options, completed, worktreeManager);
    results.push(result);
    completed.set(task.id, result);
    totalCostAccum += result.cost_usd ?? 0;

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
  worktreeManager?: WorktreeManager,
): Promise<TaskResult[]> {
  const layers = topologicalLayers(plan.tasks);
  const results: TaskResult[] = [];
  const completed = new Map<string, TaskResult>();
  const maxParallel = options.maxParallel ?? plan.max_parallel ?? Infinity;
  let totalCostAccum = 0;

  options.onProgress?.(`並行模式啟動，共 ${layers.length} 層，最大並行數 ${maxParallel === Infinity ? "無限制" : maxParallel}`);

  const checkpointPolicy = options.checkpointPolicy ?? "never";

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    // Plan 層級預算檢查（SPEC-005 AC-005-003）
    if (plan.max_total_budget_usd && totalCostAccum >= plan.max_total_budget_usd) {
      options.onProgress?.(`⚠️ 總成本 $${totalCostAccum.toFixed(2)} 已達上限 $${plan.max_total_budget_usd}，停止執行`);
      for (let j = layerIdx; j < layers.length; j++) {
        for (const t of layers[j]) {
          results.push({
            task_id: t.id,
            status: "skipped",
            duration_ms: 0,
            error: `Plan 總預算上限 $${plan.max_total_budget_usd} 已達到`,
          });
        }
      }
      break;
    }

    const layer = layers[layerIdx];
    options.onProgress?.(`--- 第 ${layerIdx + 1}/${layers.length} 層：${layer.map(t => t.id).join(", ")} ---`);

    // 準備本層的 tasks（合併 defaults）
    const mergedTasks = layer.map(t => mergeDefaults(t, plan));

    // 分批執行（受 maxParallel 限制）
    const layerResults: TaskResult[] = [];
    for (let i = 0; i < mergedTasks.length; i += maxParallel) {
      const batch = mergedTasks.slice(i, i + maxParallel);
      const batchResults = await Promise.all(
        batch.map(task => executeOneTask(task, adapter, options, completed, worktreeManager)),
      );
      layerResults.push(...batchResults);
    }

    // 記錄本層結果
    for (const result of layerResults) {
      results.push(result);
      completed.set(result.task_id, result);
      totalCostAccum += result.cost_usd ?? 0;
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
  worktreeManager?: WorktreeManager,
): Promise<TaskResult> {
  // 檢查依賴是否都成功（done_with_concerns 也視為可繼續）
  const depsFailed = (task.depends_on ?? []).some((dep) => {
    const depStatus = completed.get(dep)?.status;
    return depStatus !== "success" && depStatus !== "done_with_concerns";
  });

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
    return executeTaskSimple(task, adapter, options, taskStartTime, worktreeManager);
  }

  // 有品質設定 → 走 fix loop + quality gate + judge
  return executeTaskWithQuality(task, adapter, options, qc, taskStartTime, worktreeManager);
}

/**
 * 簡單執行模式（無品質門檻，與原有行為一致）
 */
async function executeTaskSimple(
  task: Task,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
  taskStartTime: number,
  worktreeManager?: WorktreeManager,
): Promise<TaskResult> {
  options.onProgress?.(`[${task.id}] 開始執行：${task.title}`);

  // Worktree 隔離：為 task 建立獨立 worktree
  let taskCwd = options.cwd;
  if (worktreeManager) {
    try {
      const wtInfo = await worktreeManager.create(task.id);
      taskCwd = wtInfo.path;
      options.onProgress?.(`[${task.id}] 已建立 worktree: ${wtInfo.path}`);
    } catch (error) {
      options.onProgress?.(`[${task.id}] 建立 worktree 失敗，使用原始目錄: ${error instanceof Error ? error.message : error}`);
    }
  }

  try {
    const execOpts: ExecuteOptions = {
      cwd: taskCwd,
      sessionId: options.sessionId,
      forkSession: task.fork_session,
      onProgress: options.onProgress,
      modelTier: task.model_tier,
    };
    const result = await adapter.executeTask(task, execOpts);
    result.duration_ms = result.duration_ms ?? Date.now() - taskStartTime;

    // Worktree 合併
    if (worktreeManager && result.status === "success") {
      try {
        await worktreeManager.merge(task.id);
        options.onProgress?.(`[${task.id}] worktree 已合併`);
      } catch (error) {
        options.onProgress?.(`[${task.id}] worktree 合併失敗: ${error instanceof Error ? error.message : error}`);
      }
    }

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
  worktreeManager?: WorktreeManager,
): Promise<TaskResult> {
  options.onProgress?.(`[${task.id}] 開始執行（品質模式）：${task.title}`);

  // Worktree 隔離
  let taskCwd = options.cwd;
  if (worktreeManager) {
    try {
      const wtInfo = await worktreeManager.create(task.id);
      taskCwd = wtInfo.path;
      options.onProgress?.(`[${task.id}] 已建立 worktree: ${wtInfo.path}`);
    } catch (error) {
      options.onProgress?.(`[${task.id}] 建立 worktree 失敗，使用原始目錄: ${error instanceof Error ? error.message : error}`);
    }
  }

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
            cwd: taskCwd,
            sessionId: options.sessionId,
            forkSession: task.fork_session,
            onProgress: options.onProgress,
            modelTier: task.model_tier,
          };
          taskResult = await adapter.executeTask(taskWithFeedback, execOpts);
        } catch (error) {
          return {
            success: false,
            cost_usd: 0,
            feedback: `執行錯誤：${error instanceof Error ? error.message : String(error)}`,
          };
        }

        // 處理新的 Implementer 狀態（借鑑 Superpowers）
        if (taskResult.status === "failed") {
          return {
            success: false,
            cost_usd: taskResult.cost_usd ?? 0,
            feedback: `Task 執行失敗：${taskResult.error ?? "未知錯誤"}`,
          };
        }
        if (taskResult.status === "blocked") {
          return {
            success: false,
            cost_usd: taskResult.cost_usd ?? 0,
            feedback: `Task 被阻塞：${taskResult.block_reason ?? "未知原因"}。建議升級模型或拆分任務。`,
          };
        }
        if (taskResult.status === "needs_context") {
          return {
            success: false,
            cost_usd: taskResult.cost_usd ?? 0,
            feedback: `Task 需要更多上下文：${taskResult.needed_context ?? "未說明"}。請提供所需資訊後重試。`,
          };
        }

        // 2. Quality Gate
        const gateResult = await runQualityGate(task, qc, {
          cwd: taskCwd,
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

        // 3. 雙階段 Judge（借鑑 Superpowers：Spec Compliance → Code Quality）
        const needJudge = shouldRunJudge(qc.judge_policy, task, true);
        if (needJudge) {
          options.onProgress?.(`[${task.id}] 啟動雙階段 Judge 審查`);
          const judgeResult = await runDualStageJudge(task, taskResult, {
            cwd: taskCwd,
            onProgress: options.onProgress,
          });

          if (judgeResult.verdict === "REJECT") {
            options.onProgress?.(`[${task.id}] Judge REJECT（${judgeResult.review_stage} 階段, attempt ${attempt}）`);
            return {
              success: false,
              cost_usd: (taskResult.cost_usd ?? 0) + (judgeResult.cost_usd ?? 0),
              feedback: `Judge 審查未通過（${judgeResult.review_stage} 階段）：${judgeResult.reasoning}`,
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
    // Worktree 合併
    if (worktreeManager) {
      try {
        await worktreeManager.merge(task.id);
        options.onProgress?.(`[${task.id}] worktree 已合併`);
      } catch (error) {
        options.onProgress?.(`[${task.id}] worktree 合併失敗: ${error instanceof Error ? error.message : error}`);
      }
    }

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
    done_with_concerns: 0,
    needs_context: 0,
    blocked: 0,
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
    done_with_concerns: statusCounts.done_with_concerns,
    needs_context: statusCounts.needs_context,
    blocked: statusCounts.blocked,
    total_cost_usd: totalCost,
    total_duration_ms: totalDuration,
  };
}

/**
 * 計算品質指標
 */
function buildQualityMetrics(results: TaskResult[]): import("./types.js").QualityMetrics {
  const executed = results.filter((r) => r.status !== "skipped");
  const succeeded = results.filter((r) => r.status === "success" || r.status === "done_with_concerns");
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
