import { describe, it, expect, vi } from "vitest";
import { runFixLoop, buildStructuredFeedback, computeErrorFingerprint, isStuck, getMaxRetries, type ExecuteResult } from "./fix-loop.js";
import type { FixLoopConfig } from "./types.js";
import type { JudgeResult } from "./judge.js";

describe("runFixLoop", () => {
  it("首次通過 → 不重試", async () => {
    const execute = vi.fn(async (): Promise<ExecuteResult> => ({
      success: true,
      cost_usd: 0.5,
    }));

    const result = await runFixLoop(
      { max_retries: 2, max_retry_budget_usd: 2.0 },
      { execute },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.total_retry_cost_usd).toBe(0);
    expect(result.stop_reason).toBe("passed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(undefined, 1);
  });

  it("首次失敗、第二次通過 → 重試 1 次", async () => {
    let callCount = 0;
    const execute = vi.fn(async (feedback: string | undefined): Promise<ExecuteResult> => {
      callCount++;
      if (callCount === 1) {
        return { success: false, cost_usd: 0.5, feedback: "error: test failed" };
      }
      return { success: true, cost_usd: 0.3 };
    });

    const result = await runFixLoop(
      { max_retries: 2, max_retry_budget_usd: 2.0 },
      { execute },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.stop_reason).toBe("passed");
    // 第二次呼叫應帶有 feedback（含結構化除錯指引）
    const secondCall = execute.mock.calls[1] as unknown as [string, number];
    expect(secondCall[0]).toContain("error: test failed");
    expect(secondCall[0]).toContain("Root Cause Investigation");
    expect(secondCall[1]).toBe(2);
    // 成功的重試不計入重試成本（只有失敗的重試才累計）
    expect(result.total_retry_cost_usd).toBe(0);
  });

  it("超過 max_retries → 停止", async () => {
    const execute = vi.fn(async (): Promise<ExecuteResult> => ({
      success: false,
      cost_usd: 0.3,
      feedback: "still failing",
    }));

    const result = await runFixLoop(
      { max_retries: 2, max_retry_budget_usd: 10.0 },
      { execute },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toHaveLength(3); // 1 initial + 2 retries
    expect(result.stop_reason).toBe("max_retries");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("超過 max_retry_budget_usd → 成本熔斷", async () => {
    let callCount = 0;
    const execute = vi.fn(async (): Promise<ExecuteResult> => {
      callCount++;
      return { success: false, cost_usd: 0.8, feedback: "expensive failure" };
    });

    const result = await runFixLoop(
      { max_retries: 5, max_retry_budget_usd: 1.0 },
      { execute },
    );

    expect(result.success).toBe(false);
    expect(result.stop_reason).toBe("budget_exceeded");
    // 首次(0.8) + 重試1(0.8) → 重試成本 0.8 >= 1.0? 不，0.8 < 1.0
    // 首次(0.8) + 重試1(0.8) + 要執行重試2時 → 重試成本 0.8 >= 1.0? 不
    // 首次(0.8) + 重試1(0.8) → totalRetryCost=0.8，繼續
    // 重試2(0.8) → totalRetryCost=1.6 >= 1.0，但此時已執行完
    // 等等，讓我重新想：首次不算重試成本
    // attempt 1: execute, cost=0.8, fail → totalRetryCost=0
    // attempt 2: isRetry, check 0 >= 1.0? no → execute, cost=0.8, fail → totalRetryCost=0.8
    // attempt 3: isRetry, check 0.8 >= 1.0? no → execute, cost=0.8, fail → totalRetryCost=1.6
    // attempt 4: isRetry, check 1.6 >= 1.0? yes → stop
    expect(result.attempts).toHaveLength(3);
    expect(result.total_retry_cost_usd).toBeCloseTo(1.6);
  });

  it("max_retries=0 → 不重試", async () => {
    const execute = vi.fn(async (): Promise<ExecuteResult> => ({
      success: false,
      cost_usd: 0.5,
      feedback: "failed",
    }));

    const result = await runFixLoop(
      { max_retries: 0, max_retry_budget_usd: 0 },
      { execute },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.stop_reason).toBe("max_retries");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("feedback 正確傳遞", async () => {
    const feedbacks: Array<string | undefined> = [];
    let callCount = 0;

    const execute = vi.fn(async (feedback: string | undefined): Promise<ExecuteResult> => {
      feedbacks.push(feedback);
      callCount++;
      if (callCount < 3) {
        return { success: false, cost_usd: 0.1, feedback: `error-${callCount}` };
      }
      return { success: true, cost_usd: 0.1 };
    });

    await runFixLoop(
      { max_retries: 5, max_retry_budget_usd: 10.0 },
      { execute },
    );

    // feedback 含結構化除錯指引，只檢查是否包含原始錯誤
    expect(feedbacks[0]).toBeUndefined();
    expect(feedbacks[1]).toContain("error-1");
    expect(feedbacks[1]).toContain("Root Cause Investigation");
    expect(feedbacks[2]).toContain("error-2");
    expect(feedbacks[2]).toContain("Pattern Analysis");
  });

  it("onProgress 被正確呼叫", async () => {
    const onProgress = vi.fn();
    let callCount = 0;

    const execute = vi.fn(async (): Promise<ExecuteResult> => {
      callCount++;
      if (callCount === 1) {
        return { success: false, cost_usd: 0.1, feedback: "fail" };
      }
      return { success: true, cost_usd: 0.1 };
    });

    await runFixLoop(
      { max_retries: 2, max_retry_budget_usd: 2.0 },
      { execute, onProgress },
    );

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes("第 2 次嘗試"),
    )).toBe(true);
  });

  it("重試時應注入結構化除錯回饋（Superpowers 四階段法）", async () => {
    const receivedFeedbacks: Array<string | undefined> = [];
    let callCount = 0;

    const execute = vi.fn(async (feedback: string | undefined): Promise<ExecuteResult> => {
      receivedFeedbacks.push(feedback);
      callCount++;
      if (callCount < 3) {
        return { success: false, cost_usd: 0.1, feedback: `error-${callCount}` };
      }
      return { success: true, cost_usd: 0.1 };
    });

    await runFixLoop(
      { max_retries: 5, max_retry_budget_usd: 10.0 },
      { execute },
    );

    // 首次無 feedback
    expect(receivedFeedbacks[0]).toBeUndefined();
    // 第二次應含 Root Cause Investigation 指引
    expect(receivedFeedbacks[1]).toContain("Root Cause Investigation");
    // 第三次應含 Pattern Analysis 指引
    expect(receivedFeedbacks[2]).toContain("Pattern Analysis");
  });
});

// ─────────────────────────────────────────────────────────────────
// XSPEC-061: 錯誤指紋偵測 + 動態重試上限
// ─────────────────────────────────────────────────────────────────

describe("computeErrorFingerprint()（XSPEC-061 AC-2）", () => {
  it("Judge verdict=APPROVE 時回傳 null", () => {
    const judgeResult: JudgeResult = { verdict: "APPROVE", reasoning: "all good" };
    expect(computeErrorFingerprint(judgeResult)).toBeNull();
  });

  it("Judge verdict=REJECT 且有 attack_vectors 時回傳非 null 字串", () => {
    const judgeResult: JudgeResult = {
      verdict: "REJECT",
      reasoning: "compilation failed",
      attack_vectors: ["SQL Injection"],
    };
    const fingerprint = computeErrorFingerprint(judgeResult);
    expect(fingerprint).not.toBeNull();
    expect(typeof fingerprint).toBe("string");
  });

  it("相同 attack_vectors 和 reasoning 產出相同指紋（確定性）", () => {
    const result1: JudgeResult = {
      verdict: "REJECT",
      reasoning: "type error on line 42",
      attack_vectors: ["Type Mismatch", "Null Reference"],
    };
    const result2: JudgeResult = {
      verdict: "REJECT",
      reasoning: "type error on line 42",
      attack_vectors: ["Type Mismatch", "Null Reference"],
    };
    expect(computeErrorFingerprint(result1)).toBe(computeErrorFingerprint(result2));
  });

  it("attack_vectors 順序不影響指紋（sorted 後計算）", () => {
    const resultA: JudgeResult = {
      verdict: "REJECT",
      reasoning: "compile error",
      attack_vectors: ["B-vector", "A-vector"],
    };
    const resultB: JudgeResult = {
      verdict: "REJECT",
      reasoning: "compile error",
      attack_vectors: ["A-vector", "B-vector"],
    };
    expect(computeErrorFingerprint(resultA)).toBe(computeErrorFingerprint(resultB));
  });

  it("不同 attack_vectors 產出不同指紋", () => {
    const result1: JudgeResult = {
      verdict: "REJECT",
      reasoning: "error",
      attack_vectors: ["SQL Injection"],
    };
    const result2: JudgeResult = {
      verdict: "REJECT",
      reasoning: "error",
      attack_vectors: ["Path Traversal"],
    };
    expect(computeErrorFingerprint(result1)).not.toBe(computeErrorFingerprint(result2));
  });

  it("attack_vectors 為空陣列時仍能計算指紋", () => {
    const judgeResult: JudgeResult = {
      verdict: "REJECT",
      reasoning: "unknown error",
      attack_vectors: [],
    };
    const fingerprint = computeErrorFingerprint(judgeResult);
    expect(fingerprint).not.toBeNull();
    expect(typeof fingerprint).toBe("string");
    expect((fingerprint as string).length).toBe(16); // 取前 16 字元
  });

  it("attack_vectors 為 undefined 時仍能計算指紋（降級處理）", () => {
    const judgeResult: JudgeResult = {
      verdict: "REJECT",
      reasoning: "compilation failed",
    };
    const fingerprint = computeErrorFingerprint(judgeResult);
    expect(fingerprint).not.toBeNull();
  });
});

describe("isStuck()（XSPEC-061 AC-1）", () => {
  // 簽名：isStuck(history: string[], current: string | null, threshold: number): boolean
  // history：之前迭代的指紋記錄（不含本次）
  // current：本次迭代的指紋
  // 邏輯：取 history 最後 (threshold-1) 筆 + current，若全部相同 → stuck=true

  it("空歷史（首次迭代）→ 不卡死", () => {
    expect(isStuck([], "abc123", 2)).toBe(false);
  });

  it("history 1 筆 + current 相同 → 連續 2 次 → 卡死（閾值 2）", () => {
    // history = ["abc123"]（第1次），current = "abc123"（第2次）→ 合計 2 次相同
    expect(isStuck(["abc123"], "abc123", 2)).toBe(true);
  });

  it("history 1 筆 + current 不同 → 不卡死", () => {
    expect(isStuck(["abc123"], "def456", 2)).toBe(false);
  });

  it("history 有多筆但最後 1 筆與 current 不同 → 不卡死", () => {
    // 最後一筆是 "def456"，current 是 "abc123" → 最後 2 次不同
    expect(isStuck(["abc123", "abc123", "def456"], "abc123", 2)).toBe(false);
  });

  it("history 最後 2 筆 + current 均相同 → 卡死（閾值 3）", () => {
    // threshold=3：取 history 最後 2 筆 + current = 3 筆
    expect(isStuck(["abc123", "abc123"], "abc123", 3)).toBe(true);
  });

  it("history 只有 1 筆但 current 相同 → 不卡死（閾值 3，不足 3 次）", () => {
    // threshold=3：需要 history 最後 2 筆 + current，但 history 只有 1 筆 → 不足
    expect(isStuck(["abc123"], "abc123", 3)).toBe(false);
  });

  it("current 為 null（Judge PASS）→ 永不卡死", () => {
    expect(isStuck([], null, 2)).toBe(false);
    expect(isStuck(["abc123"], null, 2)).toBe(false);
    expect(isStuck(["abc123", "abc123"], null, 2)).toBe(false);
  });
});

describe("getMaxRetries()（XSPEC-061 AC-5, AC-6, AC-7, AC-8）", () => {
  it("未定義 max_retries_by_source → 回傳全域 max_retries（AC-8 向後相容）", () => {
    const config: FixLoopConfig = { max_retries: 3, max_retry_budget_usd: 5.0 };
    expect(getMaxRetries(config, "compilation")).toBe(3);
    expect(getMaxRetries(config, "test_failure")).toBe(3);
  });

  it("failureSource=compilation → 回傳 max_retries_by_source.compilation=5（AC-5）", () => {
    const config: FixLoopConfig = {
      max_retries: 3,
      max_retry_budget_usd: 5.0,
      max_retries_by_source: { compilation: 5 },
    };
    expect(getMaxRetries(config, "compilation")).toBe(5);
  });

  it("failureSource=tool_failure → 回傳 max_retries_by_source.tool_failure=1（AC-5）", () => {
    const config: FixLoopConfig = {
      max_retries: 3,
      max_retry_budget_usd: 5.0,
      max_retries_by_source: { compilation: 5, tool_failure: 1 },
    };
    expect(getMaxRetries(config, "tool_failure")).toBe(1);
  });

  it("failureSource=resource_exhaustion → 回傳 0，立即停止（AC-7）", () => {
    const config: FixLoopConfig = {
      max_retries: 3,
      max_retry_budget_usd: 5.0,
      max_retries_by_source: { resource_exhaustion: 0 },
    };
    expect(getMaxRetries(config, "resource_exhaustion")).toBe(0);
  });

  it("未在 max_retries_by_source 定義的 failureSource → fallback 到全域 max_retries（AC-6）", () => {
    const config: FixLoopConfig = {
      max_retries: 3,
      max_retry_budget_usd: 5.0,
      max_retries_by_source: { compilation: 5 }, // 只定義 compilation
    };
    // model_degradation 未定義 → 使用全域 3
    expect(getMaxRetries(config, "model_degradation")).toBe(3);
  });

  it("failureSource 為 undefined → fallback 到全域 max_retries", () => {
    const config: FixLoopConfig = {
      max_retries: 3,
      max_retry_budget_usd: 5.0,
      max_retries_by_source: { compilation: 5 },
    };
    expect(getMaxRetries(config, undefined)).toBe(3);
  });
});

describe("runFixLoop + 指紋偵測整合（XSPEC-061 AC-1, AC-3）", () => {
  it("連續 2 次相同指紋 → stop_reason=stuck_on_fingerprint（AC-1）", async () => {
    // 模擬連續相同指紋：兩次 execute 都回傳相同 attack_vectors
    let callCount = 0;
    const execute = vi.fn(async (): Promise<ExecuteResult> => {
      callCount++;
      return {
        success: false,
        cost_usd: 0.3,
        feedback: "compilation failed",
        judge_result: {
          verdict: "REJECT",
          reasoning: "type error",
          attack_vectors: ["Type Mismatch"], // 每次相同
        },
      };
    });

    const result = await runFixLoop(
      {
        max_retries: 5,
        max_retry_budget_usd: 10.0,
        stop_on_fingerprint_repeat: 2,
      },
      { execute },
    );

    expect(result.stop_reason).toBe("stuck_on_fingerprint");
    expect(result.fingerprint).toBeDefined();
    // 停在第 2 次（initial + 1 retry），不等到 max_retries=5
    expect(result.attempts).toHaveLength(2);
  });

  it("指紋偵測優先於 max_retries（AC-1 + AC-5 組合）", async () => {
    const execute = vi.fn(async (): Promise<ExecuteResult> => ({
      success: false,
      cost_usd: 0.3,
      feedback: "compilation failed",
      judge_result: {
        verdict: "REJECT",
        reasoning: "type error",
        attack_vectors: ["Identical-Vector"],
      },
    }));

    // max_retries_by_source.compilation=5，但指紋閾值 2 應優先停止
    const result = await runFixLoop(
      {
        max_retries: 3,
        max_retry_budget_usd: 10.0,
        max_retries_by_source: { compilation: 5 },
        stop_on_fingerprint_repeat: 2,
      },
      {
        execute,
        getFailureSource: () => "compilation",
      },
    );

    expect(result.stop_reason).toBe("stuck_on_fingerprint");
    expect(result.attempts.length).toBeLessThan(5); // 不等到 compilation 的 max_retries=5
  });

  it("compilation failureSource 使用 max_retries=5（AC-5）", async () => {
    let callCount = 0;
    const execute = vi.fn(async (): Promise<ExecuteResult> => {
      callCount++;
      // 每次回傳不同指紋（不觸發 stuck），直到耗盡重試
      return {
        success: false,
        cost_usd: 0.1,
        feedback: "failing",
        judge_result: {
          verdict: "REJECT",
          reasoning: "compile error",
          attack_vectors: [`unique-${callCount}`], // 每次不同 → 不觸發 stuck
        },
      };
    });

    const result = await runFixLoop(
      {
        max_retries: 3,      // 全域
        max_retry_budget_usd: 100.0,
        max_retries_by_source: { compilation: 5 }, // compilation 優先
        stop_on_fingerprint_repeat: 2,
      },
      {
        execute,
        getFailureSource: () => "compilation",
      },
    );

    expect(result.stop_reason).toBe("max_retries");
    expect(result.attempts).toHaveLength(6); // 1 initial + 5 retries
  });
});

describe("FixLoopAttempt.error_fingerprint 記錄（XSPEC-061 AC-4）", () => {
  it("每次迭代的 attempt 記錄包含 error_fingerprint（有 judge_result 時）", async () => {
    let callCount = 0;
    const execute = vi.fn(async (): Promise<ExecuteResult> => {
      callCount++;
      if (callCount === 1) {
        return {
          success: false,
          cost_usd: 0.1,
          feedback: "fail",
          judge_result: { verdict: "REJECT", reasoning: "type error", attack_vectors: ["A"] },
        };
      }
      // 成功時也提供 judge_result（APPROVE verdict）
      return {
        success: true,
        cost_usd: 0.1,
        judge_result: { verdict: "APPROVE", reasoning: "all good" },
      };
    });

    const result = await runFixLoop(
      { max_retries: 3, max_retry_budget_usd: 10.0 },
      { execute },
    );

    // 第 1 次嘗試失敗，judge_result REJECT → error_fingerprint 為 hash string
    expect(result.attempts[0].error_fingerprint).not.toBeUndefined();
    expect(typeof result.attempts[0].error_fingerprint).toBe("string");
    // 第 2 次嘗試成功，judge_result APPROVE → error_fingerprint 為 null
    expect(result.attempts[1].error_fingerprint).toBeNull();
  });

  it("未提供 judge_result 時 error_fingerprint 為 undefined（向後相容）", async () => {
    const execute = vi.fn(async (): Promise<ExecuteResult> => ({
      success: true,
      cost_usd: 0.1,
    }));

    const result = await runFixLoop(
      { max_retries: 3, max_retry_budget_usd: 10.0 },
      { execute },
    );

    // 無 judge_result → error_fingerprint 為 undefined
    expect(result.attempts[0].error_fingerprint).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// BUG-A12 (XSPEC-073): JudgeVerdict 型別與 "PASS" 比較永不成立
// 回歸測試：確保 fix-loop 在 Judge APPROVE 時可正確終止收斂
// ─────────────────────────────────────────────────────────────────

describe("BUG-A12 regression: Judge APPROVE 時 fix-loop 正確終止（DEC-040 收斂機制）", () => {
  it("computeErrorFingerprint(APPROVE) 必須回傳 null（非 hash 字串）", () => {
    // 修復前：fix-loop.ts:224 比對 verdict === "PASS"（永不成立），
    // 導致 APPROVE 也會被當成 REJECT 計算 hash → fingerprintHistory 累積 →
    // isStuck 可能誤判 stuck，破壞 DEC-040 收斂語義。
    const approve: JudgeResult = { verdict: "APPROVE", reasoning: "ok" };
    expect(computeErrorFingerprint(approve)).toBeNull();
  });

  it("Judge APPROVE 時 runFixLoop 立即終止為 success（不進入 stuck 路徑）", async () => {
    // 模擬 1 次嘗試就 APPROVE 通過。若 BUG-A12 未修，APPROVE 會被計算為非 null
    // fingerprint，使 fingerprintHistory 累積，但因 success=true 會先 return passed，
    // 真正的破壞發生在「失敗→失敗→APPROVE」這種混合序列：APPROVE 不應 push 進 history。
    const execute = vi.fn(async (): Promise<ExecuteResult> => ({
      success: true,
      cost_usd: 0.05,
      judge_result: { verdict: "APPROVE", reasoning: "all good" },
    }));

    const result = await runFixLoop(
      { max_retries: 3, max_retry_budget_usd: 10.0 },
      { execute },
    );

    expect(result.success).toBe(true);
    expect(result.stop_reason).toBe("passed");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].error_fingerprint).toBeNull();
  });

  it("REJECT → APPROVE 序列：APPROVE 終止收斂為 passed（非 stuck）", async () => {
    // 修復前因 verdict === "PASS" 永不成立，APPROVE 也會被計算為非 null fingerprint，
    // 導致 fingerprintHistory 累積；但因 result.success=true 仍會 return passed，
    // 所以 BUG-A12 在「成功路徑」最直接的觀察點是 attempt 的 error_fingerprint 應為 null。
    let callCount = 0;
    const execute = vi.fn(async (): Promise<ExecuteResult> => {
      callCount++;
      if (callCount === 1) {
        return {
          success: false,
          cost_usd: 0.1,
          feedback: "fail",
          judge_result: {
            verdict: "REJECT",
            reasoning: "type error",
            attack_vectors: ["A"],
          },
        };
      }
      return {
        success: true,
        cost_usd: 0.1,
        judge_result: { verdict: "APPROVE", reasoning: "fixed" },
      };
    });

    const result = await runFixLoop(
      { max_retries: 5, max_retry_budget_usd: 10.0, stop_on_fingerprint_repeat: 3 },
      { execute },
    );

    expect(result.success).toBe(true);
    expect(result.stop_reason).toBe("passed");
    expect(result.attempts).toHaveLength(2);
    // 第一次 REJECT → hash string
    expect(typeof result.attempts[0].error_fingerprint).toBe("string");
    // 第二次 APPROVE → null（修復前會是 hash string）
    expect(result.attempts[1].error_fingerprint).toBeNull();
  });
});

describe("buildStructuredFeedback（Superpowers 借鑑）", () => {
  it("1 次失敗 → Root Cause Investigation", () => {
    const feedback = buildStructuredFeedback("test error", 1, []);
    expect(feedback).toContain("Root Cause Investigation");
    expect(feedback).toContain("test error");
  });

  it("2 次失敗 → Pattern Analysis", () => {
    const feedback = buildStructuredFeedback("test error", 2, [
      { hypothesis: "attempt 1", result: "failed" },
    ]);
    expect(feedback).toContain("Pattern Analysis");
    expect(feedback).toContain("先前嘗試");
  });

  it("3+ 次失敗 → 架構問題升級（3-Strike Rule）", () => {
    const feedback = buildStructuredFeedback("test error", 3, [
      { hypothesis: "attempt 1", result: "failed" },
      { hypothesis: "attempt 2", result: "also failed" },
    ]);
    expect(feedback).toContain("架構問題升級");
    expect(feedback).toContain("3-Strike Rule");
    expect(feedback).toContain("停止猜測性修復");
    expect(feedback).toContain("Red Flags");
  });

  it("先前嘗試記錄應被包含在回饋中", () => {
    const attempts = [
      { hypothesis: "attempt 1", result: "missing module error" },
      { hypothesis: "attempt 2", result: "type mismatch" },
    ];
    const feedback = buildStructuredFeedback("new error", 3, attempts);
    expect(feedback).toContain("missing module error");
    expect(feedback).toContain("type mismatch");
  });
});
