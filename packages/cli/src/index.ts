/**
 * devap CLI
 *
 * 用法：
 *   devap run <file> [--select-plan <name>] [--list-plans]
 *                    [--agent claude|opencode|cli] [--parallel] [--max-parallel <n>]
 *                    [--dry-run] [--only <ids>] [--skip <ids>]
 */

import { access, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerSyncStandardsCommand } from "./commands/sync-standards.js";
import { registerPackageCommand } from "./commands/package.js";
import { registerReportCommand } from "./commands/report.js";
import { registerEvolutionCommand, loadEvolutionConfig, executeEvolutionAnalyze } from "./commands/evolution.js";
import { createPushCommand } from "./commands/push.js";
import { createReleaseCommand } from "./commands/release.js";
import { createCommitCommand } from "./commands/commit.js";
import { createStartCommand } from "./commands/start.js";
import { createStatusCommand } from "./commands/status.js";
import { createDeployCommand } from "./commands/deploy.js";
import { createTddCommand } from "./commands/tdd.js";
import { createCheckinCommand } from "./commands/checkin.js";
import { createSddCommand } from "./commands/sdd.js";
import { createBddCommand } from "./commands/bdd.js";
import { createReviewCommand } from "./commands/review.js";
import { createAtddCommand } from "./commands/atdd.js";
import { createPrCommand } from "./commands/pr.js";
import { createHitlCommand } from "./commands/hitl.js";
import { createRunIntentCommand } from "./commands/run-intent.js";
import { createMissionCommand } from "./commands/mission.js";
import { createFlowManagementCommand } from "./commands/flow-mgmt.js";
import {
  orchestrate,
  validatePlan,
  createDefaultSafetyHook,
  loadPlan,
  listPlans,
  PlanNotFoundError,
  MultiPlanFileRequiresPlanFlagError,
  type TaskFilter,
} from "@devap/core";
import { createAdapter } from "./adapter-factory.js";
import { checkTermsAccepted, warnIfNoApiKey } from "./compliance.js";
import { createOrchestrationTelemetry } from "./telemetry.js";
import { createProgressEmitter } from "./progress.js";

const _require = createRequire(import.meta.url);
const _pkg = _require("../package.json") as { version: string };

const program = new Command();

program
  .name("devap")
  .description("Agent-agnostic 無人值守開發編排器")
  .version(_pkg.version);

