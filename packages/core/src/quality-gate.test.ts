import { describe, it, expect, vi } from "vitest";
import { runQualityGate, type ShellExecutor } from "./quality-gate.js";
import type { QualityConfig, Task } from "./types.js";

const baseTask: Task = {
  id: "T-001",
  title: "Test task",
  spec: "Do something",
  verify_command: "pnpm test",
};

const baseQuality: QualityConfig = {
  verify: true,
  judge_policy: "never",
  max_retries: 0,
  max_retry_budget_usd: 0,
};

/** 建立 mock shell executor */
function mockShell(results: Record<string, number>): ShellExecutor {
  return vi.fn(async (command: string) => {
    const exitCode = results[command] ?? 0;
    return {
      exitCode,
      stdout: exitCode === 0 ? "ok" : "",
      stderr: exitCode !== 0 ? `Error running: ${command}` : "",
    };
  });
}

describe("runQualityGate", () => {
  it("verify_command 通過 → passed", async () => {
    const shell = mockShell({ "pnpm test": 0 });
    const result = await runQualityGate(baseTask, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("verify");
    expect(result.steps[0].passed).toBe(true);
  });

  it("verify_command 失敗 → failed + feedback", async () => {
    const shell = mockShell({ "pnpm test": 1 });
    const result = await runQualityGate(baseTask, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.feedback).toContain("verify");
    expect(result.feedback).toContain("pnpm test");
  });

  it("verify 通過但 lint 失敗 → 只執行到 lint", async () => {
    const shell = mockShell({ "pnpm test": 0, "eslint .": 1 });
    const qc: QualityConfig = { ...baseQuality, lint_command: "eslint ." };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].passed).toBe(true);
    expect(result.steps[1].name).toBe("lint");
    expect(result.steps[1].passed).toBe(false);
  });

  it("三個步驟全部通過", async () => {
    const shell = mockShell({ "pnpm test": 0, "eslint .": 0, "tsc --noEmit": 0 });
    const qc: QualityConfig = {
      ...baseQuality,
      lint_command: "eslint .",
      type_check_command: "tsc --noEmit",
    };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.passed)).toBe(true);
  });

  it("verify=false → 跳過 verify_command", async () => {
    const shell = mockShell({});
    const qc: QualityConfig = { ...baseQuality, verify: false };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(0);
    expect(shell).not.toHaveBeenCalled();
  });

  it("task 無 verify_command 但 verify=true → 跳過 verify 步驟", async () => {
    const shell = mockShell({});
    const taskNoVerify: Task = { id: "T-001", title: "X", spec: "x" };
    const result = await runQualityGate(taskNoVerify, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(0);
  });

  it("shell executor 拋出例外 → 步驟 failed", async () => {
    const shell: ShellExecutor = vi.fn(async () => {
      throw new Error("network timeout");
    });
    const result = await runQualityGate(baseTask, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.steps[0].passed).toBe(false);
    expect(result.steps[0].output).toContain("network timeout");
  });
});
