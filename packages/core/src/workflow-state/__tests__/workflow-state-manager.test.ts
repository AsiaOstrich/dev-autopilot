import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkflowStateManager, type WorkflowState } from "../workflow-state-manager.js";

let devapDir: string;
let manager: WorkflowStateManager;

beforeEach(async () => {
  devapDir = await mkdtemp(join(tmpdir(), "wf-state-test-"));
  manager = new WorkflowStateManager(devapDir);
});

afterEach(async () => {
  await rm(devapDir, { recursive: true, force: true });
});

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    flowName: "test-flow",
    flowFile: ".devap/flows/test-flow.flow.yaml",
    status: "IN_PROGRESS",
    completedSteps: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    results: [],
    ...overrides,
  };
}

describe("WorkflowStateManager", () => {
  it("load returns null for non-existent flow", async () => {
    const result = await manager.load("nonexistent");
    expect(result).toBeNull();
  });

  it("save then load roundtrip preserves state", async () => {
    const state = makeState({ flowName: "my-flow", status: "IN_PROGRESS" });
    await manager.save("my-flow", state);
    const loaded = await manager.load("my-flow");
    expect(loaded).toBeDefined();
    expect(loaded?.flowName).toBe("my-flow");
    expect(loaded?.status).toBe("IN_PROGRESS");
  });

  it("save overwrites existing state", async () => {
    await manager.save("my-flow", makeState({ status: "IN_PROGRESS" }));
    await manager.save("my-flow", makeState({ status: "COMPLETED" }));
    const loaded = await manager.load("my-flow");
    expect(loaded?.status).toBe("COMPLETED");
  });

  it("saves completedSteps list correctly", async () => {
    const state = makeState({ completedSteps: ["step-a", "step-b"] });
    await manager.save("my-flow", state);
    const loaded = await manager.load("my-flow");
    expect(loaded?.completedSteps).toEqual(["step-a", "step-b"]);
  });

  it("list returns empty array when no states exist", async () => {
    const list = await manager.list();
    expect(list).toEqual([]);
  });

  it("list returns all saved states sorted by updatedAt desc", async () => {
    await manager.save("flow-a", makeState({ flowName: "flow-a", updatedAt: "2026-01-01T00:00:00.000Z" }));
    await manager.save("flow-b", makeState({ flowName: "flow-b", updatedAt: "2026-01-02T00:00:00.000Z" }));
    const list = await manager.list();
    expect(list).toHaveLength(2);
    expect(list[0].flowName).toBe("flow-b");
    expect(list[1].flowName).toBe("flow-a");
  });

  it("clear removes the state file", async () => {
    await manager.save("my-flow", makeState());
    await manager.clear("my-flow");
    const loaded = await manager.load("my-flow");
    expect(loaded).toBeNull();
  });

  it("clear is idempotent when file does not exist", async () => {
    await expect(manager.clear("nonexistent")).resolves.not.toThrow();
  });

  it("handles flow names with special characters safely", async () => {
    const state = makeState({ flowName: "my flow/v2" });
    await manager.save("my flow/v2", state);
    const loaded = await manager.load("my flow/v2");
    expect(loaded?.flowName).toBe("my flow/v2");
  });

  it("saves and loads results array", async () => {
    const results = [
      { stepId: "step-1", status: "completed" as const, output: "ok", doneAt: new Date().toISOString() },
      { stepId: "step-2", status: "failed" as const, error: "err" },
    ];
    await manager.save("flow-x", makeState({ results }));
    const loaded = await manager.load("flow-x");
    expect(loaded?.results).toHaveLength(2);
    expect(loaded?.results[0].stepId).toBe("step-1");
    expect(loaded?.results[1].error).toBe("err");
  });
});
