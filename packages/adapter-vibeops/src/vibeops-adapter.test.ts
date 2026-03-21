import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VibeOpsAdapter } from "./vibeops-adapter.js";
import type { VibeOpsAdapterConfig } from "./types.js";
import type { Task, ExecuteOptions } from "@devap/core";

const BASE_URL = "http://localhost:3360";

function makeAdapter(config?: Partial<VibeOpsAdapterConfig>): VibeOpsAdapter {
  return new VibeOpsAdapter({ baseUrl: BASE_URL, ...config });
}

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: "T-001",
    title: "Test",
    spec: "實作用戶模型",
    depends_on: [],
    ...overrides,
  } as Task;
}

function makeOptions(overrides?: Partial<ExecuteOptions>): ExecuteOptions {
  return {
    cwd: "/tmp",
    ...overrides,
  } as ExecuteOptions;
}

describe("VibeOpsAdapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has name 'vibeops'", () => {
    const adapter = makeAdapter();
    expect(adapter.name).toBe("vibeops");
  });

  describe("isAvailable", () => {
    it("returns true when health check passes", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok", version: "1.0.0" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const adapter = makeAdapter();
      const result = await adapter.isAvailable();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/health`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("returns false when health check fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }));

      const adapter = makeAdapter();
      expect(await adapter.isAvailable()).toBe(false);
    });

    it("returns false when fetch throws", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

      const adapter = makeAdapter();
      expect(await adapter.isAvailable()).toBe(false);
    });

    it("returns false when status is error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "error" }),
      }));

      const adapter = makeAdapter();
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe("executeTask", () => {
    it("submits task and returns success result", async () => {
      const mockResponse = {
        sessionId: "vibeops-sess-1",
        status: "success",
        costUsd: 0.5,
        durationMs: 3000,
        reviewerPassed: true,
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }));

      const adapter = makeAdapter();
      const result = await adapter.executeTask(makeTask(), makeOptions());

      expect(result.task_id).toBe("T-001");
      expect(result.status).toBe("success");
      expect(result.session_id).toBe("vibeops-sess-1");
      expect(result.cost_usd).toBe(0.5);
      expect(result.duration_ms).toBe(3000);
      expect(result.verification_passed).toBe(true);
    });

    it("handles HTTP error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      }));

      const adapter = makeAdapter();
      const result = await adapter.executeTask(makeTask(), makeOptions());

      expect(result.status).toBe("failed");
      expect(result.error).toContain("500");
    });

    it("handles network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      const adapter = makeAdapter();
      const result = await adapter.executeTask(makeTask(), makeOptions());

      expect(result.status).toBe("failed");
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("routes to correct agent based on spec", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "success",
          costUsd: 0,
          durationMs: 100,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = makeAdapter();
      await adapter.executeTask(
        makeTask({ spec: "部署到 staging" }),
        makeOptions(),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.agent).toBe("operator");
    });

    it("includes apiToken in headers", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "success",
          costUsd: 0,
          durationMs: 100,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = makeAdapter({ apiToken: "my-token" });
      await adapter.executeTask(makeTask(), makeOptions());

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers["Authorization"]).toBe("Bearer my-token");
    });

    it("returns failed result with reviewerPassed", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "failed",
          costUsd: 0.3,
          durationMs: 500,
          reviewerPassed: false,
          result: "tests failed",
        }),
      }));

      const adapter = makeAdapter();
      const result = await adapter.executeTask(makeTask(), makeOptions());

      expect(result.status).toBe("failed");
      expect(result.verification_passed).toBe(false);
      expect(result.error).toBe("tests failed");
    });
  });

  describe("resumeSession", () => {
    it("sends POST to resume endpoint", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = makeAdapter();
      await adapter.resumeSession("sess-123");

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/api/pipeline/resume`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sessionId: "sess-123" }),
        }),
      );
    });

    it("throws on failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Session not found",
      }));

      const adapter = makeAdapter();
      await expect(adapter.resumeSession("bad-id")).rejects.toThrow("404");
    });
  });
});
