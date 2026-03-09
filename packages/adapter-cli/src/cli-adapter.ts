/**
 * CLI Adapter
 *
 * 透過 `claude -p --output-format json` 子進程執行任務。
 * 零外部 npm 依賴，只需使用者本機安裝的 `claude` CLI。
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  AgentType,
  ExecuteOptions,
  Task,
  TaskResult,
} from "@devap/core";
import { parseCliOutput, resolveStatus } from "./output-parser.js";

const execFileAsync = promisify(execFile);

/**
 * CLI Adapter — 使用 `claude -p` 子進程執行任務
 *
 * 每個任務啟動一個獨立的 `claude` 子進程，
 * 透過 `--output-format json` 取得結構化結果。
 */
export class CliAdapter implements AgentAdapter {
  readonly name: AgentType = "cli";

  /**
   * 執行單一任務
   *
   * spawn `claude -p` 子進程，將 task spec 作為 prompt，
   * 解析 JSON 輸出取得 session_id、cost、status。
   *
   * @param task - 要執行的任務
   * @param options - 執行選項
   * @returns 任務執行結果
   */
  async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
    const startTime = Date.now();

    const args = this.buildArgs(task, options);
    const prompt = this.buildPrompt(task);

    options.onProgress?.(`[${task.id}] 啟動 claude -p 子進程`);

    try {
      const stdout = await this.spawnClaude(args, prompt, options.cwd);
      const output = parseCliOutput(stdout);
      const status = resolveStatus(output);

      options.onProgress?.(`[${task.id}] session: ${output.session_id}`);

      return {
        task_id: task.id,
        session_id: output.session_id,
        status,
        cost_usd: output.cost_usd,
        duration_ms: output.duration_ms ?? (Date.now() - startTime),
        verification_passed: status === "success",
        error: status !== "success" ? output.subtype : undefined,
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
   * 檢查 Claude CLI 是否可用
   *
   * 嘗試執行 `claude --version` 確認 CLI 已安裝。
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("claude", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 構建 CLI 啟動參數
   */
  private buildArgs(task: Task, options: ExecuteOptions): string[] {
    const args = ["-p", "--output-format", "json", "--verbose"];

    // 權限模式
    args.push("--permission-mode", "accept-edits");

    // Session resume / fork
    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }

    // 限制
    if (task.max_turns) {
      args.push("--max-turns", String(task.max_turns));
    }

    // 工具限制
    if (task.allowed_tools?.length) {
      args.push("--allowedTools", task.allowed_tools.join(","));
    }

    return args;
  }

  /**
   * 構建送給 Claude 的 prompt
   */
  private buildPrompt(task: Task): string {
    let prompt = `請執行以下任務：\n\n## ${task.title}\n\n${task.spec}`;

    if (task.verify_command) {
      prompt += `\n\n## 驗收條件\n執行完成後請用以下指令驗證：\n\`\`\`bash\n${task.verify_command}\n\`\`\``;
    }

    return prompt;
  }

  /**
   * 啟動 claude 子進程並收集輸出
   *
   * @param args - CLI 參數
   * @param prompt - 要送給 claude 的 prompt
   * @param cwd - 工作目錄
   * @returns stdout 輸出
   */
  private spawnClaude(args: string[], prompt: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        reject(new Error(`無法啟動 claude 子進程：${error.message}`));
      });

      child.on("close", (code) => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`claude 子進程以 exit code ${code} 退出：${stderr}`));
          return;
        }
        // claude -p 可能在 JSON 輸出中包含非零 exit code（如 max_turns），
        // 所以只要有 stdout 就嘗試解析
        resolve(stdout);
      });

      // 將 prompt 寫入 stdin
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}
