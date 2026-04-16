/**
 * ClaudeAdapter.executeTaskStream 串流執行單元測試（XSPEC-042）
 *
 * Mock @anthropic-ai/claude-agent-sdk 的 query() 函式，
 * 測試 AsyncGenerator 正確 yield TaskStreamEvent 並 return TaskResult。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task, ExecuteOptions, TaskStreamEvent, TaskResult } from "@devap/core";

// Mock claude-agent-sdk
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// 動態 import 以確保 mock 生效
const { ClaudeAdapter } = await import("./claude-adapter.js");

const baseTask: Task = {
  id: "T-stream-001",
  title: "Stream test task",
  spec: "Do something with tools",
};

const baseOptions: ExecuteOptions = {
  cwd: "/tmp/test-stream",
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

describe("ClaudeAdapter.executeTaskStream（XSPEC-042）", () => {
  let adapter: InstanceType<typeof ClaudeAdapter>;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    mockQuery.mockReset();
  });

  it("應收集並 yield tool_start 事件（來自 assistant message content）", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-stream-1" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tu-001", name: "bash", input: { command: "ls" } },
              { type: "text", text: "Executing bash command" },
            ],
          },
          parent_tool_use_id: null,
          uuid: "uuid-1",
          session_id: "sess-stream-1",
        },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-stream-1",
          total_cost_usd: 0.1,
          duration_ms: 500,
        },
      ]),
    );

    const events: TaskStreamEvent[] = [];
    const gen = adapter.executeTaskStream!(baseTask, baseOptions);

    let next: IteratorResult<TaskStreamEvent, TaskResult>;
    while (!(next = await gen.next()).done) {
      events.push(next.value);
    }
    const result = next.value;

    // 驗證 tool_start 事件
    const toolStart = events.find(e => e.type === "tool_start");
    expect(toolStart).toBeDefined();
    expect(toolStart).toMatchObject({
      type: "tool_start",
      task_id: "T-stream-001",
      tool_name: "bash",
      tool_input: { command: "ls" },
    });

    // 驗證 output_chunk 事件
    const outputChunk = events.find(e => e.type === "output_chunk");
    expect(outputChunk).toBeDefined();
    expect(outputChunk).toMatchObject({
      type: "output_chunk",
      task_id: "T-stream-001",
      chunk: "Executing bash command",
    });

    // 驗證 return 的 TaskResult
    expect(result.status).toBe("success");
    expect(result.task_id).toBe("T-stream-001");
    expect(result.session_id).toBe("sess-stream-1");
  });

  it("應 yield tool_end 事件（來自 tool_progress message）", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-stream-2" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tu-002", name: "read_file", input: { path: "/foo.ts" } },
            ],
          },
          parent_tool_use_id: null,
          uuid: "uuid-2",
          session_id: "sess-stream-2",
        },
        {
          type: "tool_progress",
          tool_use_id: "tu-002",
          tool_name: "read_file",
          parent_tool_use_id: null,
          elapsed_time_seconds: 0.5,
          uuid: "uuid-tp",
          session_id: "sess-stream-2",
        },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-stream-2",
          total_cost_usd: 0.05,
          duration_ms: 600,
        },
      ]),
    );

    const events: TaskStreamEvent[] = [];
    const gen = adapter.executeTaskStream!(baseTask, baseOptions);

    let next: IteratorResult<TaskStreamEvent, TaskResult>;
    while (!(next = await gen.next()).done) {
      events.push(next.value);
    }

    // 驗證 tool_end 事件
    const toolEnd = events.find(e => e.type === "tool_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd).toMatchObject({
      type: "tool_end",
      task_id: "T-stream-001",
      tool_name: "read_file",
      success: true,
    });
    expect((toolEnd as Extract<TaskStreamEvent, { type: "tool_end" }>).duration_ms).toBeGreaterThan(0);
  });

  it("應 yield progress 事件（來自 task_progress message）", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-stream-3" },
        {
          type: "system",
          subtype: "task_progress",
          task_id: "inner-task",
          tool_use_id: "tu-003",
          description: "Running tests",
          usage: { total_tokens: 100, tool_uses: 1, duration_ms: 200 },
          uuid: "uuid-3",
          session_id: "sess-stream-3",
        },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-stream-3",
          total_cost_usd: 0.08,
          duration_ms: 400,
        },
      ]),
    );

    const events: TaskStreamEvent[] = [];
    const gen = adapter.executeTaskStream!(baseTask, baseOptions);

    let next: IteratorResult<TaskStreamEvent, TaskResult>;
    while (!(next = await gen.next()).done) {
      events.push(next.value);
    }

    const progressEvent = events.find(e => e.type === "progress");
    expect(progressEvent).toBeDefined();
    expect(progressEvent).toMatchObject({
      type: "progress",
      task_id: "T-stream-001",
      message: "Running tests",
      step: 1,
    });
  });

  it("SDK 錯誤時，generator return 應為 failed TaskResult", async () => {
    mockQuery.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("SDK stream error");
      },
    }));

    const gen = adapter.executeTaskStream!(baseTask, baseOptions);
    let next: IteratorResult<TaskStreamEvent, TaskResult>;
    while (!(next = await gen.next()).done) {
      // 消耗所有 yield 事件
    }
    const result = next.value;

    expect(result.status).toBe("failed");
    expect(result.error).toBe("SDK stream error");
    expect(result.task_id).toBe("T-stream-001");
  });

  it("未收到 result message 時，generator return 應為 failed TaskResult", async () => {
    mockQuery.mockReturnValue(
      createStream([
        { type: "system", subtype: "init", session_id: "sess-noResult" },
        // 沒有 result message
      ]),
    );

    const gen = adapter.executeTaskStream!(baseTask, baseOptions);
    let next: IteratorResult<TaskStreamEvent, TaskResult>;
    while (!(next = await gen.next()).done) {
      // 消耗所有 yield 事件
    }
    const result = next.value;

    expect(result.status).toBe("failed");
    expect(result.error).toBe("未收到結果訊息");
  });

  it("executeTaskStream 應定義在 ClaudeAdapter 上", () => {
    const adapter2 = new ClaudeAdapter();
    expect(typeof adapter2.executeTaskStream).toBe("function");
  });
});
