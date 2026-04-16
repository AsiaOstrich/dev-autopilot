/**
 * CLI run 指令相關測試
 *
 * 測試 adapter factory、plan validation、dry-run、telemetry 初始化等功能。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// ============================================================
// XSPEC-051: createOrchestrationTelemetry（CLI telemetry 初始化）
// ============================================================

// mock @asiaostrich/telemetry-client
const mockUpload = vi.fn().mockResolvedValue(undefined);
const MockTelemetryUploader = vi.fn().mockImplementation(() => ({ upload: mockUpload }));

vi.mock("@asiaostrich/telemetry-client", () => ({
  TelemetryUploader: MockTelemetryUploader,
}));

describe("XSPEC-051: createOrchestrationTelemetry", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    MockTelemetryUploader.mockClear();
    mockUpload.mockClear();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it("AC-1: ASIAOSTRICH_TELEMETRY_KEY 存在時回傳 TelemetryUploader 實例", async () => {
    process.env.ASIAOSTRICH_TELEMETRY_KEY = "test-api-key";
    const { createOrchestrationTelemetry } = await import("../../telemetry.js");
    const client = await createOrchestrationTelemetry();

    expect(client).toBeDefined();
    expect(MockTelemetryUploader).toHaveBeenCalledOnce();
    const ctorArgs = MockTelemetryUploader.mock.calls[0][0] as { serverUrl: string; apiKey: string };
    expect(ctorArgs.apiKey).toBe("test-api-key");
    expect(ctorArgs.serverUrl).toContain("asiaostrich");
  });

  it("AC-2: ASIAOSTRICH_TELEMETRY_URL 覆蓋預設 serverUrl", async () => {
    process.env.ASIAOSTRICH_TELEMETRY_KEY = "test-key";
    process.env.ASIAOSTRICH_TELEMETRY_URL = "https://custom.example.com/events";
    const { createOrchestrationTelemetry } = await import("../../telemetry.js");
    const client = await createOrchestrationTelemetry();

    expect(client).toBeDefined();
    const ctorArgs = MockTelemetryUploader.mock.calls[0][0] as { serverUrl: string; apiKey: string };
    expect(ctorArgs.serverUrl).toBe("https://custom.example.com/events");
  });

  it("AC-3: 無 apiKey 時回傳 undefined（靜默不上傳）", async () => {
    delete process.env.ASIAOSTRICH_TELEMETRY_KEY;
    delete process.env.ASIAOSTRICH_TELEMETRY_URL;
    const { createOrchestrationTelemetry } = await import("../../telemetry.js");
    const client = await createOrchestrationTelemetry();

    expect(client).toBeUndefined();
    expect(MockTelemetryUploader).not.toHaveBeenCalled();
  });

  it("AC-4: TelemetryUploader 動態 import 失敗時靜默回傳 undefined", async () => {
    process.env.ASIAOSTRICH_TELEMETRY_KEY = "test-key";
    // 模擬套件不可用
    vi.doMock("@asiaostrich/telemetry-client", () => {
      throw new Error("Module not found");
    });
    const { createOrchestrationTelemetry } = await import("../../telemetry.js");
    const client = await createOrchestrationTelemetry();

    // 不應 throw，應靜默回傳 undefined
    expect(client).toBeUndefined();
  });
});
