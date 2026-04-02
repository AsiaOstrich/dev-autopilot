/**
 * History Writer（SPEC-008 REQ-002, REQ-003）
 *
 * 每個 task 執行完畢後自動產出結構化 artifacts，
 * 更新 L2 task manifest 和 L1 全域 index。
 * 所有內容在寫入前經過 redactor 處理。
 */

import type { Task, TaskResult } from "../types.js";
import type {
  StorageBackend,
  ExecutionHistoryConfig,
  RunContext,
  TaskManifest,
  RunHistoryEntry,
  HistoryIndex,
  HistoryIndexEntry,
} from "./types.js";
import { SensitiveDataRedactor } from "./redactor.js";

/** Artifact 檔案名稱 */
const ARTIFACT_NAMES = {
  taskDescription: "task-description.md",
  codeDiff: "code-diff.patch",
  testResults: "test-results.json",
  executionLog: "execution-log.jsonl",
  tokenUsage: "token-usage.json",
  finalStatus: "final-status.json",
  errorAnalysis: "error-analysis.md",
} as const;

/**
 * 執行歷史寫入器
 */
export class HistoryWriter {
  private readonly backend: StorageBackend;
  private readonly redactor: SensitiveDataRedactor;

  constructor(
    backend: StorageBackend,
    config: ExecutionHistoryConfig,
  ) {
    this.backend = backend;
    this.redactor = new SensitiveDataRedactor(config.extra_sensitive_patterns);
  }

  /**
   * 記錄單次 task 執行結果
   */
  async recordRun(
    task: Task,
    result: TaskResult,
    context: RunContext,
  ): Promise<void> {
    const taskId = task.id;

    // 讀取現有 manifest 以決定 run number
    const manifest = await this.readManifest(taskId);
    const runNumber = this.nextRunNumber(manifest);
    const runDir = `${taskId}/${runNumber}`;

    // 寫入 artifacts
    const artifactNames = await this.writeArtifacts(runDir, task, result, context);

    // 更新 manifest
    await this.updateManifest(taskId, task, result, runNumber, artifactNames, manifest);

    // 更新 index
    await this.updateIndex(taskId, task.title, result, runNumber, manifest);
  }

  private async writeArtifacts(
    runDir: string,
    task: Task,
    result: TaskResult,
    context: RunContext,
  ): Promise<string[]> {
    const names: string[] = [];

    // 1. task-description.md
    const desc = this.buildTaskDescription(task);
    await this.writeRedacted(`${runDir}/${ARTIFACT_NAMES.taskDescription}`, desc);
    names.push(ARTIFACT_NAMES.taskDescription);

    // 2. code-diff.patch
    await this.writeRedacted(`${runDir}/${ARTIFACT_NAMES.codeDiff}`, context.codeDiff ?? "");
    names.push(ARTIFACT_NAMES.codeDiff);

    // 3. test-results.json
    const testResults = JSON.stringify(result.verification_evidence ?? [], null, 2);
    await this.writeRedacted(`${runDir}/${ARTIFACT_NAMES.testResults}`, testResults);
    names.push(ARTIFACT_NAMES.testResults);

    // 4. execution-log.jsonl
    const logLines = (context.executionLog ?? []).map(e => JSON.stringify(e)).join("\n");
    await this.writeRedacted(`${runDir}/${ARTIFACT_NAMES.executionLog}`, logLines);
    names.push(ARTIFACT_NAMES.executionLog);

    // 5. token-usage.json
    const tokenUsage = JSON.stringify({ total: { cost_usd: result.cost_usd ?? 0 }, breakdown: [] }, null, 2);
    await this.writeRedacted(`${runDir}/${ARTIFACT_NAMES.tokenUsage}`, tokenUsage);
    names.push(ARTIFACT_NAMES.tokenUsage);

    // 6. final-status.json
    const finalStatus = JSON.stringify({
      status: result.status,
      error: result.error ?? null,
      duration_ms: result.duration_ms ?? 0,
    }, null, 2);
    await this.writeRedacted(`${runDir}/${ARTIFACT_NAMES.finalStatus}`, finalStatus);
    names.push(ARTIFACT_NAMES.finalStatus);

    // 7. error-analysis.md（僅失敗時）
    if (result.status === "failed") {
      const errorAnalysis = this.buildErrorAnalysis(result, context);
      await this.writeRedacted(`${runDir}/${ARTIFACT_NAMES.errorAnalysis}`, errorAnalysis);
      names.push(ARTIFACT_NAMES.errorAnalysis);
    }

    return names;
  }

