/**
 * `devap evolution` 子命令（XSPEC-004 Phase 4.2）
 *
 * 提供演進分析器的 CLI 入口：
 *   devap evolution analyze       — 執行分析器，識別問題，產生提案
 *   devap evolution list           — 列出現有提案
 *   devap evolution approve <id>   — 核准提案
 *   devap evolution reject <id>    — 駁回提案
 */

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { Command } from "commander";
import {
  LocalStorageBackend,
  TokenCostAnalyzer,
  HookEfficiencyAnalyzer,
  QualityStrategyAnalyzer,
  ProposalGenerator,
  HookEfficiencyProposalGenerator,
  QualityStrategyProposalGenerator,
  ApprovalManager,
} from "@devap/core";
import type { EvolutionConfig, AnalyzerConfig, QualityStrategyConfig, ProposalStatus } from "@devap/core";

// ─── 預設配置 ───────────────────────────────────────────────

const DEFAULT_TOKEN_COST_CONFIG: AnalyzerConfig = {
  enabled: true,
  min_samples: 5,
  threshold_ratio: 1.5,
};

const DEFAULT_HOOK_EFFICIENCY_CONFIG: AnalyzerConfig = {
  enabled: true,
  min_samples: 5,
  threshold_ratio: 0.2, // pass_rate < 0.8 觸發
};

const DEFAULT_QUALITY_STRATEGY_CONFIG: QualityStrategyConfig = {
  enabled: true,
  min_samples: 5,
  threshold_ratio: 1.5,   // token 超過全域中位數 1.5 倍視為 over_provisioned
  pass_rate_target: 0.7,  // pass_rate < 0.7 視為 under_performing
  token_overhead_ratio: 1.5,
};

const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  enabled: true,
  analyzers: {
    "token-cost": DEFAULT_TOKEN_COST_CONFIG,
    "hook-efficiency": DEFAULT_HOOK_EFFICIENCY_CONFIG,
    "quality-strategy": DEFAULT_QUALITY_STRATEGY_CONFIG,
  },
  trigger: { mode: "manual" },
  approval: { required: true },
};

// ─── Config 載入 ────────────────────────────────────────────

async function loadEvolutionConfig(cwd: string): Promise<EvolutionConfig> {
  const configPath = join(cwd, ".evolution", "config.yaml");
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = yamlLoad(raw) as Partial<EvolutionConfig>;
    return {
      ...DEFAULT_EVOLUTION_CONFIG,
      ...parsed,
      analyzers: {
        "token-cost": {
          ...DEFAULT_TOKEN_COST_CONFIG,
          ...parsed.analyzers?.["token-cost"],
        },
        "hook-efficiency": {
          ...DEFAULT_HOOK_EFFICIENCY_CONFIG,
          ...parsed.analyzers?.["hook-efficiency"],
        },
        "quality-strategy": {
          ...DEFAULT_QUALITY_STRATEGY_CONFIG,
          ...parsed.analyzers?.["quality-strategy"],
        },
      },
    };
  } catch {
    // config.yaml 不存在或解析失敗，使用預設值
    return DEFAULT_EVOLUTION_CONFIG;
  }
}

// ─── 狀態圖示 ────────────────────────────────────────────────

function statusIcon(status: ProposalStatus): string {
  switch (status) {
    case "pending":  return "⏳";
    case "approved": return "✅";
    case "rejected": return "❌";
    case "applied":  return "🚀";
    default:         return "❓";
  }
}

// ─── 子命令實作 ──────────────────────────────────────────────

/**
 * devap evolution analyze
 *
 * 執行所有啟用的分析器，輸出問題摘要，並產生提案到 .evolution/proposals/
 */
