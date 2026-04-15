/**
 * SPEC-015: Recipe 載入器
 * 支援內建 Recipe（UDS recipes/）與使用者自訂 Recipe（./開頭路徑）
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";
import type { Recipe } from "./types.js";

/**
 * 取得隨 CLI 打包的 UDS 內建 recipes 目錄
 * 打包後結構：dist/index.js → dist/../recipes/{name}.yaml
 * 開發時結構：src/packaging/recipe-loader.ts → src/../../recipes/{name}.yaml（CLI 目錄）
 *
 * 優先使用 DEVAP_UDS_RECIPES_DIR 環境變數（供測試與自訂路徑使用）
 */
function getBuiltinRecipesDir(): string {
  // 環境變數優先（測試 / CI 用途）
  if (process.env.DEVAP_UDS_RECIPES_DIR) {
    return process.env.DEVAP_UDS_RECIPES_DIR;
  }

  // CLI 打包後位於 dist/ 旁的 recipes/ 目錄
  // import.meta.url 在打包後指向 dist/index.js 或 dist/packaging/...
  // 這裡使用 __dirname 相當的計算方式
  const currentDir = dirname(fileURLToPath(import.meta.url));

  // 從 packages/core/src/packaging/ 往上到 packages/cli/recipes/
  // 實際打包後 core 被 bundled 進 cli/dist，所以直接從 dist/../recipes
  // 開發時則透過 DEVAP_UDS_RECIPES_DIR 注入
  return resolve(currentDir, "..", "..", "..", "..", "cli", "recipes");
}

/**
 * 載入並解析 Recipe
 *
 * @param recipeName - 'npm-cli' 等內建名稱，或 './recipes/my.yaml' 等相對路徑
 * @param projectCwd - 使用者專案根目錄（自訂 Recipe 的解析基底）
 * @param udsRecipesDir - 覆蓋內建 recipes 目錄（主要供測試使用）
 */
export async function loadRecipe(
  recipeName: string,
  projectCwd: string,
  udsRecipesDir?: string,
): Promise<Recipe> {
  let filePath: string;

  if (recipeName.startsWith("./") || recipeName.startsWith("../")) {
    // 使用者自訂 Recipe：從專案目錄解析
    filePath = resolve(projectCwd, recipeName);
  } else {
    // 內建 Recipe：從 UDS recipes 目錄解析
    const recipesDir = udsRecipesDir ?? getBuiltinRecipesDir();
    filePath = resolve(recipesDir, `${recipeName}.yaml`);
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (cause) {
    throw new Error(
      `無法載入 Recipe "${recipeName}"：找不到檔案 ${filePath}`,
      { cause },
    );
  }

  let parsed: unknown;
  try {
    parsed = yamlLoad(content);
  } catch (cause) {
    throw new Error(
      `Recipe "${recipeName}" YAML 解析失敗：${filePath}`,
      { cause },
    );
  }

  return validateRecipe(parsed, recipeName);
}

/**
 * 驗證必填欄位並回傳型別安全的 Recipe
 */
function validateRecipe(raw: unknown, recipeName: string): Recipe {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(
      `Recipe "${recipeName}" 格式錯誤：期望 YAML 物件，實際為 ${typeof raw}`,
    );
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj["name"] !== "string" || !obj["name"]) {
    throw new Error(
      `Recipe "${recipeName}" 缺少必填欄位 "name"`,
    );
  }

  if (!Array.isArray(obj["steps"]) || obj["steps"].length === 0) {
    throw new Error(
      `Recipe "${recipeName}" 缺少必填欄位 "steps"（必須為非空陣列）`,
    );
  }

  // 驗證每個 step 都有 run 欄位
  for (let i = 0; i < (obj["steps"] as unknown[]).length; i++) {
    const step = (obj["steps"] as unknown[])[i];
    if (typeof step !== "object" || step === null || typeof (step as Record<string, unknown>)["run"] !== "string") {
      throw new Error(
        `Recipe "${recipeName}" 的 steps[${i}] 缺少必填欄位 "run"`,
      );
    }
  }

  return obj as unknown as Recipe;
}
