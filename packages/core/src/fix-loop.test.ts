import { describe, it, expect, vi } from "vitest";
import { runFixLoop, buildStructuredFeedback, type ExecuteResult } from "./fix-loop.js";
import type { FixLoopConfig } from "./types.js";

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