export async function executeEvolutionAnalyze(opts: {
  cwd?: string;
  project?: string;
}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const projectName = opts.project ?? "devap";

  const config = await loadEvolutionConfig(cwd);
  if (!config.enabled) {
    console.log("ℹ️  Evolution 功能未啟用（.evolution/config.yaml: enabled: false）");
    return;
  }

  const evolutionBackend = new LocalStorageBackend(join(cwd, ".evolution"));
  const executionHistoryBackend = new LocalStorageBackend(join(cwd, ".execution-history"));

  console.log("🔍 開始演進分析...\n");

  let totalProposals = 0;

  // ── Token Cost Analysis ──────────────────────────────────
  const tokenConfig = config.analyzers["token-cost"];
  if (tokenConfig.enabled) {
    console.log("📊 [1/3] Token 成本分析器...");
    const tokenAnalyzer = new TokenCostAnalyzer(executionHistoryBackend, tokenConfig);
    const tokenResult = await tokenAnalyzer.analyze();

    if (tokenResult.skipped) {
      console.log(`  ⏭  跳過：${tokenResult.skip_reason}（掃描 ${tokenResult.total_tasks_scanned} 筆任務）`);
    } else {
      const confLabel = tokenResult.confidence === "high" ? "高信心" : "低信心（建議累積更多數據）";
      console.log(`  ✓  掃描 ${tokenResult.total_tasks_scanned} 筆任務，信心：${confLabel}`);
      console.log(`  📌 發現 ${tokenResult.outliers.length} 個 token 成本異常值`);

      if (tokenResult.outliers.length > 0) {
        const generator = new ProposalGenerator(evolutionBackend, projectName);
        const proposals = await generator.generate(tokenResult);
        totalProposals += proposals.length;
        console.log(`  📝 產生 ${proposals.length} 個提案`);
        for (const p of proposals) {
          console.log(`     - ${p.meta.id}（impact: ${p.meta.impact}）→ task ${p.meta.target.file ?? "unknown"}`);
        }
      }
    }
  }

  // ── Hook Efficiency Analysis ─────────────────────────────
  const hookConfig = config.analyzers["hook-efficiency"];
  if (hookConfig?.enabled) {
    console.log("\n🪝 [2/3] Hook 效率分析器...");
    const hookAnalyzer = new HookEfficiencyAnalyzer(cwd, hookConfig);
    const hookResult = await hookAnalyzer.analyze();

    if (hookResult.skipped) {
      console.log(`  ⏭  跳過：${hookResult.skip_reason}（掃描 ${hookResult.total_standards_scanned} 個 standard）`);
    } else {
      const confLabel = hookResult.confidence === "high" ? "高信心" : "低信心（建議累積更多數據）";
      console.log(`  ✓  掃描 ${hookResult.total_standards_scanned} 個 standard，共 ${hookResult.total_executions} 次執行，信心：${confLabel}`);
      console.log(`  📌 發現 ${hookResult.issues.length} 個通過率過低的 hook`);

      if (hookResult.issues.length > 0) {
        for (const issue of hookResult.issues) {
          const passRatePct = Math.round(issue.pass_rate * 1000) / 10;
          console.log(`     - ${issue.standard_id}：pass_rate=${passRatePct}%，fail_count=${issue.fail_count}/${issue.executions}`);
        }

        const hookGenerator = new HookEfficiencyProposalGenerator(evolutionBackend, projectName);
        const hookProposals = await hookGenerator.generate(hookResult);
        totalProposals += hookProposals.length;
        console.log(`  📝 產生 ${hookProposals.length} 個提案`);
        for (const p of hookProposals) {
          console.log(`     - ${p.meta.id}（impact: ${p.meta.impact}）→ ${p.meta.target.file ?? "unknown"}`);
        }
      }
    }
  }

  // ── Quality Strategy Analysis ────────────────────────────
  const qualityConfig = config.analyzers["quality-strategy"];
  if (qualityConfig?.enabled) {
    console.log("\n🎯 [3/3] 品質策略分析器...");
    const qualityAnalyzer = new QualityStrategyAnalyzer(executionHistoryBackend, qualityConfig);
    const qualityResult = await qualityAnalyzer.analyze();

    if (qualityResult.skipped) {
      console.log(`  ⏭  跳過：${qualityResult.skip_reason}（掃描 ${qualityResult.total_tasks_scanned} 筆任務）`);
    } else {
      const confLabel = qualityResult.confidence === "high" ? "高信心" : "低信心（建議累積更多數據）";
      console.log(`  ✓  掃描 ${qualityResult.total_tasks_scanned} 筆任務（${qualityResult.total_groups_scanned} 個 tag 群組），信心：${confLabel}`);
      console.log(`  📌 發現 ${qualityResult.issues.length} 個品質策略問題`);

      if (qualityResult.issues.length > 0) {
        for (const issue of qualityResult.issues) {
          const tagLabel = issue.tag_group.join(", ") || "(no-tags)";
          const signalLabel = issue.signal === "over_provisioned" ? "過度配置" : "效果不足";
          console.log(`     - [${tagLabel}]：${signalLabel}，severity=${issue.severity_pct}%，pass_rate=${Math.round(issue.avg_pass_rate * 1000) / 10}%`);
        }

        const qualityGenerator = new QualityStrategyProposalGenerator(evolutionBackend, projectName);
        const qualityProposals = await qualityGenerator.generate(qualityResult);
        totalProposals += qualityProposals.length;
        console.log(`  📝 產生 ${qualityProposals.length} 個提案`);
        for (const p of qualityProposals) {
          console.log(`     - ${p.meta.id}（impact: ${p.meta.impact}）→ ${p.meta.target.file ?? "unknown"}`);
        }
      }
    }
  }

  console.log(`\n─────────────────────────────────────────────`);
  if (totalProposals > 0) {
    console.log(`✅ 分析完成，共產生 ${totalProposals} 個提案`);
    console.log(`   執行 \`devap evolution list\` 查看提案列表`);
    console.log(`   執行 \`devap evolution approve <id>\` 核准提案`);
  } else {
    console.log(`✅ 分析完成，無需改進的提案`);
  }
}