program
  .command("run")
  .description("執行 task plan（支援單計劃與多計劃格式，XSPEC-057）")
  .requiredOption("--plan <file>", "Task plan 檔案路徑（JSON 或 YAML）")
  .option("--select-plan <name>", "選擇多計劃 YAML 中的具名計劃（XSPEC-057）")
  .option("--list-plans", "列出檔案中所有計劃名稱並退出（XSPEC-057）")
  .option("--agent <type>", "指定 agent（claude、opencode 或 cli）")
  .option("--parallel", "啟用並行模式（同層 tasks 並行執行）")
  .option("--max-parallel <n>", "最大並行任務數", parseInt)
  .option("--dry-run", "只驗證 plan + 跳過實際執行（XSPEC-052）")
  .option("--only <ids>", "只執行這些 task_id（逗號分隔，XSPEC-053）")
  .option("--skip <ids>", "跳過這些 task_id（逗號分隔，XSPEC-053）")
  .option("--accept-terms", "靜默合規提醒（等同 DEVAP_ACCEPT_TERMS=1）")
  .option("--verbose", "顯示詳細 onProgress 內部訊息")
  .action(async (opts: {
    plan: string;
    selectPlan?: string;
    listPlans?: boolean;
    agent?: string;
    parallel?: boolean;
    maxParallel?: number;
    dryRun?: boolean;
    only?: string;
    skip?: string;
    acceptTerms?: boolean;
    verbose?: boolean;
  }) => {
    try {
      const planPath = resolve(opts.plan);

      // XSPEC-057: --list-plans 模式
      if (opts.listPlans) {
        const plans = await listPlans(planPath);
        if (plans === null) {
          console.log("(single plan — no named plans defined)");
          return;
        }
        console.log(`Available plans in ${opts.plan}:\n`);
        const maxNameLen = Math.max(...plans.map((p) => p.name.length));
        for (const p of plans) {
          const defaultLabel = p.isDefault ? "  (default)" : "           ";
          const namePadded = p.name.padEnd(maxNameLen);
          const quality = p.quality ? `  quality: ${p.quality}` : "";
          console.log(`  ${namePadded}${defaultLabel}  ${p.taskCount} tasks${quality}`);
        }
        return;
      }

      // 合規告知（首次執行時顯示，之後靜默）
      checkTermsAccepted(opts.acceptTerms);

      // XSPEC-057: 統一 loadPlan（支援單計劃 + 多計劃）
      let plan: Awaited<ReturnType<typeof loadPlan>>["plan"];
      let selectedPlanName: string | undefined;

      try {
        const loaded = await loadPlan(planPath, opts.selectPlan);
        plan = loaded.plan;
        selectedPlanName = loaded.planName;
      } catch (err) {
        if (err instanceof PlanNotFoundError || err instanceof MultiPlanFileRequiresPlanFlagError) {
          console.error(`❌ ${err.message}`);
          process.exit(1);
        }
        throw err;
      }

      if (selectedPlanName) {
        console.log(`📋 使用計劃：${selectedPlanName}`);
      }

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

      // Dry run 預覽（舊行為保留，但現在也會實際走 orchestrate）
      if (opts.dryRun) {
        console.log("\n📋 Dry-run 模式：解析 plan + 標記所有 Task 為 skipped（XSPEC-052）");
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
          console.log(`  - ${task.id}: ${task.title}${deps}${judge} [DRY-RUN]`);
        }
      }

      if (!available && !opts.dryRun) {
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
      const dryRunLabel = opts.dryRun ? " [DRY-RUN]" : "";
      const planLabel = selectedPlanName ? ` [plan: ${selectedPlanName}]` : "";
      console.log(`\n🚀 開始執行（${mode}模式，${plan.tasks.length} 個 Task）${dryRunLabel}${planLabel}...\n`);

      // XSPEC-049: 結構化進度顯示
      const { emitter, onProgress } = createProgressEmitter(opts.verbose ?? false);

      // XSPEC-051: opt-in 遙測（靜默失敗，不影響主流程）
      const orchestrationTelemetry = await createOrchestrationTelemetry();

      // XSPEC-053: 解析 --only / --skip 為 TaskFilter
      let taskFilter: TaskFilter | undefined;
      if (opts.only || opts.skip) {
        taskFilter = {
          ...(opts.only ? { only: opts.only.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
          ...(opts.skip ? { skip: opts.skip.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
        };
      }

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
        dryRun: opts.dryRun,           // XSPEC-052
        taskFilter,                     // XSPEC-053
      });

      // XSPEC-057: 注入 plan_name 到 report
      const reportWithPlan = selectedPlanName
        ? { ...report, plan_name: selectedPlanName }
        : report;

      // 輸出報告
      console.log("\n📊 執行報告：");
      console.log(`  總任務：${reportWithPlan.summary.total_tasks}`);
      console.log(`  成功：${reportWithPlan.summary.succeeded}`);
      console.log(`  失敗：${reportWithPlan.summary.failed}`);
      console.log(`  跳過：${reportWithPlan.summary.skipped}`);
      console.log(`  總成本：$${reportWithPlan.summary.total_cost_usd.toFixed(2)}`);
      console.log(`  總耗時：${(reportWithPlan.summary.total_duration_ms / 1000).toFixed(1)}s`);

      // 寫入報告檔（本地）
      const reportPath = resolve("execution_report.json");
      await writeFile(reportPath, JSON.stringify(reportWithPlan, null, 2));
      console.log(`\n📄 報告已寫入：${reportPath}`);

      // XSPEC-054: 儲存 last-report.json 到 ~/.devap/
      try {
        const devapDir = join(homedir(), ".devap");
        await mkdir(devapDir, { recursive: true });
        const lastReportPath = join(devapDir, "last-report.json");
        const reportWithMeta = {
          ...reportWithPlan,
          _meta: {
            plan_file: opts.plan,
            plan_name: selectedPlanName,
            executed_at: new Date().toISOString(),
          },
        };
        await writeFile(lastReportPath, JSON.stringify(reportWithMeta, null, 2));
      } catch {
        // 靜默失敗，不影響主流程
      }

      // XSPEC-004: on-report 觸發 — 若 evolution config 設為 on-report，自動執行演進分析
      if (!opts.dryRun) {
        try {
          const evoConfig = await loadEvolutionConfig(cwd);
          if (evoConfig.enabled && evoConfig.trigger.mode === "on-report") {
            console.log("\n─────────────────────────────────────────────");
            console.log("🔄 [on-report] 自動觸發演進分析...");
            await executeEvolutionAnalyze({ cwd, project: plan.project });
          }
        } catch {
          // 靜默失敗，不影響主流程的 exit code
        }
      }

      // 有失敗時回傳非零 exit code
      if (reportWithPlan.summary.failed > 0) {
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
registerReportCommand(program);         // XSPEC-054
registerEvolutionCommand(program);      // XSPEC-004
program.addCommand(createPushCommand()); // XSPEC-081
program.addCommand(createReleaseCommand()); // XSPEC-089
program.addCommand(createCommitCommand()); // XSPEC-088
program.addCommand(createStartCommand());  // XSPEC-090
program.addCommand(createStatusCommand()); // XSPEC-092
program.addCommand(createDeployCommand()); // XSPEC-093
program.addCommand(createTddCommand());    // XSPEC-086 Phase 4
program.addCommand(createCheckinCommand()); // XSPEC-086 Phase 4
program.addCommand(createSddCommand());    // XSPEC-086 Phase 4
program.addCommand(createBddCommand());    // XSPEC-086 Phase 4
program.addCommand(createReviewCommand()); // XSPEC-086 Phase 4
program.addCommand(createAtddCommand());   // XSPEC-086 Phase 4
program.addCommand(createPrCommand());     // XSPEC-086 Phase 4
program.addCommand(createHitlCommand());   // XSPEC-086 Phase 5a
program.addCommand(createRunIntentCommand()); // XSPEC-086 Phase 5a
program.addCommand(createMissionCommand());   // XSPEC-095 Phase 1
program.addCommand(createFlowManagementCommand()); // XSPEC-095 Phase 4

program.parse();
