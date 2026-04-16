/**
 * `devap report` 子命令（XSPEC-054）
 *
 * 讀取 ~/.devap/last-report.json（或指定路徑），格式化輸出執行報告。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Command } from "commander";
import type { ExecutionReport, TaskResult } from "@devap/core";

/** 帶 _meta 的 last-report 格式 */
interface LastReport extends ExecutionReport {
  _meta?: {
    plan_file?: string;
    executed_at?: string;
  };
}

/** Task 狀態對應圖示 */
function statusIcon(status: TaskResult["status"]): string {
  switch (status) {
    case "success":
    case "done_with_concerns":
      return "✅";
    case "failed":
    case "timeout":
      return "❌";
    case "skipped":
      return "⏭ ";
    case "cancelled":
      return "🚫";
    default:
      return "❓";
  }
}

/** 毫秒轉換為人類可讀格式 */
function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/** 格式化 ISO 日期字串 */
function formatDate(isoStr?: string): string {
  if (!isoStr) return "N/A";
  return new Date(isoStr).toLocaleString();
}

/**
 * 格式化輸出執行報告
 */
function printReport(report: LastReport): void {
  const sep = "─".repeat(52);
  const { summary, tasks, _meta } = report;

  const dryRunLabel = report.dry_run ? "  [DRY RUN]" : "";
  const planFile = _meta?.plan_file ?? "N/A";
  const executedAt = formatDate(_meta?.executed_at);
  const totalDuration = formatDuration(summary.total_duration_ms);
  const totalCost = `$${(summary.total_cost_usd ?? 0).toFixed(4)}`;

  console.log(`── Execution Report ${"─".repeat(33)}`);
  console.log(`Plan:    ${planFile}${dryRunLabel}`);
  console.log(`Time:    ${executedAt}  (duration: ${totalDuration})`);
  console.log(`Cost:    ${totalCost}`);
  console.log(
    `Result:  ${summary.succeeded} success, ${summary.failed} failed, ` +
    `${summary.skipped} skipped, ${summary.cancelled ?? 0} cancelled`,
  );

  console.log("\nTasks:");
  for (const task of tasks) {
    const icon = statusIcon(task.status);
    const dur = task.duration_ms ? ` (${formatDuration(task.duration_ms)})` : "";

    // 嘗試從 plan task 取得 title（report 只有 task_id，但部分場景 tasks 有 title）
    const taskLine = `  ${icon} ${task.task_id}${dur}`;
    console.log(taskLine);

    if (task.status === "failed" && task.error) {
      const errorPreview = task.error.slice(0, 80);
      console.log(`     → ${errorPreview}`);
    }
    if (task.status === "skipped" && task.error) {
      const reason = task.error;
      console.log(`     skipped (${reason})`);
    }
    if (task.status === "cancelled" && task.cancellation_reason) {
      console.log(`     cancelled (${task.cancellation_reason})`);
    }
  }

  // Resume Pack
  const resumePack = report.session_resume_pack ?? {};
  const resumableCount = Object.keys(resumePack).length;

  const failedIds = tasks
    .filter((t) => t.status === "failed" || t.status === "timeout")
    .map((t) => t.task_id);

  if (failedIds.length > 0 || resumableCount > 0) {
    console.log(`\nResume Pack:  ${resumableCount} tasks resumable`);
    if (failedIds.length > 0) {
      console.log(`  Run: devap run <plan> --only ${failedIds.join(",")} --resume-from <path>`);
    }
  }

  console.log(sep);
}

/**
 * 讀取並輸出報告的核心邏輯（便於測試）
 */
export async function executeReport(opts: { path?: string; json?: boolean }): Promise<void> {
  const reportPath = opts.path ?? join(homedir(), ".devap", "last-report.json");

  let rawContent: string;
  try {
    rawContent = await readFile(reportPath, "utf-8");
  } catch {
    console.error(`❌ 找不到執行報告：${reportPath}`);
    console.error("   請先執行 devap run 產生報告，或使用 --path 指定路徑。");
    process.exit(1);
    return; // 讓 TypeScript 知道後面不可達（測試中 exit 被 mock 時避免繼續執行）
  }

  let report: LastReport;
  try {
    report = JSON.parse(rawContent) as LastReport;
  } catch {
    console.error(`❌ 報告格式錯誤：${reportPath}`);
    process.exit(1);
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

/**
 * 註冊 report 命令到 commander
 */
export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .description("顯示上一次執行報告（XSPEC-054）")
    .option("--path <file>", "指定報告 JSON 檔案路徑（預設：~/.devap/last-report.json）")
    .option("--json", "輸出完整 JSON")
    .action(async (opts: { path?: string; json?: boolean }) => {
      await executeReport(opts);
    });
}
