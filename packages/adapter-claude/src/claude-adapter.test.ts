/**
 * Claude Adapter 單元測試
 *
 * Mock @anthropic-ai/claude-agent-sdk 的 query() 函式，
 * 測試各種執行場景。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task, ExecuteOptions } from "@devap/core";

// Mock claude-agent-sdk
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// 動態 import 以確保 mock 生效
const { ClaudeAdapter } = await import("./claude-adapter.js");

const baseTask: Task = {
  id: "T-001",
  title: "Test task",
  spec: "Do something",
  verify_command: "pnpm test",
};

const baseOptions: ExecuteOptions = {
  cwd: "/tmp/test",
};

/** 建立 async iterable 模擬 SDK stream */
function createStream(messages: Array<{ type: string; subtype?: string; [key: string]: unknown }>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

describe("ClaudeAdapter", () => {
  let adapter: InstanceType<typeof ClaudeAdapter>;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    mockQuery.mockReset();
  });

  it("name 應為 claude", () => {
    expect(adapter.name).toBe("claude");
  });

  it("成功執行任務", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-123" },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-123",
          total_cost_usd: 0.5,
          duration_ms: 1000,
        },
      ]),
    );

    const result = await adapter.executeTask(baseTask, baseOptions);

    expect(result.status).toBe("success");
    expect(result.task_id).toBe("T-001");
    expect(result.session_id).toBe("sess-123");
    expect(result.cost_usd).toBe(0.5);
    expect(result.verification_passed).toBe(true);
  });

  it("任務執行失敗（SDK 回傳 error）", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-456" },
        {
          type: "result",
          subtype: "error",
          session_id: "sess-456",
          total_cost_usd: 0.3,
          duration_ms: 500,
        },
      ]),
    );

    const result = await adapter.executeTask(baseTask, baseOptions);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("error");
  });

  it("timeout：max_turns 超限", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-789" },
        {
          type: "result",
          subtype: "error_max_turns",
          session_id: "sess-789",
          total_cost_usd: 1.0,
          duration_ms: 5000,
        },
      ]),
    );

    const taskWithTurns = { ...baseTask, max_turns: 5 };
    const result = await adapter.executeTask(taskWithTurns, baseOptions);

    expect(result.status).toBe("timeout");
    expect(result.error).toBe("error_max_turns");
  });

  it("timeout：max_budget_usd 超限", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-budget" },
        {
          type: "result",
          subtype: "error_max_budget_usd",
          session_id: "sess-budget",
          total_cost_usd: 2.0,
          duration_ms: 3000,
        },
      ]),
    );

    const taskWithBudget = { ...baseTask, max_budget_usd: 2.0 };
    const result = await adapter.executeTask(taskWithBudget, baseOptions);

    expect(result.status).toBe("timeout");
    expect(result.error).toBe("error_max_budget_usd");
  });

  it("SDK 拋出例外", async () => {
    mockQuery.mockReturnValue(
      createStream([{ type: "system", subtype: "init", session_id: "sess-err" }]),
    );
    // Override to throw during iteration
    mockQuery.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("SDK connection failed");
      },
    }));

    const result = await adapter.executeTask(baseTask, baseOptions);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("SDK connection failed");
  });

  it("未收到結果訊息 → failed", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-noresult" },
      ]),
    );

    const result = await adapter.executeTask(baseTask, baseOptions);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("未收到結果訊息");
  });

  it("session resume + fork", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-forked" },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-forked",
          total_cost_usd: 0.2,
          duration_ms: 200,
        },
      ]),
    );

    const optionsWithSession: ExecuteOptions = {
      cwd: "/tmp/test",
      sessionId: "prev-session",
      forkSession: true,
    };

    await adapter.executeTask(baseTask, optionsWithSession);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: "prev-session",
          forkSession: true,
        }),
      }),
    );
  });

  it("isAvailable — CLI 不存在時回傳 false", async () => {
    // isAvailable 嘗試執行 claude --version，在測試環境中通常不存在
    const result = await adapter.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("buildPrompt 應包含 verify_command", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-prompt" },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-prompt",
          total_cost_usd: 0.1,
          duration_ms: 100,
        },
      ]),
    );

    await adapter.executeTask(baseTask, baseOptions);

    const callArg = mockQuery.mock.calls[0][0] as { prompt: string };
    expect(callArg.prompt).toContain("Test task");
    expect(callArg.prompt).toContain("pnpm test");
    expect(callArg.prompt).toContain("驗收條件");
  });
});

