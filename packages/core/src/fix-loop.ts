/**
 * Fix Loop — 自動修復迴圈
 *
 * 當 task 執行後驗證失敗或 Judge REJECT 時，
 * 自動將錯誤回饋注入 agent prompt 重試。
 *
 * 受 max_retries 和 max_retry_budget_usd 雙重限制（Cost Circuit Breaker）。
 * 純邏輯、透過回呼函式與外部互動。
 */

import type { FixFeedback, FixLoopAttempt, FixLoopConfig, FixLoopResult } from "./types.js";

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
  /** 結構化除錯回饋（借鑑 Superpowers 四階段除錯法） */
  structured_feedback?: FixFeedback;
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
  let consecutiveFailures = 0;
  const previousHypotheses: Array<{ hypothesis: string; result: string }> = [];

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

      // 借鑑 Superpowers 四階段除錯法：構建結構化回饋
      lastFeedback = buildStructuredFeedback(
        lastFeedback ?? "",
        consecutiveFailures,
        previousHypotheses,
      );
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
      consecutiveFailures = 0;
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

    consecutiveFailures++;
    // 記錄失敗假設供後續分析
    previousHypotheses.push({
      hypothesis: `attempt ${i}`,
      result: result.feedback ?? "未知錯誤",
    });

    lastFeedback = result.feedback;
  }

  return {
    success: false,
    attempts,
    total_retry_cost_usd: totalRetryCost,
    stop_reason: "max_retries",
  };
}

/**
 * 構建結構化除錯回饋（借鑑 Superpowers 四階段除錯法）
 *
 * 根據連續失敗次數決定除錯階段：
 * - 1 次失敗：Root Cause Investigation — 分析錯誤訊息，找出根因
 * - 2 次失敗：Pattern Analysis — 比對同類成功案例
 * - 3+ 次失敗：Architecture Questioning — 停止猜測，質疑架構設計
 *
 * Superpowers 的「3 次失敗規則」：連續 3 次修復失敗 → 質疑架構，停止猜測。
 */
export function buildStructuredFeedback(
  rawFeedback: string,
  consecutiveFailures: number,
  previousAttempts: Array<{ hypothesis: string; result: string }>,
): string {
  const sections: string[] = [rawFeedback];

  if (consecutiveFailures >= 3) {
    // Superpowers 3 次失敗規則：質疑架構
    sections.push(
      "",
      "---",
      "## ⚠️ 架構問題升級（Superpowers 3-Strike Rule）",
      "",
      "已連續失敗 3 次以上。**停止猜測性修復**，請：",
      "1. 質疑目前的架構設計是否正確",
      "2. 回顧所有先前嘗試，找出共同失敗模式",
      "3. 考慮是否需要重新設計方案而非修補",
      "",
      "### 先前嘗試記錄",
      ...previousAttempts.map((a) => `- **${a.hypothesis}**: ${a.result.slice(0, 200)}`),
      "",
      "Red Flags：如果你想到「quick fix」、「just try」、「should work now」→ 停下來，回到根因分析。",
    );
  } else if (consecutiveFailures >= 2) {
    // Pattern Analysis 階段
    sections.push(
      "",
      "---",
      "## 除錯指引：Pattern Analysis（第 2 階段）",
      "",
      "前次修復未解決問題。請：",
      "1. 比對同類成功案例的模式",
      "2. 檢查是否遺漏了某個前置條件",
      "3. 用最小化修改驗證假設",
      "",
      "### 先前嘗試",
      ...previousAttempts.map((a) => `- **${a.hypothesis}**: ${a.result.slice(0, 200)}`),
    );
  } else {
    // Root Cause Investigation 階段
    sections.push(
      "",
      "---",
      "## 除錯指引：Root Cause Investigation（第 1 階段）",
      "",
      "請先分析根因再修復，不要直接猜測：",
      "1. 仔細閱讀錯誤訊息，定位出錯的精確位置",
      "2. 追蹤變更記錄，找出是哪個修改引入了問題",
      "3. 在元件邊界加診斷觀測，定位故障層",
    );
  }

  return sections.join("\n");
}
