import { Command } from "commander";
import { join } from "node:path";
import { MissionManager } from "@devap/core";
import { isMissionType, VALID_MISSION_TYPES, type MissionRecord } from "@devap/core";

const STATUS_ICON: Record<string, string> = {
  PLANNING:    "📋",
  IN_PROGRESS: "🔄",
  PAUSED:      "⏸️ ",
  COMPLETED:   "✅",
  CANCELLED:   "❌",
};

function getManager(cwd: string): MissionManager {
  return new MissionManager(join(cwd, ".devap"));
}

function printRecord(r: MissionRecord): void {
  const icon = STATUS_ICON[r.status] ?? "❓";
  console.log(`  ${icon} [${r.status}] ${r.type}: ${r.intent}`);
  console.log(`     ID: ${r.id}`);
  console.log(`     建立：${r.createdAt}`);
  if (r.pausedAt)    console.log(`     暫停：${r.pausedAt}`);
  if (r.completedAt) console.log(`     完成：${r.completedAt}`);
  if (r.cancelledAt) console.log(`     取消：${r.cancelledAt}`);
}

export function createMissionCommand(): Command {
  const mission = new Command("mission").description(
    "Mission 生命週期管理（start / status / pause / resume / cancel / list）"
  );

  // devap mission start <type> "<intent>"
  mission
    .command("start <type> <intent>")
    .description("建立新 Mission（genesis / renovate / medic / exodus / guardian）")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (type: string, intent: string, opts: { cwd: string }) => {
      if (!isMissionType(type)) {
        console.error(`❌ 無效的 Mission 類型：'${type}'`);
        console.error(`   有效類型：${VALID_MISSION_TYPES.join(" | ")}`);
        process.exit(1);
      }
      const mgr = getManager(opts.cwd);
      const record = await mgr.create(type, intent);
      console.log(`\n✅ Mission 建立成功`);
      printRecord(record);
      console.log(`\n  執行 \`devap mission status\` 查看進度`);
    });

  // devap mission status
  mission
    .command("status")
    .description("顯示當前 Mission 狀態")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (opts: { cwd: string }) => {
      const mgr = getManager(opts.cwd);
      const current = await mgr.getCurrent();
      if (!current) {
        console.log("📭 目前沒有進行中的 Mission。");
        console.log("   使用 `devap mission start <type> \"<intent>\"` 建立新 Mission。");
        return;
      }
      console.log("\n📊 當前 Mission：");
      printRecord(current);
    });

  // devap mission pause
  mission
    .command("pause")
    .description("暫停當前 Mission")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (opts: { cwd: string }) => {
      const mgr = getManager(opts.cwd);
      try {
        const record = await mgr.pause();
        console.log(`\n⏸️  Mission 已暫停`);
        printRecord(record);
      } catch (e) {
        console.error(`❌ ${(e as Error).message}`);
        process.exit(1);
      }
    });

  // devap mission resume
  mission
    .command("resume")
    .description("繼續暫停中的 Mission")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (opts: { cwd: string }) => {
      const mgr = getManager(opts.cwd);
      try {
        const record = await mgr.resume();
        console.log(`\n🔄 Mission 已繼續`);
        printRecord(record);
      } catch (e) {
        console.error(`❌ ${(e as Error).message}`);
        process.exit(1);
      }
    });

  // devap mission cancel
  mission
    .command("cancel")
    .description("取消當前 Mission")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (opts: { cwd: string }) => {
      const mgr = getManager(opts.cwd);
      try {
        const record = await mgr.cancel();
        console.log(`\n❌ Mission 已取消`);
        printRecord(record);
      } catch (e) {
        console.error(`❌ ${(e as Error).message}`);
        process.exit(1);
      }
    });

  // devap mission list
  mission
    .command("list")
    .description("列出所有 Mission 記錄")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (opts: { cwd: string }) => {
      const mgr = getManager(opts.cwd);
      const all = await mgr.list();
      if (all.length === 0) {
        console.log("📭 尚無 Mission 記錄。");
        return;
      }
      console.log(`\n📋 Mission 清單（共 ${all.length} 筆）：\n`);
      for (const r of all) {
        printRecord(r);
        console.log();
      }
    });

  return mission;
}
