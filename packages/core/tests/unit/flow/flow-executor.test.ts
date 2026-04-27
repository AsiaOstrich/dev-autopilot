// [Implements XSPEC-087 AC-2/AC-3] FlowExecutor 單元測試
import { describe, it, expect, vi } from "vitest";
import { FlowExecutor, type StepHandlerMap } from "../../../src/flow/flow-executor.js";
import type { FlowDefinition } from "../../../src/types.js";

// ─────────────────────────────────────────────
// 測試 fixtures
// ─────────────────────────────────────────────

const THREE_STEP_FLOW: FlowDefinition = {
  name: "commit",
  steps: [
    { id: "generate-message", type: "ai-task" },
    {
      id: "user-confirm",
      type: "gate",
      gate: "HUMAN_CONFIRM",
      on_reject: "generate-message",
      requires: ["generate-message"],
    },
    {
      id: "execute-commit",
      type: "shell",
      command: "git commit",
      requires: ["user-confirm"],
    },
  ],
};

const TWO_STEP_FLOW: FlowDefinition = {
  name: "simple",
  steps: [
    { id: "step-a", type: "shell", command: "echo a" },
    { id: "step-b", type: "shell", command: "echo b", requires: ["step-a"] },
    { id: "step-c", type: "shell", command: "echo c", requires: ["step-b"] },
  ],
};

// ─────────────────────────────────────────────
// FlowExecutor tests
// ─────────────────────────────────────────────

describe("FlowExecutor", () => {
  describe("execute — step ordering", () => {
    // [Source: XSPEC-087 AC-2]
    it("should_execute_steps_in_declared_order", async () => {
      const order: string[] = [];
      const handlers: StepHandlerMap = new Map([
        ["step-a", async () => { order.push("step-a"); return "a"; }],
        ["step-b", async () => { order.push("step-b"); return "b"; }],
        ["step-c", async () => { order.push("step-c"); return "c"; }],
      ]);

      const executor = new FlowExecutor(TWO_STEP_FLOW);
      await executor.execute({}, handlers);

      expect(order).toEqual(["step-a", "step-b", "step-c"]);
    });

    it("should_skip_step_when_requires_dependency_not_met", async () => {
      const flowWithUnmetDep: FlowDefinition = {
        name: "test",
        steps: [
          { id: "orphan-step", type: "shell", requires: ["nonexistent"] },
        ],
      };
      const executor = new FlowExecutor(flowWithUnmetDep);
      const results = await executor.execute({}, new Map());

      expect(results[0].status).toBe("skipped");
      expect(results[0].error).toMatch(/依賴步驟未完成/);
    });
  });

  describe("execute — gate handling", () => {
    // [Source: XSPEC-087 AC-5] gate SUSPENDED → 後續步驟不執行
    it("should_suspend_at_gate_and_not_execute_subsequent_steps", async () => {
      const handlers: StepHandlerMap = new Map([
        ["generate-message", async () => "feat: add feature"],
      ]);

      const executor = new FlowExecutor(THREE_STEP_FLOW);
      const results = await executor.execute({}, handlers);

      expect(results.find((r) => r.stepId === "user-confirm")?.status).toBe("suspended");
      // execute-commit 在 gate 之後，不應該被執行
      expect(results.find((r) => r.stepId === "execute-commit")).toBeUndefined();
    });
  });

  describe("execute — dryRun mode", () => {
    // [Source: XSPEC-087 AC-2 dry-run]
    it("should_list_all_steps_as_skipped_in_dry_run_without_calling_handlers", async () => {
      const handler = vi.fn(async () => "output");
      const handlers: StepHandlerMap = new Map([
        ["step-a", handler],
        ["step-b", handler],
        ["step-c", handler],
      ]);

      const executor = new FlowExecutor(TWO_STEP_FLOW);
      const results = await executor.execute({ dryRun: true }, handlers);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "skipped")).toBe(true);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("execute — failure handling", () => {
    it("should_stop_execution_when_a_step_fails", async () => {
      const handlers: StepHandlerMap = new Map([
        ["step-a", async () => { throw new Error("step-a failed"); }],
        ["step-b", vi.fn(async () => "b")],
      ]);

      const executor = new FlowExecutor(TWO_STEP_FLOW);
      const results = await executor.execute({}, handlers);

      expect(results[0].status).toBe("failed");
      expect(results[0].error).toContain("step-a failed");
      // step-b depends on step-a, so it won't even be reached
      expect(results.find((r) => r.stepId === "step-b")).toBeUndefined();
    });
  });
});
