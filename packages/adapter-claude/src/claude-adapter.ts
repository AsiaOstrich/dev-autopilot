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
  Options,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentAdapter,
  AgentType,
  ExecuteOptions,
  Task,
  TaskResult,
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

    // Phase 1: 注入 hooks 配置（SPEC-009）
    const hooksWritten = await this.injectHarnessHooks(task, options);

    const prompt = this.buildPrompt(task);
    const sdkOptions = this.buildOptions(task, options);

    let sessionId: string | undefined;
    let resultMessage: SDKResultMessage | undefined;

    try {
      const stream = query({ prompt, options: sdkOptions });

      for await (const message of stream) {
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
      sdkOptions.allowedTools = task.allowed_tools;
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
    const status = result.subtype === "error_max_turns" || result.subtype === "error_max_budget_usd"
      ? "timeout" as const
      : "failed" as const;

    return {
      task_id: task.id,
      session_id: sessionId ?? result.session_id,
      status,
      cost_usd: costUsd,
      duration_ms: durationMs,
      error: result.subtype,
    };
  }
}