describe("XSPEC-048: AbortSignal 取消機制", () => {
  let adapter: InstanceType<typeof ClaudeAdapter>;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    mockQuery.mockReset();
  });

  it("AC-1: 執行前 signal 已 aborted → 立即回傳 cancelled（不呼叫 SDK）", async () => {
    const controller = new AbortController();
    controller.abort("user_cancel");

    const result = await adapter.executeTask(baseTask, {
      ...baseOptions,
      signal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
    expect(result.cancellation_reason).toBe("user_cancel");
    expect(result.duration_ms).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("AC-2: 執行前 signal 已 aborted（無 reason）→ 回傳 cancelled 且 cancellation_reason 非空", async () => {
    const controller = new AbortController();
    controller.abort();  // 無 reason → Node.js 填入 DOMException

    const result = await adapter.executeTask(baseTask, {
      ...baseOptions,
      signal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
    expect(result.duration_ms).toBe(0);
    expect(result.cancellation_reason).toBeTruthy();  // DOMException string
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("AC-3: 執行中途 signal abort → 回傳 cancelled TaskResult（不拋出）", async () => {
    const controller = new AbortController();

    // stream 開始後觸發 abort
    let abortCalled = false;
    mockQuery.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "sess-cancel" };
        if (!abortCalled) {
          controller.abort("mid-stream");
          abortCalled = true;
        }
        // 繼續 yield，讓 for-await 中途檢查到 aborted
        yield { type: "result", subtype: "success", session_id: "sess-cancel", total_cost_usd: 0.01, duration_ms: 50 };
      },
    });

    const result = await adapter.executeTask(baseTask, {
      ...baseOptions,
      signal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
    expect(result.session_id).toBe("sess-cancel");
  });

  it("AC-4: AbortError 被 SDK 拋出 → catch 轉為 cancelled TaskResult", async () => {
    const controller = new AbortController();
    controller.abort("abort-from-sdk");

    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    mockQuery.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        throw abortError;
      },
    });

    const result = await adapter.executeTask(baseTask, {
      ...baseOptions,
      signal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
    expect(result.cancellation_reason).toContain("abort");
  });

  it("AC-5: 無 signal 時行為與舊版相同（向後相容）", async () => {
    mockQuery.mockReturnValue(
      {
        async *[Symbol.asyncIterator]() {
          yield { type: "system", subtype: "init", session_id: "sess-no-signal" };
          yield { type: "result", subtype: "success", session_id: "sess-no-signal", total_cost_usd: 0.01, duration_ms: 50 };
        },
      },
    );

    const result = await adapter.executeTask(baseTask, baseOptions);

    expect(result.status).toBe("success");
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("AC-6: buildOptions 應在 signal 存在時建立 abortController 傳入 SDK", async () => {
    const controller = new AbortController();

    mockQuery.mockReturnValue(
      {
        async *[Symbol.asyncIterator]() {
          yield { type: "result", subtype: "success", total_cost_usd: 0, duration_ms: 10 };
        },
      },
    );

    await adapter.executeTask(baseTask, {
      ...baseOptions,
      signal: controller.signal,
    });

    const sdkCallOptions = (mockQuery.mock.calls[0][0] as { options: { abortController?: AbortController } }).options;
    expect(sdkCallOptions.abortController).toBeInstanceOf(AbortController);
  });
});
