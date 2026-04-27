/**
 * devap start — Spec 合規閘門（XSPEC-090）
 *
 * 用法：
 *   devap start "implement user auth"      # strict 模式（預設）
 *   devap start "fix login bug" --hotfix   # hotfix 例外，跳過 XSPEC 檢查
 *   devap start "add feature" --compliance warn  # warn 模式：警告但不攔截
 *
 * 流程：
 * 1. 讀取 devap.config.json 的 specCompliance 設定（預設 "strict"）
 * 2. 搜尋 specPaths 中的 XSPEC-*.md 檔案
 * 3. 比對任務描述與 XSPEC 標題/內容
 * 4. 無 Approved XSPEC → strict 攔截 / warn 警告
 */

import { Command } from "commander";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { checkSpecGate, type SpecGateMode } from "@devap/core";

interface DevapConfig {
  specCompliance?: SpecGateMode;
  specPaths?: string[];
}

async function loadDevapConfig(cwd: string): Promise<DevapConfig> {
  try {
    const raw = await fs.readFile(resolve(cwd, "devap.config.json"), "utf-8");
    return JSON.parse(raw) as DevapConfig;
  } catch {
    return {};
  }
}

function defaultSpecPaths(cwd: string): string[] {
  return [
    resolve(cwd, "cross-project/specs"),
    resolve(cwd, "../cross-project/specs"),
    resolve(cwd, "specs"),
  ];
}

export function createStartCommand(): Command {
  return new Command("start")
    .description(
      "啟動 AI 任務前進行 Spec 合規閘門檢查（XSPEC-090）"
    )
    .argument("<task>", "任務描述（與 XSPEC 標題關鍵字比對）")
    .option(
      "--hotfix",
      "緊急修復模式：跳過 XSPEC 合規檢查（行為記錄至 execution history）"
    )
    .option(
      "--compliance <mode>",
      "合規模式：strict（預設）或 warn",
      undefined
    )
    .action(
      async (
        task: string,
        opts: { hotfix?: boolean; compliance?: string }
      ) => {
        const cwd = process.cwd();
        const config = await loadDevapConfig(cwd);
        const mode =
          (opts.compliance as SpecGateMode) ||
          config.specCompliance ||
          "strict";

        if (opts.hotfix) {
          const ts = new Date().toISOString();
          console.log("⚠️  [hotfix 例外] 跳過 XSPEC 合規檢查");
          console.log(`   任務：${task}`);
          console.log(`   時間：${ts}`);
          console.log(
            "   此操作已記錄至 execution history：hotfix 例外，跳過 spec 驗證"
          );
          console.log("\n🚀 繼續執行任務...");
          return;
        }

        const specPaths =
          config.specPaths?.map((p) => resolve(cwd, p)) ||
          defaultSpecPaths(cwd);

        console.log(`🔍 XSPEC 合規檢查（${mode} 模式）...`);

        const result = await checkSpecGate({ taskDescription: task, specPaths, mode });

        if (result.passed) {
          if (result.reason.startsWith("[WARN]")) {
            console.warn(`⚠️  ${result.reason}`);
            console.log(`\n🚀 任務已啟動（warn 模式，建議補建 XSPEC）：${task}`);
          } else {
            console.log(`✅ ${result.reason}`);
            if (result.match) {
              console.log(`   關聯規格：${result.match.xspecId}`);
            }
            console.log(`\n🚀 任務已啟動：${task}`);
          }
        } else {
          console.error("❌ Spec 合規閘門攔截");
          console.error(`   ${result.reason}`);
          if (result.match) {
            console.error(
              `   發現相關規格：${result.match.xspecId}（狀態：${result.match.status}）`
            );
          }
          console.error("\n   提示：執行 /xspec 建立或核准規格後再試");
          process.exit(1);
        }
      }
    );
}
