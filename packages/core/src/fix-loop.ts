/**
 * Fix Loop — 自動修復迴圈
 *
 * 當 task 執行後驗證失敗或 Judge REJECT 時，
 * 自動將錯誤回饋注入 agent prompt 重試。
 *
 * 受 max_retries 和 max_retry_budget_usd 雙重限制（Cost Circuit Breaker）。
 * 純邏輯、透過回呼函式與外部互動。
 */

import type { FixLoopAttempt, FixLoopConfig, FixLoopResult } from "./types.js";

/**
 * 單次執行函式的回傳值
 */
export interface ExecuteResult {
  /** 是否成功 */
  success: boolean;
  /** 此次執行的成本（美元） */
  cost_usd: number;
  /** 錯誤回饋（失敗時，將注入下次重試的 prompt） */
  feedback?: string;
}

/**
 * Fix Loop 回呼函式
 */
export interface FixLoopCallbacks {
  /**
   * 執行 task 並驗證
   * @param feedback - 前次失敗的回饋（首次為 undefined）
   * @param attempt - 嘗試次序（從 1 開始）
   * @returns 執行結果
   */
  execute: (feedback: string | undefined, attempt: number) => Promise<ExecuteResult>;

  /**
   * 進度通知（可選）
   * @param message - 進度訊息
   */
  onProgress?: (message: string) => void;
}

/**
 * 執行自動修復迴圈
 *
 * 流程：
 * 1. 首次執行（無 feedback）
 * 2. 若失敗 → 檢查重試條件（次數、預算）
 * 3. 條件允許 → 將 feedback 注入，重新執行
 * 4. 重複直到成功或條件不允許
 *
 * @param config - Fix Loop 設定
 * @param callbacks - 回呼函式
 * @returns Fix Loop 執行結果
 */
export async function runFixLoop(
  config: FixLoopConfig,
  callbacks: FixLoopCallbacks,
): Promise<FixLoopResult> {
  const attempts: FixLoopAttempt[] = [];
  let totalRetryCost = 0;
  let lastFeedback: string | undefined;

  // 首次執行 + 重試（最多 1 + max_retries 次）
  const maxAttempts = 1 + config.max_retries;

  for (let i = 1; i <= maxAttempts; i++) {
    const isRetry = i > 1;

    if (isRetry) {
      // 檢查成本熔斷器
      if (totalRetryCost >= config.max_retry_budget_usd) {
        callbacks.onProgress?.(
          `重試成本 $${totalRetryCost.toFixed(2)} 已達上限 $${config.max_retry_budget_usd.toFixed(2)}，停止重試`,
        );
        return {
          success: false,
          attempts,
          total_retry_cost_usd: totalRetryCost,
          stop_reason: "budget_exceeded",
        };
      }

      callbacks.onProgress?.(`第 ${i} 次嘗試（重試 ${i - 1}/${config.max_retries}）`);
    }

    const result = await callbacks.execute(lastFeedback, i);

    const attempt: FixLoopAttempt = {
      attempt: i,
      success: result.success,
      cost_usd: result.cost_usd,
      feedback: result.feedback,
    };
    attempts.push(attempt);

    if (result.success) {
      return {
        success: true,
        attempts,
        total_retry_cost_usd: totalRetryCost,
        stop_reason: "passed",
      };
    }

    // 記錄重試成本（首次不算重試成本）
    if (isRetry) {
      totalRetryCost += result.cost_usd;
    }

    lastFeedback = result.feedback;
  }

  return {
    success: false,
    attempts,
    total_retry_cost_usd: totalRetryCost,
    stop_reason: "max_retries",
  };
}