/**
 * devap evolution list
 *
 * 列出現有提案，可依狀態過濾
 */
export async function executeEvolutionList(opts: {
  cwd?: string;
  status?: string;
}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const evolutionBackend = new LocalStorageBackend(join(cwd, ".evolution"));
  const manager = new ApprovalManager(evolutionBackend);

  const statusFilter = opts.status as ProposalStatus | undefined;
  const proposals = await manager.listProposals(statusFilter);

  if (proposals.length === 0) {
    const filterLabel = statusFilter ? `（狀態：${statusFilter}）` : "";
    console.log(`ℹ️  沒有提案${filterLabel}`);
    console.log("   執行 `devap evolution analyze` 產生提案");
    return;
  }

  const header = statusFilter ? `提案列表（狀態：${statusFilter}）` : "提案列表（全部）";
  console.log(`📋 ${header}\n`);

  for (const p of proposals) {
    const icon = statusIcon(p.meta.status);
    const impact = `impact:${p.meta.impact}`.padEnd(14);
    const conf = `conf:${(p.meta.confidence * 100).toFixed(0)}%`.padEnd(10);
    const target = p.meta.target.file ?? p.meta.target.project;
    console.log(`  ${icon} ${p.meta.id}  ${impact} ${conf}  ${target}`);
    if (p.meta.reject_reason) {
      console.log(`     駁回原因：${p.meta.reject_reason}`);
    }
  }

  console.log(`\n  共 ${proposals.length} 個提案`);
}

/**
 * devap evolution approve <id>
 */
export async function executeEvolutionApprove(id: string, opts: {
  cwd?: string;
}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const evolutionBackend = new LocalStorageBackend(join(cwd, ".evolution"));
  const manager = new ApprovalManager(evolutionBackend);

  const result = await manager.approve(id);
  if (result.success) {
    console.log(`✅ ${result.message}`);
    console.log(`   執行 \`devap evolution apply ${id}\` 套用提案`);
  } else {
    console.error(`❌ ${result.message}`);
    process.exit(1);
  }
}

/**
 * devap evolution apply <id>
 *
 * 套用已核准的提案。若無 --yes 旗標，顯示 diff 後等待使用者輸入 y/n。
 */
