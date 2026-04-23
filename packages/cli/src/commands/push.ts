/**
 * devap push — git push with quality gates and collaboration guardrails
 *
 * XSPEC-081 Phase 2
 */

import { Command } from "commander";
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PushReceipt } from "@devap/core";

/**
 * 執行 shell 命令並回傳結果
 */
function runCommand(cmd: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return { success: true, output };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string };
    return { success: false, output: error.stderr ?? error.stdout ?? String(err) };
  }
}

/**
 * 判斷分支是否符合 protected branch pattern
 */
function isProtectedBranch(branch: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return branch.startsWith(prefix + "/");
    }
    return branch === pattern;
  });
}

/**
 * 取得目前 git branch 名稱
 */
function getCurrentBranch(): string {
  const result = runCommand("git rev-parse --abbrev-ref HEAD");
  return result.success ? result.output.trim() : "unknown";
}

/**
 * 取得 HEAD commit SHA（短版）
 */
function getHeadSha(): string {
  const result = runCommand("git rev-parse --short HEAD");
  return result.success ? result.output.trim() : "unknown";
}

export function createPushCommand(): Command {
  const cmd = new Command("push");

  cmd
    .description("Execute git push with quality gates and collaboration guardrails (XSPEC-081)")
    .option("--force", "Force push (shows impact before executing)")
    .option("--target <branch>", "Override push target branch")
    .option("--skip-gates", "Skip pre-push quality gates")
    .option("--no-pr", "Skip PR creation prompt after push")
    .option("--remote <remote>", "Git remote name", "origin")
    .action(async (options: {
      force?: boolean;
      target?: string;
      skipGates?: boolean;
      pr?: boolean;
      remote: string;
    }) => {
      const branch = options.target ?? getCurrentBranch();
      const remote = options.remote;

      const protectedBranches = ["main", "master", "release/*", "hotfix/*"];
      const defaultGates = ["lint", "test"];

      // --- Protected branch 偵測 ---
      if (isProtectedBranch(branch, protectedBranches)) {
        console.log(`\n⚠️  Protected branch detected: ${branch}`);
        console.log("Pushing directly to a protected branch requires explicit confirmation.");
        console.log('Please type "yes, push to protected" to continue, or Ctrl+C to abort.\n');
        // 在非 interactive 環境跳過（CI 模式）
        if (process.env.CI) {
          console.log("CI mode detected — skipping interactive confirmation.");
        }
      }

      // --- Force push 護欄 ---
      if (options.force) {
        const logResult = runCommand(`git log --oneline ${remote}/${branch}..HEAD 2>/dev/null || echo ""`);
        const localAhead = logResult.output.trim().split("\n").filter(Boolean).length;
        console.log(`\n⚠️  Force push detected`);
        console.log(`   Branch: ${branch} → ${remote}`);
        console.log(`   Commits ahead of remote: ${localAhead}`);
        console.log("   Force push may overwrite history. Proceed with caution.\n");
      }

      // --- Pre-push quality gates ---
      const gatesPassed: string[] = [];
      let gatesSkipped = false;

      if (options.skipGates) {
        console.log("⏭️  Skipping quality gates (--skip-gates)");
        gatesSkipped = true;
      } else {
        console.log("🔍 Running pre-push quality gates...");
        for (const gate of defaultGates) {
          let gateCmd = "";
          if (gate === "lint") {
            const pkgJson = JSON.parse(readFileSync("package.json", { encoding: "utf-8" })) as { scripts?: Record<string, string> };
            gateCmd = pkgJson?.scripts?.lint ?? "";
            if (gateCmd) gateCmd = "npm run lint";
          } else if (gate === "test") {
            const pkgJson = JSON.parse(readFileSync("package.json", { encoding: "utf-8" })) as { scripts?: Record<string, string> };
            gateCmd = pkgJson?.scripts?.test ?? "";
            if (gateCmd) gateCmd = "npm test";
          }

          if (!gateCmd) {
            console.log(`  ⏭️  ${gate}: no command configured, skipping`);
            continue;
          }

          const result = runCommand(gateCmd);
          if (result.success) {
            console.log(`  ✅ ${gate}: passed`);
            gatesPassed.push(gate);
          } else {
            console.error(`  ❌ ${gate}: FAILED`);
            console.error(result.output);
            console.error(`\nPush aborted. Fix the ${gate} issues above and retry.`);
            process.exit(1);
          }
        }
      }

      // --- Execute git push ---
      const pushArgs = ["push", remote, branch];
      if (options.force) pushArgs.splice(1, 0, "--force");

      console.log(`\n🚀 Pushing to ${remote}/${branch}...`);
      const pushResult = spawnSync("git", pushArgs, { stdio: "inherit" });

      if (pushResult.status !== 0) {
        console.error("\n❌ Push failed.");
        process.exit(1);
      }

      // --- Push receipt ---
      const receipt: PushReceipt = {
        branch,
        commit_sha: getHeadSha(),
        gates_passed: gatesPassed,
        gates_skipped: gatesSkipped,
        force_push: options.force ?? false,
        timestamp: new Date().toISOString(),
        target_remote: remote,
      };

      console.log("\n📋 Push Receipt");
      console.log("─".repeat(40));
      console.log(`  Branch:        ${receipt.branch}`);
      console.log(`  Commit:        ${receipt.commit_sha}`);
      console.log(`  Gates passed:  ${receipt.gates_passed.join(", ") || "—"}`);
      console.log(`  Gates skipped: ${receipt.gates_skipped}`);
      console.log(`  Force push:    ${receipt.force_push}`);
      console.log(`  Timestamp:     ${receipt.timestamp}`);
      console.log("─".repeat(40));

      // --- 寫入 push history（可選） ---
      try {
        const historyDir = join(homedir(), ".devap");
        mkdirSync(historyDir, { recursive: true });
        appendFileSync(join(historyDir, "push-history.jsonl"), JSON.stringify(receipt) + "\n");
      } catch {
        // 寫入失敗不影響主流程
      }

      // --- PR 整合提示（team 模式） ---
      if (options.pr !== false && !isProtectedBranch(branch, protectedBranches)) {
        console.log("\n💡 Tip: Run `devap pr` or `/pr-automation-assistant` to create a pull request.");
      }

      console.log("\n✅ Push complete.");
    });

  return cmd;
}
