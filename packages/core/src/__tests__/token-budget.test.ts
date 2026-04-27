/**
 * XSPEC-092: Token 預算管理 — unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TokenBudgetTracker,
  checkTokenBudget,
  DEFAULT_PRICING,
  type TokenRecord,
  type TokenBudgetConfig,
} from "../token-budget.js";

// Mock HITL gate — mutable per-test
let hitlPassed = true;
let hitlDecision: string = "confirmed";

vi.mock("../hitl-gate.js", () => ({
  runHITLGate: vi.fn(async () => ({
    passed: hitlPassed,
    decision: hitlDecision,
    audit: {
      stepId: "token-budget:test",
      decision: hitlDecision,
      timestamp: new Date().toISOString(),
      confirmer: "test-user",
      timeoutSeconds: 300,
    },
  })),
}));

function makeRecord(
  model: string,
  inputTokens: number,
  outputTokens: number,
  stepId = "step-1"
): TokenRecord {
  return {
    stepId,
    model,
    inputTokens,
    outputTokens,
    timestamp: new Date().toISOString(),
  };
}

describe("TokenBudgetTracker", () => {
  let tracker: TokenBudgetTracker;

  beforeEach(() => {
    tracker = new TokenBudgetTracker();
  });

  describe("addUsage / getTotal", () => {
    it("should_start_with_zero_tokens", () => {
      const total = tracker.getTotal();
      expect(total.totalTokens).toBe(0);
      expect(total.inputTokens).toBe(0);
      expect(total.outputTokens).toBe(0);
    });

    it("should_accumulate_token_usage_across_steps", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 1000, 500, "step-1"));
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 2000, 800, "step-2"));

      const total = tracker.getTotal();
      expect(total.inputTokens).toBe(3000);
      expect(total.outputTokens).toBe(1300);
      expect(total.totalTokens).toBe(4300);
    });

    it("should_accumulate_across_different_models", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 1000, 500));
      tracker.addUsage(makeRecord("claude-haiku-4-5", 500, 200));

      expect(tracker.getTotal().totalTokens).toBe(2200);
    });
  });

  describe("getByModel", () => {
    it("should_group_usage_by_model", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 1000, 500, "step-1"));
      tracker.addUsage(makeRecord("claude-opus-4-7", 2000, 1000, "step-2"));
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 500, 200, "step-3"));

      const byModel = tracker.getByModel();
      expect(byModel["claude-sonnet-4-6"].inputTokens).toBe(1500);
      expect(byModel["claude-sonnet-4-6"].outputTokens).toBe(700);
      expect(byModel["claude-opus-4-7"].inputTokens).toBe(2000);
    });
  });

  describe("getThresholdStatus (AC-2/AC-3)", () => {
    it("should_return_ok_when_no_budget_configured", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 999999, 999999));
      expect(tracker.getThresholdStatus({})).toBe("ok");
    });

    it("should_return_ok_when_under_warn_threshold", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 50000, 20000)); // 70k
      const config: TokenBudgetConfig = { perWorkflow: 100000, warnThreshold: 0.8 };
      expect(tracker.getThresholdStatus(config)).toBe("ok");
    });

    it("should_return_warn_when_at_80_percent", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 60000, 22000)); // 82k > 80k
      const config: TokenBudgetConfig = { perWorkflow: 100000, warnThreshold: 0.8 };
      expect(tracker.getThresholdStatus(config)).toBe("warn");
    });

    it("should_return_exceeded_when_over_budget", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 80000, 25000)); // 105k > 100k
      const config: TokenBudgetConfig = { perWorkflow: 100000 };
      expect(tracker.getThresholdStatus(config)).toBe("exceeded");
    });

    it("should_use_default_80_percent_warn_threshold_when_not_specified", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 60000, 25000)); // 85k ≥ 80k of 100k
      const config: TokenBudgetConfig = { perWorkflow: 100000 };
      expect(tracker.getThresholdStatus(config)).toBe("warn");
    });
  });

  describe("estimateCostUsd", () => {
    it("should_calculate_cost_using_default_pricing", () => {
      // sonnet: $3/1M input, $15/1M output
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 1_000_000, 1_000_000));

      const cost = tracker.estimateCostUsd({});
      expect(cost).toBe(18); // 3 + 15 = 18 USD
    });

    it("should_use_custom_pricing_when_provided", () => {
      tracker.addUsage(makeRecord("custom-model", 1_000_000, 0));

      const cost = tracker.estimateCostUsd({
        pricing: { "custom-model": { inputPerMillion: 5.0, outputPerMillion: 20.0 } },
      });
      expect(cost).toBe(5);
    });

    it("should_fall_back_to_default_pricing_for_unknown_model", () => {
      // default: $3/1M input, $15/1M output
      tracker.addUsage(makeRecord("unknown-model", 1_000_000, 0));
      const cost = tracker.estimateCostUsd({});
      expect(cost).toBe(3);
    });

    it("should_return_zero_when_no_usage", () => {
      expect(tracker.estimateCostUsd({})).toBe(0);
    });
  });

  describe("formatCostReport", () => {
    it("should_include_total_tokens_and_cost_in_report", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 10000, 5000));
      const report = tracker.formatCostReport({});
      expect(report).toContain("Token 消耗報告");
      expect(report).toContain("15,000");
      expect(report).toContain("USD");
    });

    it("should_show_budget_percentage_when_configured", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 80000, 0));
      const report = tracker.formatCostReport({ perWorkflow: 100000 });
      expect(report).toContain("預算使用率");
      expect(report).toContain("80%");
    });

    it("should_show_model_breakdown_for_multiple_models", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 5000, 2000, "step-1"));
      tracker.addUsage(makeRecord("claude-haiku-4-5", 3000, 1000, "step-2"));
      const report = tracker.formatCostReport({});
      expect(report).toContain("claude-sonnet-4-6");
      expect(report).toContain("claude-haiku-4-5");
    });
  });

  describe("reset", () => {
    it("should_clear_all_records", () => {
      tracker.addUsage(makeRecord("claude-sonnet-4-6", 1000, 500));
      tracker.reset();
      expect(tracker.getTotal().totalTokens).toBe(0);
      expect(tracker.getRecords()).toHaveLength(0);
    });
  });
});

describe("checkTokenBudget", () => {
  let tracker: TokenBudgetTracker;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tracker = new TokenBudgetTracker();
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    hitlPassed = true;
    hitlDecision = "confirmed";
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    vi.clearAllMocks();
  });

  it("should_return_ok_when_under_budget", async () => {
    tracker.addUsage(makeRecord("claude-sonnet-4-6", 10000, 5000)); // 15k
    const config: TokenBudgetConfig = { perWorkflow: 100000 };

    const result = await checkTokenBudget(tracker, config, "step-1");
    expect(result.status).toBe("ok");
    expect(result.totalTokens).toBe(15000);
  });

  it("should_return_warn_and_log_when_at_80_percent_AC3", async () => {
    tracker.addUsage(makeRecord("claude-sonnet-4-6", 82000, 0)); // 82k ≥ 80k
    const config: TokenBudgetConfig = { perWorkflow: 100000 };

    const result = await checkTokenBudget(tracker, config, "step-1");
    expect(result.status).toBe("warn");
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("[WARN]"));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("80%"));
  });

  it("should_return_exceeded_confirmed_when_human_confirms_AC2", async () => {
    hitlPassed = true;
    hitlDecision = "confirmed";
    tracker.addUsage(makeRecord("claude-sonnet-4-6", 110000, 0)); // exceeded
    const config: TokenBudgetConfig = { perWorkflow: 100000 };

    const result = await checkTokenBudget(tracker, config, "step-2");
    expect(result.status).toBe("exceeded-confirmed");
  });

  it("should_return_exceeded_blocked_when_human_rejects_AC2", async () => {
    hitlPassed = false;
    hitlDecision = "rejected";
    tracker.addUsage(makeRecord("claude-sonnet-4-6", 110000, 0));
    const config: TokenBudgetConfig = { perWorkflow: 100000 };

    const result = await checkTokenBudget(tracker, config, "step-2");
    expect(result.status).toBe("exceeded-blocked");
    expect(result.message).toContain("拒絕");
    expect(consoleError).toHaveBeenCalled();
  });

  it("should_return_exceeded_blocked_with_ci_message_when_non_tty_AC4", async () => {
    hitlPassed = false;
    hitlDecision = "non-tty";
    tracker.addUsage(makeRecord("claude-sonnet-4-6", 110000, 0));
    const config: TokenBudgetConfig = { perWorkflow: 100000 };

    const result = await checkTokenBudget(tracker, config, "step-2");
    expect(result.status).toBe("exceeded-blocked");
    expect(result.message).toContain("CI");
    expect(consoleError).toHaveBeenCalled();
  });

  it("should_return_ok_when_no_budget_configured", async () => {
    tracker.addUsage(makeRecord("claude-sonnet-4-6", 999999, 999999));
    const result = await checkTokenBudget(tracker, {}, "step-1");
    expect(result.status).toBe("ok");
  });
});

describe("DEFAULT_PRICING", () => {
  it("should_have_default_key_as_fallback", () => {
    expect(DEFAULT_PRICING["default"]).toBeDefined();
    expect(DEFAULT_PRICING["default"].inputPerMillion).toBeGreaterThan(0);
  });

  it("should_have_claude_models", () => {
    expect(DEFAULT_PRICING["claude-sonnet-4-6"]).toBeDefined();
    expect(DEFAULT_PRICING["claude-opus-4-7"]).toBeDefined();
    expect(DEFAULT_PRICING["claude-haiku-4-5"]).toBeDefined();
  });
});
