import { describe, it, expect, vi } from "vitest";
import { ResultMerger, type AgentTaskResult } from "../result-merger.js";

// Mock hitl-gate — always confirm by default
let mockHITLDecision = "confirmed";
vi.mock("../hitl-gate.js", () => ({
  runHITLGate: vi.fn(async () => ({
    decision: mockHITLDecision,
    auditRecord: {},
  })),
}));

function makeResult(overrides: Partial<AgentTaskResult> = {}): AgentTaskResult {
  return {
    agentId: "agent-A",
    taskId: "T-001",
    success: true,
    completedAt: new Date("2026-04-28T10:00:00Z"),
    branch: "autopilot/T-001",
    ...overrides,
  };
}

function makeShell(exitCode = 0) {
  return vi.fn(async (_cmd: string) => ({
    exitCode,
    stdout: exitCode === 0 ? "Merge complete" : "",
    stderr: exitCode !== 0 ? "CONFLICT: both modified src/auth.ts" : "",
  }));
}

describe("ResultMerger — AC-7: 結果合併協調", () => {
  it("無衝突時依完成時間順序合併所有 Agent", async () => {
    const shell = makeShell(0);
    const merger = new ResultMerger({ shellExecutor: shell });

    const results = [
      makeResult({ agentId: "agent-B", completedAt: new Date("2026-04-28T10:05:00Z"), branch: "autopilot/T-002" }),
      makeResult({ agentId: "agent-A", completedAt: new Date("2026-04-28T10:00:00Z"), branch: "autopilot/T-001" }),
    ];

    const result = await merger.merge(results);
    expect(result.success).toBe(true);
    expect(result.hitlTriggered).toBe(false);
    // agent-A first (earlier completedAt), then agent-B
    expect(result.mergedAgents).toEqual(["agent-A", "agent-B"]);
  });

  it("AC-7: 合併衝突時觸發 HITL", async () => {
    const shell = makeShell(1); // simulate conflict
    const merger = new ResultMerger({ shellExecutor: shell });

    const result = await merger.merge([makeResult()]);
    expect(result.success).toBe(false);
    expect(result.hitlTriggered).toBe(true);
    expect(result.failedAgent).toBe("agent-A");
    expect(result.error).toContain("autopilot/T-001");
  });

  it("AC-7: 衝突後回退 merge --abort", async () => {
    const shell = makeShell(1);
    const merger = new ResultMerger({ shellExecutor: shell });

    await merger.merge([makeResult()]);
    // Should have called "git merge --abort"
    const calls = shell.mock.calls.map((c) => c[0]);
    expect(calls.some((cmd) => (cmd as string).includes("--abort"))).toBe(true);
  });

  it("success=false 的 Agent 不參與合併", async () => {
    const shell = makeShell(0);
    const merger = new ResultMerger({ shellExecutor: shell });

    const results = [
      makeResult({ agentId: "agent-A", success: false }),
      makeResult({ agentId: "agent-B", branch: "autopilot/T-002" }),
    ];

    const result = await merger.merge(results);
    expect(result.success).toBe(true);
    expect(result.mergedAgents).toEqual(["agent-B"]);
    expect(shell).toHaveBeenCalledTimes(1); // only agent-B
  });

  it("branch 未設定的 Agent 不參與合併", async () => {
    const shell = makeShell(0);
    const merger = new ResultMerger({ shellExecutor: shell });

    const results = [makeResult({ branch: undefined })];
    const result = await merger.merge(results);
    expect(result.success).toBe(true);
    expect(result.mergedAgents).toEqual([]);
    expect(shell).not.toHaveBeenCalled();
  });

  it("空列表回傳 success=true", async () => {
    const merger = new ResultMerger({ shellExecutor: makeShell(0) });
    const result = await merger.merge([]);
    expect(result.success).toBe(true);
    expect(result.mergedAgents).toEqual([]);
  });
});
