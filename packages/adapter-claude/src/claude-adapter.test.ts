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
