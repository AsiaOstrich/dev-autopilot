/**
 * devap CLI
 *
 * 用法：
 *   devap run --plan <file> [--agent claude|opencode|cli] [--parallel] [--max-parallel <n>] [--dry-run]
 */

import { readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerSyncStandardsCommand } from "./commands/sync-standards.js";
import { registerPackageCommand } from "./commands/package.js";
import {
  orchestrate,
  validatePlan,
  createDefaultSafetyHook,
  type TaskPlan,
} from "@devap/core";
import { createAdapter } from "./adapter-factory.js";
import { checkTermsAccepted, warnIfNoApiKey } from "./compliance.js";
import { createOrchestrationTelemetry } from "./telemetry.js";
import { createProgressEmitter } from "./progress.js";

const program = new Command();

program
  .name("devap")
  .description("Agent-agnostic 無人值守開發編排器")
  .version("0.1.3");

program
  .command("run")
  .description("執行 task plan")
  .requiredOption("--plan <file>", "Task plan JSON 檔案路徑")
  .option("--agent <type>", "指定 agent（claude、opencode 或 cli）")
  .option("--parallel", "啟用並行模式（同層 tasks 並行執行）")
  .option("--max-parallel <n>", "最大並行任務數", parseInt)
  .option("--dry-run", "只驗證 plan + 檢查 adapter 可用性")
  .option("--accept-terms", "靜默合規提醒（等同 DEVAP_ACCEPT_TERMS=1）")
  .option("--verbose", "顯示詳細 onProgress 內部訊息")
  .action(async (opts: { plan: string; agent?: string; parallel?: boolean; maxParallel?: number; dryRun?: boolean; acceptTerms?: boolean; verbose?: boolean }) => {
    try {
      // 合規告知（首次執行時顯示，之後靜默）
      checkTermsAccepted(opts.acceptTerms);
      // 載入 plan
      const planPath = resolve(opts.plan);
      const planContent = await readFile(planPath, "utf-8");
      const plan: TaskPlan = JSON.parse(planContent);

      // 驗證 plan
      const validation = validatePlan(plan);
      if (!validation.valid) {
        console.error("❌ Plan 驗證失敗：");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }
      console.log("✅ Plan 驗證通過");

      // 決定 adapter + 認證偵測
      const agentType = opts.agent ?? plan.agent ?? "claude";
      warnIfNoApiKey(agentType);
      const adapter = createAdapter(agentType);

      // 檢查 adapter 可用性
      const available = await adapter.isAvailable();
      if (available) {
        console.log(`✅ ${agentType} adapter 可用`);
      } else {
        console.warn(`⚠️  ${agentType} CLI 未安裝或不可用`);
      }

      // Dry run 到此結束
      if (opts.dryRun) {
        console.log("\n📋 Dry run 完成，以下為 plan 摘要：");
        console.log(`  專案：${plan.project}`);
        console.log(`  任務數：${plan.tasks.length}`);
        console.log(`  模式：${opts.parallel ? "並行" : "序列"}`);
        if (opts.maxParallel) {
          console.log(`  最大並行數：${opts.maxParallel}`);
        }
        for (const task of plan.tasks) {
          const deps = task.depends_on?.length
            ? ` (依賴：${task.depends_on.join(", ")})`
            : "";
          const judge = task.judge ? " [Judge]" : "";
          console.log(`  - ${task.id}: ${task.title}${deps}${judge}`);
        }
        return;
      }

      if (!available) {
        console.error(`❌ ${agentType} 不可用，無法執行`);
        process.exit(1);
      }

      // 偵測專案 CLAUDE.md（用於 generated_prompt 注入專案指引）
      const cwd = process.cwd();
      const claudeMdPath = join(cwd, "CLAUDE.md");
      let existingClaudeMdPath: string | undefined;
      try {
        await access(claudeMdPath);
        existingClaudeMdPath = claudeMdPath;
      } catch {
        // CLAUDE.md 不存在，不注入
      }

      // 執行
      const mode = opts.parallel ? "並行" : "序列";
      console.log(`\n🚀 開始執行（${mode}模式，${plan.tasks.length} 個 Task）...\n`);

      // XSPEC-049: 結構化進度顯示
      const { emitter, onProgress } = createProgressEmitter(opts.verbose ?? false);

      // XSPEC-051: opt-in 遙測（靜默失敗，不影響主流程）
      const orchestrationTelemetry = await createOrchestrationTelemetry();

      const report = await orchestrate(plan, adapter, {
        cwd,
        sessionId: plan.session_id,
        onProgress,
        safetyHooks: [createDefaultSafetyHook()],
        parallel: opts.parallel,
        maxParallel: opts.maxParallel,
        existingClaudeMdPath,
        orchestrationTelemetry,
        emitter,
      });

      // 輸出報告
      console.log("\n📊 執行報告：");
      console.log(`  總任務：${report.summary.total_tasks}`);
      console.log(`  成功：${report.summary.succeeded}`);
      console.log(`  失敗：${report.summary.failed}`);
      console.log(`  跳過：${report.summary.skipped}`);
      console.log(`  總成本：$${report.summary.total_cost_usd.toFixed(2)}`);
      console.log(`  總耗時：${(report.summary.total_duration_ms / 1000).toFixed(1)}s`);

      // 寫入報告檔
      const reportPath = resolve("execution_report.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n📄 報告已寫入：${reportPath}`);

      // 有失敗時回傳非零 exit code
      if (report.summary.failed > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error("❌ 執行失敗：", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

registerInitCommand(program);
registerSyncStandardsCommand(program);
registerPackageCommand(program);

program.parse();