  private buildTaskDescription(task: Task): string {
    const lines = [`# ${task.title}`, "", task.spec];
    if (task.acceptance_criteria?.length) {
      lines.push("", "## Acceptance Criteria");
      for (const ac of task.acceptance_criteria) {
        lines.push(`- ${ac}`);
      }
    }
    return lines.join("\n");
  }

  private buildErrorAnalysis(result: TaskResult, context: RunContext): string {
    const lines = ["# Error Analysis", "", `## Error`, result.error ?? "Unknown error"];
    if (context.previousAttempts?.length) {
      lines.push("", "## Previous Attempts");
      for (const attempt of context.previousAttempts) {
        lines.push(`- **${attempt.hypothesis}**: ${attempt.result}`);
      }
    }
    return lines.join("\n");
  }

  private async writeRedacted(path: string, content: string): Promise<void> {
    await this.backend.writeFile(path, this.redactor.redact(content));
  }

  private async readManifest(taskId: string): Promise<TaskManifest | null> {
    const raw = await this.backend.readFile(`${taskId}/manifest.json`);
    if (!raw) return null;
    return JSON.parse(raw) as TaskManifest;
  }

  private nextRunNumber(manifest: TaskManifest | null): string {
    const count = manifest?.run_history.length ?? 0;
    return String(count + 1).padStart(3, "0");
  }

  private async updateManifest(
    taskId: string,
    task: Task,
    result: TaskResult,
    runNumber: string,
    artifactNames: string[],
    existing: TaskManifest | null,
  ): Promise<void> {
    const runEntry: RunHistoryEntry = {
      run: runNumber,
      status: result.status === "success" ? "success" : "failure",
      date: new Date().toISOString(),
      duration_s: Math.round((result.duration_ms ?? 0) / 1000),
      tokens_total: Math.round((result.cost_usd ?? 0) * 1000), // rough estimate
    };

    const runHistory = [...(existing?.run_history ?? []), runEntry];
    const successCount = runHistory.filter(r => r.status === "success").length;
    const totalDuration = runHistory.reduce((s, r) => s + r.duration_s, 0);
    const totalTokens = runHistory.reduce((s, r) => s + r.tokens_total, 0);

    const manifest: TaskManifest = {
      task_id: taskId,
      task_description_summary: this.redactor.redact(`${task.title}: ${task.spec}`.slice(0, 200)),
      run_history: runHistory,
      key_metrics: {
        pass_rate: successCount / runHistory.length,
        avg_tokens: Math.round(totalTokens / runHistory.length),
        avg_duration_s: Math.round(totalDuration / runHistory.length),
      },
      artifacts_available: artifactNames,
      failure_summary: result.status === "failed" ? this.redactor.redact(result.error ?? "Unknown") : existing?.failure_summary,
    };

    await this.backend.writeFile(`${taskId}/manifest.json`, JSON.stringify(manifest, null, 2));
  }

  private async updateIndex(
    taskId: string,
    taskName: string,
    result: TaskResult,
    runNumber: string,
    existingManifest: TaskManifest | null,
  ): Promise<void> {
    const raw = await this.backend.readFile("index.json");
    const index: HistoryIndex = raw
      ? JSON.parse(raw) as HistoryIndex
      : {
          version: "1.0.0",
          updated: new Date().toISOString(),
          max_active_tasks: 50,
          archive_threshold_days: 90,
          tasks: [],
        };

    const existingIdx = index.tasks.findIndex(t => t.task_id === taskId);
    const totalRuns = (existingManifest?.run_history.length ?? 0) + 1;

    const entry: HistoryIndexEntry = {
      task_id: taskId,
      task_name: taskName,
      tags: [],
      latest_run: runNumber,
      latest_status: result.status === "success" ? "success" : "failure",
      latest_date: new Date().toISOString(),
      total_runs: totalRuns,
    };

    if (existingIdx >= 0) {
      index.tasks[existingIdx] = entry;
    } else {
      index.tasks.push(entry);
    }

    index.updated = new Date().toISOString();
    await this.backend.writeFile("index.json", JSON.stringify(index, null, 2));
  }
}
