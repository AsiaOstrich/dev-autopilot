/**
 * devap status — 顯示執行狀態（XSPEC-092 AC-5）
 *
 * --cost: 讀取 .devap/history 最近執行記錄，顯示 token 消耗與估算費用
 */

import { Command } from "commander";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { LocalStorageBackend, AccessReader } from "@devap/core";
import { DEFAULT_PRICING, type ModelPricing } from "@devap/core";

interface CostReportOptions {
  historyDir?: string;
  pricing?: Record<string, ModelPricing>;
  accessReader?: AccessReader;
}

export async function buildCostReport(opts: CostReportOptions = {}): Promise<string> {
  const historyDir = opts.historyDir ?? join(process.cwd(), ".devap", "history");

  if (!existsSync(historyDir)) {
    return "執行歷史不存在。執行 devap run 後再查詢費用報告。";
  }

  const backend = new LocalStorageBackend(historyDir);
  const reader = opts.accessReader ?? new AccessReader(backend);
  const index = await reader.readL1();

  if (!index || index.tasks.length === 0) {
    return "尚無執行記錄。";
  }

  const pricing = { ...DEFAULT_PRICING, ...(opts.pricing ?? {}) };
  const sep = "─".repeat(60);
  const lines: string[] = [sep, "Token 消耗報告（最近 10 筆任務）", sep];

  let grandTotal = 0;
  let grandCost = 0;

  const tasks = index.tasks.slice(0, 10);
  for (const task of tasks) {
    const manifest = await reader.readL2(task.task_id);
    if (!manifest) continue;

    const latestRun = manifest.run_history[0];
    if (!latestRun) continue;

    const tokens = latestRun.tokens_total;
    // tokens_total 是 input+output 合計，以 default 定價估算（保守估算）
    const p = pricing["default"];
    const costUsd = (tokens / 1_000_000) * ((p.inputPerMillion + p.outputPerMillion) / 2);

    grandTotal += tokens;
    grandCost += costUsd;

    lines.push(
      `${task.task_name.slice(0, 40).padEnd(42)} ${tokens.toLocaleString().padStart(10)} tokens  ~$${costUsd.toFixed(4)}`
    );
  }

  if (tasks.length === 0) {
    lines.push("（無記錄）");
  } else {
    lines.push(sep);
    lines.push(
      `${"合計".padEnd(42)} ${grandTotal.toLocaleString().padStart(10)} tokens  ~$${grandCost.toFixed(4)}`
    );
  }

  lines.push(sep);
  lines.push("注意：費用為估算值，實際費用請查閱 AI 服務帳單。");
  return lines.join("\n");
}

export function createStatusCommand(): Command {
  return new Command("status")
    .description("顯示 DevAP 執行狀態")
    .option("--cost", "顯示 token 消耗與估算費用報告（XSPEC-092 AC-5）")
    .option("--history-dir <dir>", "指定執行歷史目錄（預設 .devap/history）")
    .action(async (opts: { cost?: boolean; historyDir?: string }) => {
      if (opts.cost) {
        try {
          const report = await buildCostReport({ historyDir: opts.historyDir });
          console.log(report);
        } catch (err) {
          console.error("❌ 無法讀取費用報告：", (err as Error).message);
          process.exit(1);
        }
      } else {
        console.log("DevAP 執行狀態正常。使用 --cost 顯示 token 費用報告。");
      }
    });
}
