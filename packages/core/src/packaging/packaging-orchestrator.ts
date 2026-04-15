/**
 * SPEC-015: 打包編排器
 * 並行執行多個打包 targets（或篩選單一 target）
 */

import { loadRecipe } from "./recipe-loader.js";
import { executeTarget } from "./target-executor.js";
import type { PackagingConfig, PackagingResult } from "./types.js";

export interface OrchestrateOptions {
  /** 若指定，只執行名稱符合的 target（以 recipe 名稱比對） */
  target?: string;
  /** dry-run 模式：僅印出將執行的命令，不實際執行 */
  dryRun?: boolean;
  /** 覆蓋內建 recipes 目錄（主要供測試使用） */
  udsRecipesDir?: string;
}

/**
 * 並行編排多個打包 targets
 *
 * - 若 options.target 指定，只執行該 target
 * - 否則所有 targets 並行執行（Promise.allSettled）
 * - 任一 target 失敗不影響其他 target 繼續執行
 *
 * @param config - 來自 .devap/packaging.yaml 的完整打包宣告
 * @param cwd - 使用者專案根目錄
 * @param options - 編排選項
 */
export async function orchestratePackaging(
  config: PackagingConfig,
  cwd: string,
  options: OrchestrateOptions = {},
): Promise<PackagingResult[]> {
  const { target, dryRun = false, udsRecipesDir } = options;

  // 篩選要執行的 targets
  const targetsToRun = target
    ? config.targets.filter((t) => t.recipe === target || t.recipe.endsWith(`/${target}.yaml`))
    : config.targets;

  if (targetsToRun.length === 0) {
    if (target) {
      throw new Error(
        `找不到 target "${target}"。請確認 .devap/packaging.yaml 中的 recipe 名稱。`,
      );
    }
    return [];
  }

  // 並行執行所有 targets
  const settled = await Promise.allSettled(
    targetsToRun.map(async (t) => {
      const recipe = await loadRecipe(t.recipe, cwd, udsRecipesDir);
      return executeTarget(t, recipe, cwd, dryRun);
    }),
  );

  // 將 settled 結果轉換為 PackagingResult
  return settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    // 若 loadRecipe 或 executeTarget 本身拋出例外（非預期錯誤）
    const recipeName = targetsToRun[index].recipe;
    return {
      target: recipeName,
      success: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      duration: 0,
    };
  });
}
