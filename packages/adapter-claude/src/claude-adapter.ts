/**
 * Claude Agent SDK Adapter
 *
 * 透過 @anthropic-ai/claude-agent-sdk 呼叫 Claude Code 執行任務。
 * 支援 session resume、fork、max_turns、max_budget_usd。
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKToolProgressMessage,
  Options,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentAdapter,
  AgentType,
  ExecuteOptions,
  FailureSource,
  Task,
  TaskResult,
  TaskStreamEvent,
} from "@devap/core";
import {
  generateFullHooksStrategy,
  writeHarnessConfig,
  cleanupHarnessConfig,
} from "./harness-config.js";

/**
 * Claude Agent SDK Adapter
 *
 * 將 devap 的 Task 轉換為 Claude Agent SDK 的 query 呼叫。
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly name: AgentType = "claude";

  /**
   * 執行單一任務
   *
   * 將 task spec 作為 prompt 送給 Claude Agent SDK，
   * 解析回傳的 message stream 提取 session_id、status、cost。
   *
   * @param task - 要執行的任務
   * @param options - 執行選項
   * @returns 任務執行結果
   */
  async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
    const startTime = Date.now();

    // XSPEC-048: 執行前快速檢查（pre-abort）
    if (options.signal?.aborted) {
      return {
        task_id: task.id,
        status: "cancelled",
        cancellation_reason: String(options.signal.reason ?? "pre-abort"),
        duration_ms: 0,
      };
    }

    // Phase 1: 注入 hooks 配置（SPEC-009）
    const hooksWritten = await this.injectHarnessHooks(task, options);

    const prompt = this.buildPrompt(task);
    const sdkOptions = this.buildOptions(task, options);

    let sessionId: string | undefined;
    let resultMessage: SDKResultMessage | undefined;

    try {
      const stream = query({ prompt, options: sdkOptions });

      for await (const message of stream) {
        // XSPEC-048: 迭代中途檢查 signal
        if (options.signal?.aborted) {
          return {
            task_id: task.id,
            session_id: sessionId,
            status: "cancelled",
            cancellation_reason: String(options.signal.reason ?? "mid-stream-abort"),
            duration_ms: Date.now() - startTime,
          };
        }

        // 提取 session_id（init 訊息）
        if (message.type === "system" && message.subtype === "init") {
          sessionId = (message as SDKSystemMessage).session_id;
          options.onProgress?.(`[${task.id}] session: ${sessionId}`);
        }

        // 捕獲結果訊息
        if (message.type === "result") {
          resultMessage = message as SDKResultMessage;
        }
      }

      return this.buildResult(task, sessionId, resultMessage, startTime);
    } catch (error) {
      // XSPEC-048: AbortError → cancelled TaskResult（不拋出 UnhandledPromiseRejection）
      if (error instanceof Error && error.name === "AbortError") {
        return {
          task_id: task.id,
          session_id: sessionId,
          status: "cancelled",
          cancellation_reason: options.signal?.reason !== undefined
            ? String(options.signal.reason)
            : "abort-error",
          duration_ms: Date.now() - startTime,
        };
      }
      return {
        task_id: task.id,
        session_id: sessionId,
        status: "failed",
        duration_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Phase 3: 清理 hooks 配置（SPEC-009）
      if (hooksWritten) {
        await cleanupHarnessConfig(options.cwd);
      }
    }
  }

  /**
   * 以串流方式執行單一任務（XSPEC-042）
   *
   * 暴露 SDK 內部 stream，讓呼叫方即時接收進度事件。
   * 事件類型：
   * - tool_start：來自 SDKAssistantMessage 的 tool_use content block
   * - tool_end：來自 SDKToolProgressMessage（含 elapsed_time_seconds → duration_ms）
   * - output_chunk：來自 SDKAssistantMessage 的 text content block
   * - progress：來自 SDKTaskProgressMessage 的 description
   *
   * Generator 結束時 return TaskResult（不 yield）。
   */
  async *executeTaskStream(
    task: Task,
    options: ExecuteOptions,
  ): AsyncGenerator<TaskStreamEvent, TaskResult> {
    const startTime = Date.now();

    // 注入 Harness hooks 配置（SPEC-009）
    const hooksWritten = await this.injectHarnessHooks(task, options);

    const prompt = this.buildPrompt(task);
    const sdkOptions = this.buildOptions(task, options);

    let sessionId: string | undefined;
    let resultMessage: SDKResultMessage | undefined;

    // 追蹤工具呼叫開始時間（tool_use_id → start timestamp）
    const toolStartTimes = new Map<string, number>();
    let stepCount = 0;

    try {
      const stream = query({ prompt, options: sdkOptions });

      for await (const message of stream) {
        // 提取 session_id
        if (message.type === "system" && message.subtype === "init") {
          sessionId = (message as SDKSystemMessage).session_id;
          options.onProgress?.(`[${task.id}] session: ${sessionId}`);
        }

        // tool_start：從 SDKAssistantMessage 的 content blocks 提取 tool_use
        if (message.type === "assistant") {
          const assistantMsg = message as SDKAssistantMessage;
          const content = assistantMsg.message?.content ?? [];
          for (const block of content) {
            if (block.type === "tool_use") {
              toolStartTimes.set(block.id, Date.now());
              yield {
                type: "tool_start",
                task_id: task.id,
                tool_name: block.name,
                tool_input: block.input,
              };
            } else if (block.type === "text" && block.text) {
              yield {
                type: "output_chunk",
                task_id: task.id,
                chunk: block.text,
              };
            }
          }
        }

        // tool_end：來自 SDKToolProgressMessage
        if (message.type === "tool_progress") {
          const toolMsg = message as SDKToolProgressMessage;
          // 優先使用 SDK 提供的 elapsed_time_seconds（精確），fallback 到 wall clock
          const elapsedMs = Math.round(toolMsg.elapsed_time_seconds * 1000);
          const startedAt = toolStartTimes.get(toolMsg.tool_use_id);
          const wallClockMs = startedAt ? Date.now() - startedAt : 0;
          const durationMs = elapsedMs > 0 ? elapsedMs : wallClockMs;
          yield {
            type: "tool_end",
            task_id: task.id,
            tool_name: toolMsg.tool_name,
            duration_ms: durationMs,
            success: true,
          };
        }

        // progress：來自 SDKTaskProgressMessage
        if (message.type === "system" && (message as { subtype?: string }).subtype === "task_progress") {
          const progressMsg = message as { subtype: string; description: string };
          stepCount++;
          yield {
            type: "progress",
            task_id: task.id,
            message: progressMsg.description,
            step: stepCount,
          };
        }

        // 捕獲結果訊息
        if (message.type === "result") {
          resultMessage = message as SDKResultMessage;
        }
      }

      return this.buildResult(task, sessionId, resultMessage, startTime);
    } catch (error) {
      return {
        task_id: task.id,
        session_id: sessionId,
        status: "failed",
        duration_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // 清理 hooks 配置（SPEC-009）
      if (hooksWritten) {
        await cleanupHarnessConfig(options.cwd);
      }
    }
  }

  /**
   * 注入 Harness hooks 配置到 worktree（SPEC-009）
   *
   * 根據 qualityConfig 生成完整 hooks 策略並寫入 {cwd}/.claude/settings.json。
   * 無 qualityConfig 時不注入（向後相容）。
   */
  private async injectHarnessHooks(task: Task, options: ExecuteOptions): Promise<boolean> {
    if (!options.qualityConfig) return false;

    const config = generateFullHooksStrategy(options.qualityConfig, {
      verifyCommand: options.qualityConfig.verify ? task.verify_command : undefined,
    });

    await writeHarnessConfig(config, options.cwd);
    return true;
  }

  /**
   * 檢查 Claude CLI 是否可用
   *
   * 嘗試執行 `claude --version` 確認 CLI 已安裝。
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync("claude", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 恢復指定 session
   *
   * @param sessionId - 要恢復的 session ID
   */
  async resumeSession(sessionId: string): Promise<void> {
    // Claude Agent SDK 透過 query options.resume 實現
    // 此方法為預留介面，實際 resume 邏輯在 executeTask 中透過 options.sessionId 處理
    void sessionId;
  }

  /**
   * 構建送給 Claude 的 prompt
   *
   * 優先使用 generated_prompt（由 plan-resolver 生成的完整行為規範），
   * 包含角色定義、驗收條件、使用者意圖、約束條件和專案指引。
   * 若無 generated_prompt 則 fallback 到最小化拼接。
   */
  private buildPrompt(task: Task): string {
    // 優先使用 generated_prompt（ResolvedTask 透過 extends Task 傳入）
    const generatedPrompt = (task as { generated_prompt?: string }).generated_prompt;
    if (generatedPrompt) {
      return generatedPrompt;
    }

    // Fallback：最小化 prompt
    let prompt = `請執行以下任務：\n\n## ${task.title}\n\n${task.spec}`;

    if (task.verify_command) {
      prompt += `\n\n## 驗收條件\n執行完成後請用以下指令驗證：\n\`\`\`bash\n${task.verify_command}\n\`\`\``;
    }

    return prompt;
  }

  /**
   * 構建 SDK options
   */
  private buildOptions(task: Task, options: ExecuteOptions): Options {
    const sdkOptions: Options = {
      cwd: options.cwd,
      permissionMode: "acceptEdits",
    };

    // Session resume / fork
    if (options.sessionId) {
      sdkOptions.resume = options.sessionId;
      if (options.forkSession ?? task.fork_session) {
        sdkOptions.forkSession = true;
      }
    }

    // 限制
    if (task.max_turns) sdkOptions.maxTurns = task.max_turns;
    if (task.max_budget_usd) sdkOptions.maxBudgetUsd = task.max_budget_usd;

    // 工具限制
    if (task.allowed_tools) {
      sdkOptions.allowedTools = [...task.allowed_tools];
    }

    // XSPEC-048: 將 AbortSignal 橋接至 SDK 的 abortController
    // SDK 接受 AbortController，但我們對外暴露 AbortSignal（更標準的 API）
    // 使用 proxy AbortController 橋接：當 signal abort 時，觸發 controller.abort()
    if (options.signal) {
      const controller = new AbortController();
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener("abort", () => {
          controller.abort(options.signal!.reason);
        }, { once: true });
      }
      sdkOptions.abortController = controller;
    }

    return sdkOptions;
  }

  /**
   * 從 SDK 結果構建 TaskResult
   */
  private buildResult(
    task: Task,
    sessionId: string | undefined,
    result: SDKResultMessage | undefined,
    startTime: number,
  ): TaskResult {
    if (!result) {
      return {
        task_id: task.id,
        session_id: sessionId,
        status: "failed",
        duration_ms: Date.now() - startTime,
        error: "未收到結果訊息",
      };
    }

    const costUsd = result.total_cost_usd;
    const durationMs = result.duration_ms;

    if (result.subtype === "success") {
      return {
        task_id: task.id,
        session_id: sessionId ?? result.session_id,
        status: "success",
        cost_usd: costUsd,
        duration_ms: durationMs,
        verification_passed: true,
      };
    }

    // 錯誤情況
    const isResourceExhaustion = result.subtype === "error_max_turns" || result.subtype === "error_max_budget_usd";
    const status = isResourceExhaustion ? "timeout" as const : "failed" as const;

    return {
      task_id: task.id,
      session_id: sessionId ?? result.session_id,
      status,
      cost_usd: costUsd,
      duration_ms: durationMs,
      error: result.subtype,
      ...(isResourceExhaustion && {
        failureSource: "resource_exhaustion" as FailureSource,
        failureDetail: {
          source: "resource_exhaustion" as FailureSource,
          raw_error: result.subtype,
          detected_by: "claude-adapter",
          timestamp: new Date().toISOString(),
        },
      }),
    };
  }
}