export async function executeEvolutionApply(id: string, opts: {
  cwd?: string;
  yes?: boolean;
}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const evolutionBackend = new LocalStorageBackend(join(cwd, ".evolution"));
  const manager = new ApprovalManager(evolutionBackend);

  const confirmFn = opts.yes
    ? async (_pid: string, diff: string) => {
        console.log("\n── Diff ──────────────────────────────────────────");
        console.log(diff);
        console.log("─────────────────────────────────────────────────");
        console.log("（--yes 旗標：自動確認）");
        return true;
      }
    : async (_pid: string, diff: string) => {
        console.log("\n── Diff ──────────────────────────────────────────");
        console.log(diff);
        console.log("─────────────────────────────────────────────────");

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        return new Promise<boolean>((resolve) => {
          rl.question("確認套用此提案？(y/N) ", (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === "y");
          });
        });
      };

  const result = await manager.apply(id, confirmFn);
  if (result.success) {
    console.log(`\n✅ ${result.message}`);
  } else {
    if (result.message.includes("取消")) {
      console.log(`ℹ️  ${result.message}`);
    } else {
      console.error(`❌ ${result.message}`);
      process.exit(1);
    }
  }
}

/**
 * devap evolution reject <id> --reason <reason>
 */
export async function executeEvolutionReject(id: string, opts: {
  cwd?: string;
  reason: string;
}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const evolutionBackend = new LocalStorageBackend(join(cwd, ".evolution"));
  const manager = new ApprovalManager(evolutionBackend);

  const result = await manager.reject(id, opts.reason);
  if (result.success) {
    console.log(`✅ ${result.message}`);
  } else {
    console.error(`❌ ${result.message}`);
    process.exit(1);
  }
}

// ─── Commander 註冊 ──────────────────────────────────────────

/**
 * 將 `devap evolution` 子命令群組加入 commander
 */
export function registerEvolutionCommand(program: Command): void {
  const evo = program
    .command("evolution")
    .description("演進分析器與提案管理（XSPEC-004）");

  evo
    .command("analyze")
    .description("執行演進分析器，識別問題並產生提案")
    .option("--cwd <path>", "專案工作目錄（預設：當前目錄）")
    .option("--project <name>", "專案名稱（用於提案目標，預設：devap）", "devap")
    .action(async (opts: { cwd?: string; project?: string }) => {
      try {
        await executeEvolutionAnalyze(opts);
      } catch (err) {
        console.error("❌ 分析失敗：", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  evo
    .command("list")
    .description("列出演進提案")
    .option("--status <status>", "按狀態過濾（pending | approved | rejected | applied）")
    .option("--cwd <path>", "專案工作目錄（預設：當前目錄）")
    .action(async (opts: { status?: string; cwd?: string }) => {
      try {
        await executeEvolutionList(opts);
      } catch (err) {
        console.error("❌ 列表失敗：", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  evo
    .command("approve <id>")
    .description("核准演進提案（id：PROP-YYYY-NNNN）")
    .option("--cwd <path>", "專案工作目錄（預設：當前目錄）")
    .action(async (id: string, opts: { cwd?: string }) => {
      try {
        await executeEvolutionApprove(id, opts);
      } catch (err) {
        console.error("❌ 核准失敗：", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  evo
    .command("apply <id>")
    .description("套用已核准的演進提案（id：PROP-YYYY-NNNN）")
    .option("--yes", "跳過互動確認直接套用")
    .option("--cwd <path>", "專案工作目錄（預設：當前目錄）")
    .action(async (id: string, opts: { yes?: boolean; cwd?: string }) => {
      try {
        await executeEvolutionApply(id, opts);
      } catch (err) {
        console.error("❌ 套用失敗：", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  evo
    .command("reject <id>")
    .description("駁回演進提案（id：PROP-YYYY-NNNN）")
    .requiredOption("--reason <reason>", "駁回原因")
    .option("--cwd <path>", "專案工作目錄（預設：當前目錄）")
    .action(async (id: string, opts: { reason: string; cwd?: string }) => {
      try {
        await executeEvolutionReject(id, opts);
      } catch (err) {
        console.error("❌ 駁回失敗：", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
