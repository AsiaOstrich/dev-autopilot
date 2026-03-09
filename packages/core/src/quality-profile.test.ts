import { describe, it, expect } from "vitest";
import { resolveQualityProfile, checkQualityWarnings } from "./quality-profile.js";
import type { TaskPlan, QualityConfig } from "./types.js";

/** 最小 plan（用於測試） */
function makePlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    project: "test",
    tasks: [
      { id: "T-001", title: "A", spec: "do A" },
    ],
    ...overrides,
  };
}

describe("resolveQualityProfile", () => {
  it("未設定 quality → none profile", () => {
    const config = resolveQualityProfile(makePlan());
    expect(config.verify).toBe(false);
    expect(config.judge_policy).toBe("never");
    expect(config.max_retries).toBe(0);
  });

  it("quality: 'strict' → 完整品質檢查", () => {
    const config = resolveQualityProfile(makePlan({ quality: "strict" }));
    expect(config.verify).toBe(true);
    expect(config.judge_policy).toBe("always");
    expect(config.max_retries).toBe(2);
    expect(config.max_retry_budget_usd).toBe(2.0);
  });

  it("quality: 'standard' → 標準品質檢查", () => {
    const config = resolveQualityProfile(makePlan({ quality: "standard" }));
    expect(config.verify).toBe(true);
    expect(config.judge_policy).toBe("on_change");
    expect(config.max_retries).toBe(1);
    expect(config.max_retry_budget_usd).toBe(1.0);
  });

  it("quality: 'minimal' → 僅驗證", () => {
    const config = resolveQualityProfile(makePlan({ quality: "minimal" }));
    expect(config.verify).toBe(true);
    expect(config.judge_policy).toBe("never");
    expect(config.max_retries).toBe(0);
  });

  it("quality: 'none' → 無品質檢查", () => {
    const config = resolveQualityProfile(makePlan({ quality: "none" }));
    expect(config.verify).toBe(false);
    expect(config.judge_policy).toBe("never");
    expect(config.max_retries).toBe(0);
  });

  it("自訂物件覆寫", () => {
    const config = resolveQualityProfile(makePlan({
      quality: {
        verify: true,
        judge_policy: "always",
        max_retries: 3,
        max_retry_budget_usd: 5.0,
        lint_command: "eslint .",
        type_check_command: "tsc --noEmit",
      },
    }));
    expect(config.verify).toBe(true);
    expect(config.judge_policy).toBe("always");
    expect(config.max_retries).toBe(3);
    expect(config.max_retry_budget_usd).toBe(5.0);
    expect(config.lint_command).toBe("eslint .");
    expect(config.type_check_command).toBe("tsc --noEmit");
  });

  it("部分物件覆寫，其餘用 none 基底", () => {
    const config = resolveQualityProfile(makePlan({
      quality: { verify: true, max_retries: 1 },
    }));
    expect(config.verify).toBe(true);
    expect(config.judge_policy).toBe("never"); // none 基底
    expect(config.max_retries).toBe(1);
    expect(config.max_retry_budget_usd).toBe(0); // none 基底
  });
});

describe("checkQualityWarnings", () => {
  it("verify=false → 無警告", () => {
    const plan = makePlan();
    const config: QualityConfig = {
      verify: false, judge_policy: "never", max_retries: 0, max_retry_budget_usd: 0,
    };
    expect(checkQualityWarnings(plan, config)).toEqual([]);
  });

  it("verify=true + task 缺少 verify_command → 產生警告", () => {
    const plan = makePlan({
      tasks: [
        { id: "T-001", title: "A", spec: "do A" },
        { id: "T-002", title: "B", spec: "do B", verify_command: "pnpm test" },
      ],
    });
    const config: QualityConfig = {
      verify: true, judge_policy: "never", max_retries: 0, max_retry_budget_usd: 0,
    };
    const warnings = checkQualityWarnings(plan, config);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("T-001");
  });

  it("verify=true + defaults 有 verify_command → 無警告", () => {
    const plan = makePlan({
      defaults: { verify_command: "pnpm test" },
      tasks: [
        { id: "T-001", title: "A", spec: "do A" },
      ],
    });
    const config: QualityConfig = {
      verify: true, judge_policy: "never", max_retries: 0, max_retry_budget_usd: 0,
    };
    expect(checkQualityWarnings(plan, config)).toEqual([]);
  });
});
