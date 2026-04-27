/**
 * devap commit — 三步驟 commit 流程命令（XSPEC-088 runtime）
 *
 * 用法：
 *   devap commit                       # 互動式：提示輸入訊息 + y/n 確認
 *   devap commit -m "feat(...): ..."   # 提供訊息，仍需 y/n 確認
 *   devap commit -m "..." --skip-confirm  # CI 模式：跳過確認直接執行
 *
 * 步驟（對應 .devap/flows/commit.flow.yaml）：
 * 1. generate-message：取得 commit message（從 --message 或 prompt）
 * 2. user-confirm：HUMAN_CONFIRM 閘門 → 顯示 message + y/n
 * 3. execute-commit：執行 git commit
 *
 * 此命令以技術手段強制三步流程，AI 助手無法跳過 Step 2 直接呼叫 git commit
 *（本 CLI 命令本身要求每步完成才前進）。
 */

import { Command } from "commander";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const execAsync = promisify(execCallback);

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close();
      res(answer);
    });
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  const ans = (await promptLine(`${question} [y/n] `)).trim().toLowerCase();
  return ans === "y";
}

async function checkStagedChanges(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync("git diff --cached --name-only", { cwd });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function runGitCommit(message: string, cwd: string): Promise<{ success: boolean; output: string }> {
  // 將訊息寫入暫存檔，避免 shell 引號跳脫複雜
  const escaped = message.replace(/'/g, "'\\''");
  try {
    const { stdout, stderr } = await execAsync(`git commit -m '${escaped}'`, { cwd });
    return { success: true, output: stdout + (stderr ? `\n${stderr}` : "") };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: e.stderr || e.stdout || e.message || String(err),
    };
  }
}

export function createCommitCommand(): Command {
  return new Command("commit")
    .description(
      "三步驟 commit 流程：generate message → HUMAN_CONFIRM → execute（XSPEC-088）"
    )
    .option("-m, --message <text>", "commit message（省略則互動式輸入）")
    .option("--skip-confirm", "跳過 y/n 確認（CI 用，不建議互動式使用）")
    .action(async (opts: { message?: string; skipConfirm?: boolean }) => {
      try {
        const cwd = process.cwd();

        // 預檢：確認有 staged changes
        const hasStaged = await checkStagedChanges(cwd);
        if (!hasStaged) {
          console.error("❌ 沒有 staged 變更可 commit。請先執行 git add。");
          process.exit(1);
        }

        // ── Step 1: generate-message ───────────────────────────
        let message = opts.message;
        if (!message) {
          console.log("📝 Step 1：生成 commit message");
          message = (
            await promptLine("輸入 Conventional Commits 格式訊息：\n  > ")
          ).trim();
        }
        if (!message) {
          console.error("❌ commit message 不可為空");
          process.exit(1);
        }

        // ── Step 2: user-confirm（HUMAN_CONFIRM 閘門）───────────
        if (!opts.skipConfirm) {
          console.log("\n🔒 Step 2：HUMAN_CONFIRM 閘門");
          console.log("─".repeat(60));
          console.log(message);
          console.log("─".repeat(60));
          const confirmed = await promptYesNo("\n確認此 message 並執行 commit？");
          if (!confirmed) {
            console.log("已取消。可重新執行 devap commit 並修改 message。");
            return;
          }
        }

        // ── Step 3: execute-commit ─────────────────────────────
        console.log("\n🚀 Step 3：執行 git commit");
        const result = await runGitCommit(message, cwd);
        if (!result.success) {
          console.error(`❌ git commit 失敗：\n${result.output}`);
          process.exit(1);
        }
        console.log(result.output);
        console.log("✅ Commit 完成。");
      } catch (e) {
        console.error("❌ devap commit 執行失敗：", (e as Error).message);
        process.exit(1);
      }
    });
}
