import { describe, it, expect, vi } from "vitest";
import { runFixLoop, type ExecuteResult } from "./fix-loop.js";
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
    // 第二次呼叫應帶有 feedback
    expect(execute).toHaveBeenCalledWith("error: test failed", 2);
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

    expect(feedbacks).toEqual([undefined, "error-1", "error-2"]);
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
});
