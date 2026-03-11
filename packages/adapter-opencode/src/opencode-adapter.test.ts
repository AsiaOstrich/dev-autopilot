/**
 * OpenCode Adapter 單元測試
 *
 * Mock @opencode-ai/sdk 的 createOpencode() 函式，
 * 測試各種執行場景。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task, ExecuteOptions } from "@devap/core";

// Mock client methods
const mockSessionCreate = vi.fn();
const mockSessionPrompt = vi.fn();
const mockSessionFork = vi.fn();
const mockSessionGet = vi.fn();
const mockServerClose = vi.fn();

const mockClient = {
  session: {
    create: mockSessionCreate,
    prompt: mockSessionPrompt,
    fork: mockSessionFork,
    get: mockSessionGet,
  },
};

vi.mock("@opencode-ai/sdk", () => ({
  createOpencode: vi.fn(async () => ({
    client: mockClient,
    server: { close: mockServerClose },
  })),
}));

const { OpenCodeAdapter } = await import("./opencode-adapter.js");

const baseTask: Task = {
  id: "T-001",
  title: "Test task",
  spec: "Do something",
  verify_command: "pnpm test",
};

const baseOptions: ExecuteOptions = {
  cwd: "/tmp/test",
};

describe("OpenCodeAdapter", () => {
  let adapter: InstanceType<typeof OpenCodeAdapter>;

  beforeEach(() => {
    adapter = new OpenCodeAdapter();
    mockSessionCreate.mockReset();
    mockSessionPrompt.mockReset();
    mockSessionFork.mockReset();
    mockSessionGet.mockReset();
    mockServerClose.mockReset();

    // 預設回傳值
    mockSessionCreate.mockResolvedValue({ data: { id: "oc-sess-001" } });
    mockSessionPrompt.mockResolvedValue({
      data: { info: { cost: 0.5 } },
    });
  });

  it("name 應為 opencode", () => {
    expect(adapter.name).toBe("opencode");
  });

  it("新 session 成功執行任務", async () => {
    const result = await adapter.executeTask(baseTask, baseOptions);

    expect(result.status).toBe("success");
    expect(result.task_id).toBe("T-001");
    expect(result.session_id).toBe("oc-sess-001");
    expect(result.cost_usd).toBe(0.5);
    expect(result.verification_passed).toBe(true);

    expect(mockSessionCreate).toHaveBeenCalledWith({
      query: { directory: "/tmp/test" },
    });
  });

  it("resume 已有 session", async () => {
    const optionsWithSession: ExecuteOptions = {
      cwd: "/tmp/test",
      sessionId: "existing-sess",
    };

    const result = await adapter.executeTask(baseTask, optionsWithSession);

    expect(result.status).toBe("success");
    expect(result.session_id).toBe("existing-sess");
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSessionFork).not.toHaveBeenCalled();
  });

  it("fork session", async () => {
    mockSessionFork.mockResolvedValue({ data: { id: "forked-sess" } });

    const optionsWithFork: ExecuteOptions = {
      cwd: "/tmp/test",
      sessionId: "parent-sess",
      forkSession: true,
    };

    const result = await adapter.executeTask(baseTask, optionsWithFork);

    expect(result.status).toBe("success");
    expect(result.session_id).toBe("forked-sess");
    expect(mockSessionFork).toHaveBeenCalledWith({
      path: { id: "parent-sess" },
    });
  });

  it("任務失敗（prompt 回傳 error）", async () => {
    mockSessionPrompt.mockResolvedValue({
      data: { info: { cost: 0.3, error: "compilation error" } },
    });

    const result = await adapter.executeTask(baseTask, baseOptions);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("compilation error");
    expect(result.verification_passed).toBe(false);
  });

  it("SDK 拋出例外", async () => {
    mockSessionCreate.mockRejectedValue(new Error("server unreachable"));

    // 建立新 adapter 以避免已快取的 client
    const freshAdapter = new OpenCodeAdapter();
    const result = await freshAdapter.executeTask(baseTask, baseOptions);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("server unreachable");
  });

  it("isAvailable — CLI 不存在時回傳 false", async () => {
    const result = await adapter.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("resumeSession 呼叫 session.get", async () => {
    // 先觸發 ensureClient
    await adapter.executeTask(baseTask, baseOptions);

    await adapter.resumeSession("resume-sess");
    expect(mockSessionGet).toHaveBeenCalledWith({
      path: { id: "resume-sess" },
    });
  });

  it("dispose 應關閉 server", async () => {
    // 先觸發 ensureClient
    await adapter.executeTask(baseTask, baseOptions);

    await adapter.dispose();
    expect(mockServerClose).toHaveBeenCalled();
  });
});
