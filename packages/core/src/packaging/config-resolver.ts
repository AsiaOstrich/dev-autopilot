/**
 * SPEC-015: Config 解析器
 * 合併 Recipe 預設 config + 使用者覆蓋（使用者優先）
 */

import type { Recipe } from "./types.js";

/**
 * 合併 Recipe 預設 config 與使用者在 target.config 提供的覆蓋值
 *
 * 優先順序：使用者 targetConfig > Recipe 預設 config
 *
 * @param recipe - 已載入的 Recipe（含預設 config）
 * @param targetConfig - 使用者在 .devap/packaging.yaml 中的 config 覆蓋
 * @returns 合併後的 config（純字串 key-value）
 */
export function resolveConfig(
  recipe: Recipe,
  targetConfig?: Record<string, string>,
): Record<string, string> {
  const defaults = recipe.config ?? {};
  const overrides = targetConfig ?? {};

  // 使用者覆蓋優先
  return { ...defaults, ...overrides };
}
