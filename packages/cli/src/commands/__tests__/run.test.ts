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
// XSPEC-049: createProgressEmitter（CLI 結構化進度顯示）
// ============================================================

describe("XSPEC-049: createProgressEmitter", () => {
  it("task:start → ⏳ [N/M] 格式", async () => {
    const lines: string[] = [];
    const { createProgressEmitter } = await import("../../progress.js");
    const { emitter } = createProgressEmitter(false, (m) => lines.push(m));

    emitter.emit("event", { type: "orchestrator:start", plan_id: "p", task_count: 3, timestamp: "" });
    emitter.emit("event", { type: "task:start", task_id: "T-001", title: "實作登入", timestamp: "" });

    expect(lines[0]).toMatch(/⏳.*\[1\/3\].*T-001.*實作登入/);
  });

  it("task:complete → ✅ 含 duration", async () => {
    const lines: string[] = [];
    const { createProgressEmitter } = await import("../../progress.js");
    const { emitter } = createProgressEmitter(false, (m) => lines.push(m));

    emitter.emit("event", { type: "orchestrator:start", plan_id: "p", task_count: 2, timestamp: "" });
    emitter.emit("event", { type: "task:start", task_id: "T-001", title: "任務一", timestamp: "" });
    emitter.emit("event", { type: "task:complete", task_id: "T-001", status: "success", duration_ms: 5200, timestamp: "" });

    expect(lines[1]).toMatch(/✅.*T-001.*5\.2s/);
  });

  it("task:failed → ❌ 含 error", async () => {
    const lines: string[] = [];
    const { createProgressEmitter } = await import("../../progress.js");
    const { emitter } = createProgressEmitter(false, (m) => lines.push(m));

    emitter.emit("event", { type: "orchestrator:start", plan_id: "p", task_count: 1, timestamp: "" });
    emitter.emit("event", { type: "task:start", task_id: "T-001", title: "任務", timestamp: "" });
    emitter.emit("event", { type: "task:failed", task_id: "T-001", error: "build error", timestamp: "" });

    expect(lines[1]).toMatch(/❌.*T-001.*build error/);
  });

  it("task:cancelled → 🚫 含 reason", async () => {
    const lines: string[] = [];
    const { createProgressEmitter } = await import("../../progress.js");
    const { emitter } = createProgressEmitter(false, (m) => lines.push(m));

    emitter.emit("event", { type: "task:cancelled", task_id: "T-002", reason: "user_abort", timestamp: "" });

    expect(lines[0]).toMatch(/🚫.*T-002.*user_abort/);
  });

  it("task:skipped → ⏭  含 reason", async () => {
    const lines: string[] = [];
    const { createProgressEmitter } = await import("../../progress.js");
    const { emitter } = createProgressEmitter(false, (m) => lines.push(m));

    emitter.emit("event", { type: "task:skipped", task_id: "T-003", reason: "deps_failed", timestamp: "" });

    expect(lines[0]).toMatch(/⏭.*T-003.*deps_failed/);
  });

  it("signal:abort → ⚠  含 remaining_tasks", async () => {
    const lines: string[] = [];
    const { createProgressEmitter } = await import("../../progress.js");
    const { emitter } = createProgressEmitter(false, (m) => lines.push(m));

    emitter.emit("event", { type: "signal:abort", reason: "timeout", remaining_tasks: 3, timestamp: "" });

    expect(lines[0]).toMatch(/⚠.*timeout.*3/);
  });

  it("verbose=false → onProgress 為 undefined", async () => {
    const { createProgressEmitter } = await import("../../progress.js");
    const { onProgress } = createProgressEmitter(false);
    expect(onProgress).toBeUndefined();
  });

  it("verbose=true → onProgress 為縮排輸出函式", async () => {
    const lines: string[] = [];
    const { createProgressEmitter } = await import("../../progress.js");
    const { onProgress } = createProgressEmitter(true, (m) => lines.push(m));
    expect(typeof onProgress).toBe("function");
    onProgress!("detail message");
    expect(lines[0]).toMatch(/^\s+detail message/);
  });
});

// ============================================================
// XSPEC-051: createOrchestrationTelemetry（CLI telemetry 初始化）
// ============================================================

// mock asiaostrich-telemetry-client
const mockUpload = vi.fn().mockResolvedValue(undefined);
const MockTelemetryUploader = vi.fn().mockImplementation(() => ({ upload: mockUpload }));

vi.mock("asiaostrich-telemetry-client", () => ({
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
    vi.doMock("asiaostrich-telemetry-client", () => {
      throw new Error("Module not found");
    });
    const { createOrchestrationTelemetry } = await import("../../telemetry.js");
    const client = await createOrchestrationTelemetry();

    // 不應 throw，應靜默回傳 undefined
    expect(client).toBeUndefined();
  });
});
