/**
 * OpenCode SDK Adapter
 *
 * 透過 @opencode-ai/sdk 呼叫 OpenCode 執行任務。
 * OpenCode 使用 Client/Server 架構，需先啟動 server 再透過 HTTP API 操作。
 * 支援 session create、prompt、fork、headless mode。
 */

import { createOpencode } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type {
  AgentAdapter,
  AgentType,
  ExecuteOptions,
  Task,
  TaskResult,
} from "@dev-autopilot/core";

/**
 * OpenCode SDK Adapter
 *
 * 將 dev-autopilot 的 Task 轉換為 OpenCode SDK 的 session.prompt 呼叫。
 */
export class OpenCodeAdapter implements AgentAdapter {
  readonly name: AgentType = "opencode";

  private client: OpencodeClient | null = null;
  private serverClose: (() => void) | null = null;

  /**
   * 初始化 OpenCode SDK（啟動 server + 建立 client）
   */
  private async ensureClient(): Promise<OpencodeClient> {
    if (this.client) return this.client;

    const { client, server } = await createOpencode();
    this.client = client;
    this.serverClose = server.close;
    return client;
  }

  /**
   * 執行單一任務
   *
   * 1. 建立或接續 session
   * 2. 發送 prompt（task spec）
   * 3. 等待完成，提取結果
   *
   * @param task - 要執行的任務
   * @param options - 執行選項
   * @returns 任務執行結果
   */
  async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      const client = await this.ensureClient();

      // 建立或 fork session
      let sessionId: string;
      if (options.sessionId && options.forkSession) {
        const forkResult = await client.session.fork({
          path: { id: options.sessionId },
        });
        const forkData = forkResult.data as { id: string } | undefined;
        sessionId = forkData?.id ?? options.sessionId;
      } else if (options.sessionId) {
        sessionId = options.sessionId;
      } else {
        const createResult = await client.session.create({
          query: { directory: options.cwd },
        });
        const createData = createResult.data as { id: string } | undefined;
        sessionId = createData?.id ?? "";
      }

      options.onProgress?.(`[${task.id}] OpenCode session: ${sessionId}`);

      // 構建 prompt
      const prompt = this.buildPrompt(task);

      // 發送 prompt
      const promptResult = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: prompt }],
        },
      });

      const promptData = promptResult.data as {
        info?: { cost?: number; error?: unknown };
      } | undefined;

      const cost = promptData?.info?.cost ?? 0;
      const hasError = !!promptData?.info?.error;

      return {
        task_id: task.id,
        session_id: sessionId,
        status: hasError ? "failed" : "success",
        cost_usd: cost,
        duration_ms: Date.now() - startTime,
        verification_passed: !hasError,
        error: hasError ? String(promptData?.info?.error) : undefined,
      };
    } catch (error) {
      return {
        task_id: task.id,
        status: "failed",
        duration_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 檢查 OpenCode CLI 是否可用
   *
   * 嘗試執行 `opencode --version` 確認 CLI 已安裝。
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync("opencode", ["--version"]);
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
    const client = await this.ensureClient();
    await client.session.get({
      path: { id: sessionId },
    });
  }

  /**
   * 關閉 OpenCode server
   */
  async dispose(): Promise<void> {
    this.serverClose?.();
    this.client = null;
    this.serverClose = null;
  }

  /**
   * 構建送給 OpenCode 的 prompt
   */
  private buildPrompt(task: Task): string {
    let prompt = `請執行以下任務：\n\n## ${task.title}\n\n${task.spec}`;

    if (task.verify_command) {
      prompt += `\n\n## 驗收條件\n執行完成後請用以下指令驗證：\n\`\`\`bash\n${task.verify_command}\n\`\`\``;
    }

    return prompt;
  }
}
