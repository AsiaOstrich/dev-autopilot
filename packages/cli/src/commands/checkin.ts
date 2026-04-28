/**
 * devap checkin — Pre-commit 品質關卡驗證（XSPEC-086 Phase 4）
 *
 * 用法：
 *   devap checkin                        # 執行完整品質關卡序列
 *   devap checkin --test-cmd "pnpm test" # 指定測試命令
 *   devap checkin --lint-cmd "pnpm lint" # 指定 lint 命令
 *   devap checkin --skip-build           # 跳過 build 驗證（已知 build 正常時）
 *
 * 步驟（對應 .devap/flows/checkin.flow.yaml）：
 * 1. inspect-staged-changes：檢視 staged 變更
 * 2. build-verification：確認 build 成功（hard gate）
 * 3. test-verification：所有測試通過（hard gate）
 * 4. code-quality：Lint 通過（hard gate）
 * 5. documentation：文件更新（soft gate，警告）
 * 6. workflow-compliance：branch/commit 合規（soft gate，警告）
 * 7. emit-checkin-summary：輸出通過/失敗摘要
 */

import { Command } from "commander";
import { exec as execCallback } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execAsync = promisify(execCallback);

interface GateResult {
  name: string;
  status: "pass" | "fail" | "warn" | "skip";
  message?: string;
}

function detectCommands(cwd: string): { test: string; lint: string; build: string } {
  try {
    const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, { encoding: "utf-8" })) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    return {
      test: scripts["test"] ? "npm test" : scripts["test:unit"] ? "npm run test:unit" : "npm test",
      lint: scripts["lint"] ? "npm run lint" : "",
      build: scripts["build"] ? "npm run build" : "",
    };
  } catch {
    return { test: "npm test", lint: "", build: "" };
  }
}

async function runGate(
  name: string,
  cmd: string,
  cwd: string,
  soft = false
): Promise<GateResult> {
  if (!cmd) {
    return { name, status: "skip", message: "命令未設定，已跳過" };
  }
  try {
    await execAsync(cmd, { cwd });
    return { name, status: "pass" };
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const output = (e.stderr || e.stdout || e.message || "").slice(0, 300);
    if (soft) {
      return { name, status: "warn", message: output };
    }
    return { name, status: "fail", message: output };
  }
}

function getCurrentBranch(cwd: string): string {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function validateBranchName(branch: string): boolean {
  return /^(feat|fix|chore|docs|refactor|test|style|ci|perf|build|hotfix|release)\/.+/.test(branch);
}

function printGateResult(result: GateResult): void {
  const icons: Record<GateResult["status"], string> = {
    pass: "✅",
    fail: "❌",
    warn: "⚠️ ",
    skip: "⏭️ ",
  };
  const icon = icons[result.status];
  console.log(`  ${icon} ${result.name}`);
  if (result.message && result.status !== "pass") {
    const truncated = result.message.split("\n").slice(0, 3).join("\n");
    console.log(`     ${truncated}`);
  }
}

export function createCheckinCommand(): Command {
  return new Command("checkin")
    .description("Pre-commit 品質關卡驗證：build → tests → lint → doc → workflow（XSPEC-086 Phase 4）")
    .option("--test-cmd <cmd>", "覆蓋測試命令")
    .option("--lint-cmd <cmd>", "覆蓋 lint 命令")
    .option("--build-cmd <cmd>", "覆蓋 build 命令")
    .option("--skip-build", "跳過 build 驗證")
    .action(
      async (opts: {
        testCmd?: string;
        lintCmd?: string;
        buildCmd?: string;
        skipBuild?: boolean;
      }) => {
        try {
          const cwd = process.cwd();
          const detected = detectCommands(cwd);
          const testCmd = opts.testCmd ?? detected.test;
          const lintCmd = opts.lintCmd ?? detected.lint;
          const buildCmd = opts.buildCmd ?? detected.build;

          console.log("\n🔍 devap checkin — Pre-commit 品質關卡驗證");
          console.log("═".repeat(60));

          // ── 1. inspect-staged-changes ──────────────────────────
          console.log("\n📋 Staged 變更");
          try {
            const { stdout } = await execAsync("git status --short && git diff --cached --stat", { cwd });
            if (stdout.trim()) {
              console.log(stdout.trim().split("\n").slice(0, 10).join("\n"));
            } else {
              console.log("  （無 staged 變更）");
            }
          } catch {
            console.log("  （無法取得 git 狀態）");
          }

          const results: GateResult[] = [];

          // ── 2. build-verification（hard gate）─────────────────
          if (!opts.skipBuild) {
            console.log("\n🏗️  Build 驗證");
            const buildResult = await runGate("Build", buildCmd, cwd);
            results.push(buildResult);
            printGateResult(buildResult);
            if (buildResult.status === "fail") {
              console.log("\n❌ Build 失敗，中止檢查。請先修復編譯錯誤。");
              process.exit(1);
            }
          } else {
            results.push({ name: "Build", status: "skip", message: "--skip-build" });
          }

          // ── 3. test-verification（hard gate）─────────────────
          console.log("\n🧪 測試驗證");
          const testResult = await runGate("Tests", testCmd, cwd);
          results.push(testResult);
          printGateResult(testResult);
          if (testResult.status === "fail") {
            console.log("\n❌ 測試失敗，中止檢查。");
            process.exit(1);
          }

          // ── 4. code-quality（hard gate）──────────────────────
          console.log("\n🎨 程式碼品質");
          const lintResult = await runGate("Lint", lintCmd, cwd);
          results.push(lintResult);
          printGateResult(lintResult);
          if (lintResult.status === "fail") {
            console.log("\n❌ Lint 失敗，中止檢查。");
            process.exit(1);
          }

          // ── 5. documentation（soft gate）─────────────────────
          console.log("\n📝 文件更新（軟性閘門）");
          const docResult: GateResult = { name: "Documentation", status: "warn", message: "請確認 API 文件與 CHANGELOG 已更新" };
          results.push(docResult);
          printGateResult(docResult);

          // ── 6. workflow-compliance（soft gate）───────────────
          console.log("\n🌿 Workflow 合規性");
          const branch = getCurrentBranch(cwd);
          const branchValid = branch === "unknown" || validateBranchName(branch);
          const workflowResult: GateResult = branchValid
            ? { name: "Workflow", status: "pass" }
            : {
                name: "Workflow",
                status: "warn",
                message: `分支 "${branch}" 不符合 <type>/<description> 格式`,
              };
          results.push(workflowResult);
          printGateResult(workflowResult);

          // ── 7. emit-checkin-summary ───────────────────────────
          const passed = results.filter((r) => r.status === "pass").length;
          const warned = results.filter((r) => r.status === "warn").length;
          const failed = results.filter((r) => r.status === "fail").length;
          const skipped = results.filter((r) => r.status === "skip").length;

          console.log("\n" + "─".repeat(60));
          console.log("📊 Checkin 摘要");
          console.log(`  通過：${passed}　警告：${warned}　失敗：${failed}　跳過：${skipped}`);

          if (failed === 0) {
            console.log("\n✅ 所有硬性關卡通過！");
            if (warned > 0) {
              console.log(`⚠️  ${warned} 個軟性警告，建議修復後提交。`);
            }
            console.log("\n📋 建議下一步：");
            console.log("  devap commit   — 提交程式碼");
          } else {
            console.log("\n❌ 有閘門失敗，請修復後重新執行 devap checkin。");
            process.exit(1);
          }
        } catch (e) {
          console.error("❌ devap checkin 執行失敗：", (e as Error).message);
          process.exit(1);
        }
      }
    );
}
