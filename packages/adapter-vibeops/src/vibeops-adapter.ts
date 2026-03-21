/**
 * VibeOps Adapter
 *
 * 透過 HTTP API 整合 VibeOps 7+1 agents。
 * 所有通訊透過 REST API，不 import VibeOps 程式碼，確保 MIT 授權隔離。
 */

import type {
  AgentAdapter,
  AgentType,
  ExecuteOptions,
  Task,
  TaskResult,
} from "@devap/core";

import { mapSpecToAgent } from "./agent-mapper.js";
import type {
  VibeOpsAdapterConfig,
  VibeOpsHealthResponse,
  VibeOpsTaskRequest,
  VibeOpsTaskResponse,
} from "./types.js";

/**
 * VibeOps Adapter — 讓 DevAP 編排 VibeOps 7+1 agents
 *
 * 使用方式：
 * ```typescript
 * const adapter = new VibeOpsAdapter({ baseUrl: "http://localhost:3360" });
 * const result = await adapter.executeTask(task, options);
 * ```
 *
 * VibeOps 端需要運行 Web API（REST）。
 */
export class VibeOpsAdapter implements AgentAdapter {
  readonly name: AgentType = "vibeops" as AgentType;

  private readonly config: VibeOpsAdapterConfig;

  constructor(config: VibeOpsAdapterConfig) {
    this.config = config;
  }

  /**
   * 檢查 VibeOps 服務是否可用
   *
   * 透過 GET /api/health 端點確認。
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/health`, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return false;

      const data = (await response.json()) as VibeOpsHealthResponse;
      return data.status === "ok";
    } catch {
      return false;
    }
  }

  /**
   * 執行單一任務
   *
   * 根據 task.spec 推斷對應的 VibeOps agent，
   * 透過 REST API 提交並等待結果。
   */
  async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      const agent = mapSpecToAgent(task.spec);

      const requestBody: VibeOpsTaskRequest = {
        agent,
        spec: task.spec,
        taskId: task.id,
        sessionId: options.sessionId,
        pipelineOptions: this.config.pipelineOptions,
      };

      const response = await fetch(`${this.config.baseUrl}/api/task/execute`, {
        method: "POST",
        headers: {
          ...this.buildHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return this.buildFailResult(task.id, startTime, `HTTP ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as VibeOpsTaskResponse;

      return {
        task_id: task.id,
        session_id: data.sessionId,
        status: data.status,
        cost_usd: data.costUsd,
        duration_ms: data.durationMs,
        verification_passed: data.reviewerPassed ?? (data.status === "success"),
        error: data.status !== "success" ? data.result : undefined,
      };
    } catch (error) {
      return this.buildFailResult(
        task.id,
        startTime,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * 恢復先前暫停的 pipeline session
   */
  async resumeSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/pipeline/resume`, {
      method: "POST",
      headers: {
        ...this.buildHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pipeline resume 失敗：HTTP ${response.status}: ${errorText}`);
    }
  }

  /**
   * 構建 HTTP 請求標頭
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiToken) {
      headers["Authorization"] = `Bearer ${this.config.apiToken}`;
    }
    return headers;
  }

  /**
   * 構建失敗結果
   */
  private buildFailResult(taskId: string, startTime: number, error: string): TaskResult {
    return {
      task_id: taskId,
      status: "failed",
      duration_ms: Date.now() - startTime,
      error,
    };
  }
}
