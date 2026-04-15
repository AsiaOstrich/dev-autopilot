/**
 * `devap package` 子命令 — 根據 .devap/packaging.yaml 執行打包編排
 *
 * 用法：
 *   devap package [--target <name>] [--dry-run] [--config <path>]
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { load as yamlLoad } from "js-yaml";
import type { Command } from "commander";
import { orchestratePackaging, type PackagingConfig, type PackagingResult } from "@devap/core";

export interface PackageOptions {
  target?: string;
  dryRun?: boolean;
  config?: string;
}

/**
 * 取得隨 CLI 打包的內建 recipes 目錄
 * dist/index.js → dist/../recipes/
 */
function getBuiltinRecipesDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // dist/index.js → ../recipes/
  return resolve(__dirname, "..", "recipes");
}

/**
 * 印出打包結果摘要
 */
function printResults(results: PackagingResult[]): void {
  console.log("\n📦 打包結果：");

  for (const result of results) {
    if (result.success) {
      console.log(
        `  ✅ ${result.target} — 成功（${(result.duration / 1000).toFixed(1)}s）`,
      );
    } else {
      console.log(`  ❌ ${result.target} — 失敗`);
      if (result.error) {
        console.log(`     原因：${result.error}`);
      }
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`\n  總計：${succeeded} 成功，${failed} 失敗`);
}

/**
 * 執行 package 命令核心邏輯
 */
export async function executePackage(
  options: PackageOptions,
  cwd = process.cwd(),
): Promise<void> {
  const configPath = options.config
    ? resolve(options.config)
    : resolve(cwd, ".devap", "packaging.yaml");

  // 檢查 packaging.yaml 是否存在
  if (!existsSync(configPath)) {
    console.error(
      "❌ No .devap/packaging.yaml found. Create one to define packaging targets.",
    );
    console.error("\n範例 .devap/packaging.yaml：");
    console.error("  targets:");
    console.error("    - recipe: npm-cli");
    console.error("      config:");
    console.error("        registry: https://registry.npmjs.org");
    process.exit(1);
  }

  // 讀取並解析 packaging.yaml
  const rawContent = await readFile(configPath, "utf-8");
  let packagingConfig: PackagingConfig;

  try {
    packagingConfig = yamlLoad(rawContent) as PackagingConfig;
  } catch (error) {
    console.error(
      "❌ 無法解析 .devap/packaging.yaml：",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }

  if (!packagingConfig?.targets || !Array.isArray(packagingConfig.targets)) {
    console.error("❌ .devap/packaging.yaml 格式錯誤：缺少 targets 陣列");
    process.exit(1);
  }

  // 取得內建 recipes 目錄
  const udsRecipesDir = getBuiltinRecipesDir();

  if (options.dryRun) {
    console.log("🔍 Dry-run 模式：只顯示將執行的命令，不實際執行\n");
  }

  console.log(`📋 讀取打包宣告：${configPath}`);
  console.log(`🎯 Targets：${packagingConfig.targets.map((t) => t.recipe).join("、")}`);

  if (options.target) {
    console.log(`🔍 篩選 target：${options.target}`);
  }

  console.log("");

  // 執行打包編排
  let results: PackagingResult[];
  try {
    results = await orchestratePackaging(packagingConfig, cwd, {
      target: options.target,
      dryRun: options.dryRun,
      udsRecipesDir,
    });
  } catch (error) {
    console.error(
      "❌ 打包編排失敗：",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }

  // 印出結果
  printResults(results);

  // 有失敗時回傳非零 exit code
  const hasFailures = results.some((r) => !r.success);
  if (hasFailures) {
    process.exit(1);
  }
}

/**
 * 註冊 package 命令到 Commander program
 */
export function registerPackageCommand(program: Command): void {
  program
    .command("package")
    .description("根據 .devap/packaging.yaml 執行打包目標")
    .option("--target <name>", "只執行指定名稱的 target（以 recipe 名稱比對）")
    .option("--dry-run", "只顯示將執行的命令，不實際執行")
    .option("--config <path>", "指定 packaging.yaml 路徑", ".devap/packaging.yaml")
    .action(async (opts: PackageOptions) => {
      try {
        await executePackage(opts);
      } catch (error) {
        console.error(
          "❌ 打包失敗：",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });
}
