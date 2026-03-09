/**
 * Quality Profile — 品質預設模板
 *
 * 將 profile 名稱（strict/standard/minimal/none）展開為完整的 QualityConfig。
 * 支援使用者以 Partial<QualityConfig> 自訂覆寫。
 * 純函式、無副作用。
 */

import type { QualityConfig, QualityProfileName, TaskPlan } from "./types.js";

/**
 * 預設的 Quality Profile 定義
 */
const QUALITY_PROFILES: Record<QualityProfileName, QualityConfig> = {
  strict: {
    verify: true,
    judge_policy: "always",
    max_retries: 2,
    max_retry_budget_usd: 2.0,
  },
  standard: {
    verify: true,
    judge_policy: "on_change",
    max_retries: 1,
    max_retry_budget_usd: 1.0,
  },
  minimal: {
    verify: true,
    judge_policy: "never",
    max_retries: 0,
    max_retry_budget_usd: 0,
  },
  none: {
    verify: false,
    judge_policy: "never",
    max_retries: 0,
    max_retry_budget_usd: 0,
  },
};

/**
 * 判斷是否為 QualityProfileName
 */
function isProfileName(value: unknown): value is QualityProfileName {
  return typeof value === "string" && value in QUALITY_PROFILES;
}

/**
 * 解析 TaskPlan 的 quality 欄位，展開為完整的 QualityConfig
 *
 * - 字串 → 對應 profile 展開
 * - 物件 → 以 `none` 為基底，合併使用者自訂值
 * - undefined → `none`（向後相容）
 *
 * @param plan - 任務計畫
 * @returns 展開後的 QualityConfig
 */
export function resolveQualityProfile(plan: TaskPlan): QualityConfig {
  const quality = plan.quality;

  // 未設定 → none（向後相容）
  if (quality === undefined) {
    return { ...QUALITY_PROFILES.none };
  }

  // 字串 → profile 展開
  if (isProfileName(quality)) {
    return { ...QUALITY_PROFILES[quality] };
  }

  // 物件 → 以 none 為基底合併
  const base = { ...QUALITY_PROFILES.none };
  return {
    verify: quality.verify ?? base.verify,
    lint_command: quality.lint_command ?? base.lint_command,
    type_check_command: quality.type_check_command ?? base.type_check_command,
    judge_policy: quality.judge_policy ?? base.judge_policy,
    max_retries: quality.max_retries ?? base.max_retries,
    max_retry_budget_usd: quality.max_retry_budget_usd ?? base.max_retry_budget_usd,
  };
}

/**
 * 檢查品質相關警告
 *
 * 當 quality.verify 為 true 但 task 缺少 verify_command 時，產生警告。
 *
 * @param plan - 任務計畫
 * @param qualityConfig - 展開後的品質設定
 * @returns 警告訊息列表
 */
export function checkQualityWarnings(
  plan: TaskPlan,
  qualityConfig: QualityConfig,
): string[] {
  const warnings: string[] = [];

  if (!qualityConfig.verify) {
    return warnings;
  }

  const globalVerify = plan.defaults?.verify_command;

  for (const task of plan.tasks) {
    if (!task.verify_command && !globalVerify) {
      warnings.push(
        `Task ${task.id} 缺少 verify_command，但 quality profile 要求驗證。建議加上驗證指令或在 defaults 中設定。`,
      );
    }
  }

  return warnings;
}
