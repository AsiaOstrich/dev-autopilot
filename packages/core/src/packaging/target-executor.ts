/**
 * SPEC-015: Target 執行器
 * 執行單一打包 target 的所有步驟（含 hooks 和 config 佔位符替換）
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveConfig } from "./config-resolver.js";
import type { PackagingTarget, Recipe, PackagingResult } from "./types.js";

const execAsync = promisify(exec);

/**
 * 替換命令字串中的 {key} 佔位符
 *
 * @param command - 含 {key} 佔位符的命令字串
 * @param config - key-value 對應表
 * @returns 替換後的命令字串
 */
export function interpolateCommand(
  command: string,
  config: Record<string, string>,
): string {
  return command.replace(/\{(\w+)\}/g, (match, key: string) => {
    return key in config ? config[key] : match;
  });
}

/**
 * 執行單一 shell 命令（或 dry-run 時僅印出）
 */
async function runStep(
  command: string,
  cwd: string,
  dryRun: boolean,
  description?: string,
): Promise<void> {
  const label = description ? ` [${description}]` : "";

  if (dryRun) {
    console.log(`  [dry-run]${label} $ ${command}`);
    return;
  }

  console.log(`  ${label ? `${label} ` : ""}$ ${command}`);
  const { stdout, stderr } = await execAsync(command, { cwd });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

/**
 * 執行單一打包 target
 *
 * 執行順序：
 *   hooks.preBuild → recipe.steps → hooks.postBuild
 *
 * @param target - 使用者宣告的打包目標
 * @param recipe - 已載入的 Recipe
 * @param cwd - 使用者專案根目錄（命令的工作目錄）
 * @param dryRun - 若為 true，只印出命令不實際執行
 */
export async function executeTarget(
  target: PackagingTarget,
  recipe: Recipe,
  cwd: string,
  dryRun = false,
): Promise<PackagingResult> {
  const startTime = Date.now();
  const config = resolveConfig(recipe, target.config);

  try {
    // preBuild hook
    const preBuildHook = target.hooks?.preBuild ?? recipe.hooks?.["preBuild"] ?? null;
    if (preBuildHook) {
      const cmd = interpolateCommand(preBuildHook, config);
      await runStep(cmd, cwd, dryRun, "preBuild");
    }

    // Recipe 主步驟
    for (const step of recipe.steps) {
      const cmd = interpolateCommand(step.run, config);
      await runStep(cmd, cwd, dryRun, step.description);
    }

    // postBuild hook
    const postBuildHook = target.hooks?.postBuild ?? recipe.hooks?.["postBuild"] ?? null;
    if (postBuildHook) {
      const cmd = interpolateCommand(postBuildHook, config);
      await runStep(cmd, cwd, dryRun, "postBuild");
    }

    return {
      target: recipe.name,
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      target: recipe.name,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}
