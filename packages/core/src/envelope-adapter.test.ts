import { describe, it, expect } from "vitest";
import {
  mapDevapStatusToUnified,
  mapUnifiedStatusToDevap,
  taskResultToEnvelope,
  envelopeToTaskResult,
} from "./envelope-adapter.js";
import type { TaskResult, TaskStatus } from "./types.js";

describe("DevAP Envelope Adapter (SPEC-AGENT-COMM-001)", () => {
  describe("mapDevapStatusToUnified", () => {
    const cases: [TaskStatus, string][] = [
      ["success", "success"],
      ["failed", "failed"],
      ["skipped", "skipped"],
      ["timeout", "timeout"],
      ["done_with_concerns", "success_partial"],
      ["needs_context", "needs_context"],
      ["blocked", "blocked"],
    ];

    it.each(cases)("should map DevAP '%s' to unified '%s'", (devap, expected) => {
      expect(mapDevapStatusToUnified(devap)).toBe(expected);
    });

    it("should map unknown status to 'unknown'", () => {
      expect(mapDevapStatusToUnified("nonexistent")).toBe("unknown");
    });
  });

  describe("mapUnifiedStatusToDevap", () => {
    const cases: [string, TaskStatus][] = [
      ["success", "success"],
      ["success_partial", "done_with_concerns"],
      ["failed", "failed"],
      ["blocked", "blocked"],
      ["needs_context", "needs_context"],
      ["skipped", "skipped"],
      ["timeout", "timeout"],
      ["unknown", "failed"],
    ];

    it.each(cases)("should map unified '%s' to DevAP '%s'", (unified, expected) => {
      expect(mapUnifiedStatusToDevap(unified)).toBe(expected);
    });

    it("should fallback to 'failed' for unmapped status", () => {
      expect(mapUnifiedStatusToDevap("nonexistent")).toBe("failed");
    });
  });

  describe("taskResultToEnvelope", () => {
    const baseResult: TaskResult = {
      task_id: "T-001",
      status: "success",
      cost_usd: 0.05,
      duration_ms: 3000,
      verification_passed: true,
      retry_count: 0,
    };

    it("should create valid v1.0 envelope", () => {
      const envelope = taskResultToEnvelope(baseResult, {
        agent_id: "orchestrator-001",
        agent_type: "orchestrator",
      });

      expect(envelope.envelope_version).toBe("1.0");
      expect(envelope.source.project).toBe("devap");
      expect(envelope.status).toBe("success");
      expect(envelope.payload.artifact_type).toBe("plan");
      expect(envelope.payload.content.task_id).toBe("T-001");
      expect(envelope.metadata?.cost_usd).toBe(0.05);
    });

    it("should include concerns for done_with_concerns", () => {
      const result: TaskResult = {
        ...baseResult,
        status: "done_with_concerns",
        concerns: ["Lint warnings remain"],
      };
      const envelope = taskResultToEnvelope(result, { agent_id: "a", agent_type: "a" });

      expect(envelope.status).toBe("success_partial");
      expect(envelope.concerns).toEqual(["Lint warnings remain"]);
    });

    it("should set correlation_id from session_id", () => {
      const result: TaskResult = { ...baseResult, session_id: "sess-123" };
      const envelope = taskResultToEnvelope(result, { agent_id: "a", agent_type: "a" });

      expect(envelope.correlation_id).toBe("sess-123");
    });
  });

  describe("envelopeToTaskResult", () => {
    it("should convert envelope back to TaskResult", () => {
      const envelope = taskResultToEnvelope(
        { task_id: "T-002", status: "failed", cost_usd: 0.1, duration_ms: 5000, retry_count: 1, error: "timeout" },
        { agent_id: "orch", agent_type: "orchestrator" },
      );

      const result = envelopeToTaskResult(envelope);
      expect(result.task_id).toBe("T-002");
      expect(result.status).toBe("failed");
      expect(result.cost_usd).toBe(0.1);
      expect(result.duration_ms).toBe(5000);
      expect(result.retry_count).toBe(1);
    });

    it("should handle envelope with minimal fields", () => {
      const envelope = {
        envelope_version: "1.0" as const,
        message_id: "msg-min",
        source: { agent_id: "x", agent_type: "x", project: "vibeops" },
        status: "success" as const,
        timestamp: new Date().toISOString(),
        payload: { artifact_type: "code", artifact_id: "art-min", content: {} },
      };

      const result = envelopeToTaskResult(envelope);
      expect(result.status).toBe("success");
      expect(result.task_id).toBe("art-min");
    });
  });

  describe("round trip", () => {
    it("should preserve status through round trip", () => {
      const statuses: TaskStatus[] = [
        "success", "failed", "skipped", "timeout",
        "done_with_concerns", "needs_context", "blocked",
      ];

      for (const status of statuses) {
        const original: TaskResult = { task_id: `T-${status}`, status };
        const envelope = taskResultToEnvelope(original, { agent_id: "a", agent_type: "a" });
        const restored = envelopeToTaskResult(envelope);
        expect(restored.status).toBe(status);
      }
    });
  });
});
