/**
 * CLI run 指令相關測試
 *
 * 測試 adapter factory、plan validation、dry-run 等功能。
 */

import { describe, it, expect } from "vitest";
import { createAdapter } from "../../adapter-factory.js";

describe("createAdapter", () => {
  it("claude → ClaudeAdapter", () => {
    const adapter = createAdapter("claude");
    expect(adapter.name).toBe("claude");
  });

  it("opencode → OpenCodeAdapter", () => {
    const adapter = createAdapter("opencode");
    expect(adapter.name).toBe("opencode");
  });

  it("cli → CliAdapter", () => {
    const adapter = createAdapter("cli");
    expect(adapter.name).toBe("cli");
  });

  it("不支援的 agent 類型應拋出錯誤", () => {
    expect(() => createAdapter("unknown")).toThrow("不支援的 agent 類型：unknown");
  });

  it("空字串應拋出錯誤", () => {
    expect(() => createAdapter("")).toThrow("不支援的 agent 類型：");
  });
});

describe("plan validation（透過 @devap/core）", () => {
  it("validatePlan 可正常 import", async () => {
    const { validatePlan } = await import("@devap/core");
    expect(typeof validatePlan).toBe("function");
  });

  it("無效 plan 應回傳驗證錯誤", async () => {
    const { validatePlan } = await import("@devap/core");
    const invalidPlan = { tasks: [] };
    const result = validatePlan(invalidPlan as never);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("缺少 tasks 欄位應回傳驗證錯誤", async () => {
    const { validatePlan } = await import("@devap/core");
    const invalidPlan = { project: "test" };
    const result = validatePlan(invalidPlan as never);
    expect(result.valid).toBe(false);
  });
});
