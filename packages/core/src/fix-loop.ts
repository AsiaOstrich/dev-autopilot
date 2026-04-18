/**
 * Fix Loop — 自動修復迴圈
 *
 * 當 task 執行後驗證失敗或 Judge REJECT 時，
 * 自動將錯誤回饋注入 agent prompt 重試。
 *
 * 受 max_retries 和 max_retry_budget_usd 雙重限制（Cost Circuit Breaker）。
 * 純邏輯、透過回呼函式與外部互動。
 */

import { createHash } from "node:crypto";
import type { FailureSource, FixFeedback, FixLoopAttempt, FixLoopConfig, FixLoopResult } from "./types.js";
import type { JudgeResult } from "./judge.js";

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
  /**
   * Judge 審查結果（XSPEC-061）
   *
   * 提供後，fix_loop 可從中計算 error_fingerprint 進行收斂偵測。
   * 若未提供，跳過指紋偵測（向後相容）。
   */
  judge_result?: JudgeResult;
  /**
   * 失敗來源分類（XSPEC-061）
   *
   * 提供後，fix_loop 使用 max_retries_by_source 查詢對應上限。
   * 若未提供，使用全域 max_retries。
   */
  failureSource?: FailureSource;
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

  /**
   * 取得當前的 failureSource（XSPEC-061，可選）
   *
   * 若 execute() 未在 ExecuteResult 中回傳 failureSource，
   * 可透過此 callback 取得（用於動態重試上限查詢）。
   * 未提供時 failureSource=undefined，使用全域 max_retries。
   */
  getFailureSource?: () => FailureSource | undefined;
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

  // XSPEC-061：指紋歷史記錄
  const fingerprintHistory: string[] = [];
  const fingerprintThreshold = config.stop_on_fingerprint_repeat ?? 2;

  // 首次執行時不確定 failureSource，先用全域 max_retries 決定上限
  // 首次失敗後更新 failureSource，下次迭代使用動態上限
  let currentMaxRetries = config.max_retries;
  let maxAttempts = 1 + currentMaxRetries;

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

      callbacks.onProgress?.(`第 ${i} 次嘗試（重試 ${i - 1}/${currentMaxRetries}）`);

      // 借鑑 Superpowers 四階段除錯法：構建結構化回饋
      lastFeedback = buildStructuredFeedback(
        lastFeedback ?? "",
        consecutiveFailures,
        previousHypotheses,
      );
    }

    const result = await callbacks.execute(lastFeedback, i);

    // XSPEC-061 AC-4：計算指紋
    // - judge_result 有提供 → computeErrorFingerprint（APPROVE 時回傳 null，REJECT 回傳 hash）
    // - judge_result 未提供 → undefined（向後相容，不填入）
    const fingerprint: string | null | undefined = result.judge_result
      ? computeErrorFingerprint(result.judge_result)
      : undefined;

    const attempt: FixLoopAttempt = {
      attempt: i,
      success: result.success,
      cost_usd: result.cost_usd,
      feedback: result.feedback,
      error_fingerprint: fingerprint,
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

    // XSPEC-061：收斂偵測（利用已計算的 fingerprint）
    if (fingerprint !== undefined) {
      if (isStuck(fingerprintHistory, fingerprint, fingerprintThreshold)) {
        return {
          success: false,
          attempts,
          total_retry_cost_usd: totalRetryCost,
          stop_reason: "stuck_on_fingerprint",
          fingerprint: fingerprint ?? undefined,
          next_recipe: "circuit_breaker",
        };
      }
      if (fingerprint !== null) {
        fingerprintHistory.push(fingerprint);
      }
    }

    // XSPEC-061：取得 failureSource，動態調整重試上限
    const failureSource = result.failureSource ?? callbacks.getFailureSource?.();
    if (failureSource && config.max_retries_by_source) {
      const dynamicMax = getMaxRetries(config, failureSource);
      if (dynamicMax !== currentMaxRetries) {
        currentMaxRetries = dynamicMax;
        // 重算 maxAttempts（1 initial + dynamic retries）
        maxAttempts = 1 + currentMaxRetries;
      }
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

// ─────────────────────────────────────────────────────────────────
// XSPEC-061: 錯誤指紋偵測 + 動態重試上限
// ─────────────────────────────────────────────────────────────────

/**
 * 計算錯誤指紋（XSPEC-061 AC-2）
 *
 * 利用 Judge 現有輸出計算指紋，零額外 LLM 呼叫。
 *
 * 公式：sha256(sorted(attack_vectors).join('|') + '::' + failureCategory) 取前 16 字元
 *
 * @param judgeResult - Judge 審查結果（需含 attack_vectors 和 reasoning）
 * @returns 16 字元 hex 指紋，Judge APPROVE 時回傳 null
 */
export function computeErrorFingerprint(judgeResult: JudgeResult): string | null {
  if (judgeResult.verdict === "APPROVE") return null;

  const attackVectors = (judgeResult.attack_vectors ?? []).sort().join("|");
  const failureCategory = categorizeFailureReason(judgeResult.reasoning);

  return createHash("sha256")
    .update(`${attackVectors}::${failureCategory}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * 規則式分類 failureReason（不呼叫 LLM）
 */
function categorizeFailureReason(reason: string): string {
  if (/compile|syntax|type\s*error|build/i.test(reason)) return "compilation";
  if (/test.*fail|assert|spec.*fail/i.test(reason)) return "test_failure";
  if (/tool.*fail|command.*not\s*found|exit\s*code/i.test(reason)) return "tool_failure";
  if (/resource|budget|token.*limit|timeout/i.test(reason)) return "resource_exhaustion";
  return "other";
}

/**
 * 判斷 fix_loop 是否卡死（XSPEC-061 AC-1）
 *
 * 檢查最近 threshold 次迭代（history 最後 threshold-1 筆 + current）是否全部相同。
 *
 * @param history - 過去所有迭代的指紋記錄（不含本次）
 * @param current - 本次迭代的指紋（null 表示 Judge APPROVE，永不卡死）
 * @param threshold - 連續相同次數觸發停止的閾值（預設 2）
 * @returns true = 卡死，應停止重試
 */
export function isStuck(history: string[], current: string | null, threshold: number): boolean {
  if (current === null) return false;
  if (history.length < threshold - 1) return false;

  const recent = history.slice(-(threshold - 1));
  return recent.every((fp) => fp === current);
}

/**
 * 依 failureSource 取得動態重試上限（XSPEC-061 AC-5, AC-6, AC-7, AC-8）
 *
 * 查詢順序：
 * 1. max_retries_by_source[failureSource]（若有定義）
 * 2. 全域 max_retries（fallback，向後相容）
 *
 * @param config - Fix Loop 設定
 * @param failureSource - 此次的失敗來源
 * @returns 此次應使用的最大重試次數
 */
export function getMaxRetries(
  config: FixLoopConfig,
  failureSource: FailureSource | undefined,
): number {
  if (failureSource !== undefined && config.max_retries_by_source) {
    const perSource = config.max_retries_by_source[failureSource];
    if (perSource !== undefined) return perSource;
  }
  return config.max_retries;
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
