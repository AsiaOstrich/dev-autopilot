/**
 * `devap init` 子命令 — 安裝 devap 專有 Skills 到目標專案
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";

/** devap 專有 skills 清單 */
const DEVAP_SKILLS = ["plan", "orchestrate", "dev-workflow-guide"] as const;

/**
 * 取得 skills 來源目錄（打包後位於 dist/../skills/）
 */
function getSkillsSourceDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // dist/index.js → ../skills/
  return resolve(__dirname, "..", "skills");
}

export interface InitOptions {
  force?: boolean;
  target?: string;
}

/**
 * 執行 init 命令核心邏輯
 */
export function executeInit(options: InitOptions): void {
  const { force = false, target = "." } = options;

  const skillsSource = getSkillsSourceDir();

  // 檢查來源是否存在
  if (!existsSync(skillsSource)) {
    throw new Error(
      `Skills 來源目錄不存在：${skillsSource}\n` +
        "請確認 devap 套件安裝正確（skills 應隨 npm 套件一同發佈）。",
    );
  }

  const targetBase = resolve(target, ".claude", "skills");
  mkdirSync(targetBase, { recursive: true });

  let installed = 0;
  let skipped = 0;

  for (const skill of DEVAP_SKILLS) {
    const src = resolve(skillsSource, skill);
    const dest = resolve(targetBase, skill);

    if (!existsSync(src)) {
      console.warn(`⚠️  來源中找不到 ${skill}，跳過`);
      skipped++;
      continue;
    }

    if (existsSync(dest) && !force) {
      const files = readdirSync(dest);
      if (files.length > 0) {
        console.log(`⏭️  ${skill} 已存在，跳過（使用 --force 強制覆蓋）`);
        skipped++;
        continue;
      }
    }

    cpSync(src, dest, { recursive: true });
    console.log(`✅ 已安裝 ${skill}`);
    installed++;
  }

  console.log(
    `\n📦 安裝完成：${installed} 個 skills 已安裝，${skipped} 個跳過`,
  );
  console.log(`📁 目標路徑：${targetBase}`);
}

/**
 * 註冊 init 命令到 Commander program
 */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("安裝 devap 專有 Skills 到目標專案的 .claude/skills/")
    .option("--force", "強制覆蓋已存在的 skills")
    .option("--target <dir>", "指定目標專案路徑", ".")
    .action((opts: InitOptions) => {
      try {
        executeInit(opts);
      } catch (error) {
        console.error(
          "❌ 初始化失敗：",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });
}
