/**
 * CLI Adapter 測試
 *
 * 使用 mock 驗證 CliAdapter 的核心邏輯。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCliOutput, resolveStatus, type CliJsonOutput } from "./output-parser.js";

/** 建立 mock CLI JSON 輸出 */
function createMockOutput(overrides?: Partial<CliJsonOutput>): CliJsonOutput {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "mock-session-123",
    duration_ms: 5000,
    duration_api_ms: 4000,
    num_turns: 5,
    result: "任務完成",
    cost_usd: 0.42,
    ...overrides,
  };
}

describe("parseCliOutput", () => {
  it("應正確解析有效的 JSON 輸出", () => {
    const output = createMockOutput();
    const result = parseCliOutput(JSON.stringify(output));

    expect(result.session_id).toBe("mock-session-123");
    expect(result.cost_usd).toBe(0.42);
    expect(result.duration_ms).toBe(5000);
    expect(result.subtype).toBe("success");
  });

  it("應拒絕空輸出", () => {
    expect(() => parseCliOutput("")).toThrow("CLI 輸出為空");
    expect(() => parseCliOutput("  ")).toThrow("CLI 輸出為空");
  });

  it("應拒絕無效的 JSON", () => {
    expect(() => parseCliOutput("not json")).toThrow("不是有效的 JSON");
  });

  it("應拒絕缺少 session_id 的輸出", () => {
    const output = { type: "result", subtype: "success" };
    expect(() => parseCliOutput(JSON.stringify(output))).toThrow("缺少 session_id");
  });

  it("應處理帶有空白字元的 JSON", () => {
    const output = createMockOutput();
    const result = parseCliOutput(`\n  ${JSON.stringify(output)}  \n`);
    expect(result.session_id).toBe("mock-session-123");
  });
});

describe("resolveStatus", () => {
  it("成功時應回傳 success", () => {
    const output = createMockOutput({ subtype: "success", is_error: false });
    expect(resolveStatus(output)).toBe("success");
  });

  it("max_turns 超時應回傳 timeout", () => {
    const output = createMockOutput({ subtype: "error_max_turns", is_error: true });
    expect(resolveStatus(output)).toBe("timeout");
  });

  it("max_budget 超時應回傳 timeout", () => {
    const output = createMockOutput({ subtype: "error_max_budget_usd", is_error: true });
    expect(resolveStatus(output)).toBe("timeout");
  });

  it("其他錯誤應回傳 failed", () => {
    const output = createMockOutput({ subtype: "error", is_error: true });
    expect(resolveStatus(output)).toBe("failed");
  });
});
