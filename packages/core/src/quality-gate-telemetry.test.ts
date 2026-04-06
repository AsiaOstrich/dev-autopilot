/**
 * SPEC-009 AC-6: Quality Gate Hook Telemetry 去重 — TDD 骨架
 *
 * [Generated] 由 /derive tdd 從 SPEC-009 AC-6 推演
 * Source: specs/SPEC-009-harness-hooks-injection.md
 *
 * 測試 runQualityGate() 的 hookTelemetry 去重行為。
 */

import { describe, it, expect, vi } from "vitest";
import { runQualityGate, type ShellExecutor } from "./quality-gate.js";
import type { QualityConfig, Task } from "./types.js";

const baseTask: Task = {
  id: "T-001",
  title: "Test task",
  spec: "Do something",
  verify_command: "pnpm test",
};

const qualityWithLint: QualityConfig = {
  verify: true,
  lint_command: "eslint .",
  judge_policy: "never",
  max_retries: 0,
  max_retry_budget_usd: 0,
};

const qualityWithLintAndTypeCheck: QualityConfig = {
  verify: true,
  lint_command: "eslint .",
  type_check_command: "tsc --noEmit",
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

describe("SPEC-009 AC-6: Quality Gate Hook Telemetry 去重", () => {
  // ==========================================================
  // AC-6: hookTelemetry.lint_passed 為 true → 跳過 lint
  // ==========================================================

  it("[AC-6] hookTelemetry.lint_passed 為 true 時應跳過 lint 步驟", async () => {
    // [Derived] AC-6: hook 已成功執行 lint → QualityGate 跳過
    // [TODO] 待 QualityGateOptions 新增 hookTelemetry 後啟用
    const shell = mockShell({ "pnpm test": 0, "eslint .": 0 });
    const result = await runQualityGate(baseTask, qualityWithLint, {
      cwd: "/tmp",
      shellExecutor: shell,
      hookTelemetry: { lint_passed: true },
    });

    expect(result.passed).toBe(true);
    // lint 步驟應被跳過
    const lintStep = result.steps.find(s => s.name === "lint");
    expect(lintStep).toBeDefined();
    expect(lintStep!.passed).toBe(true);
    expect(lintStep!.output).toContain("Skipped");
    // shell 不應被呼叫執行 lint
    expect(shell).not.toHaveBeenCalledWith("eslint .", expect.anything());
  });

  // ==========================================================
  // AC-6: 無 hookTelemetry → 正常執行
  // ==========================================================

  it("[AC-6] 無 hookTelemetry 時應正常執行 lint 指令", async () => {
    // [Derived] AC-6: 無 telemetry → 既有行為不變
    const shell = mockShell({ "pnpm test": 0, "eslint .": 0 });
    const result = await runQualityGate(baseTask, qualityWithLint, {
      cwd: "/tmp",
      shellExecutor: shell,
      // 不傳 hookTelemetry
    });

    expect(result.passed).toBe(true);
    expect(shell).toHaveBeenCalledWith("eslint .", "/tmp");
  });

  // ==========================================================
  // AC-6: hookTelemetry.lint_passed 為 false → 仍執行
  // ==========================================================

  it("[AC-6] hookTelemetry.lint_passed 為 false 時應仍執行 lint 指令", async () => {
    // [Derived] AC-6: hook 報告 lint 失敗 → 不信任修復結果，重新驗證
    const shell = mockShell({ "pnpm test": 0, "eslint .": 0 });
    const result = await runQualityGate(baseTask, qualityWithLint, {
      cwd: "/tmp",
      shellExecutor: shell,
      hookTelemetry: { lint_passed: false },
    });

    expect(result.passed).toBe(true);
    // lint 應被實際執行（不跳過）
    expect(shell).toHaveBeenCalledWith("eslint .", "/tmp");
  });

  // ==========================================================
  // AC-6: hookTelemetry.type_check_passed → 跳過 type_check
  // ==========================================================

  it("[AC-6] hookTelemetry.type_check_passed 為 true 時應跳過 type_check 步驟", async () => {
    // [Derived] AC-6: hook 已成功執行 type-check → QualityGate 跳過
    // [TODO] 待 QualityGateOptions 新增 hookTelemetry 後啟用
    const shell = mockShell({ "pnpm test": 0, "eslint .": 0, "tsc --noEmit": 0 });
    const result = await runQualityGate(baseTask, qualityWithLintAndTypeCheck, {
      cwd: "/tmp",
      shellExecutor: shell,
      hookTelemetry: { type_check_passed: true },
    });

    expect(result.passed).toBe(true);
    // type_check 步驟應被跳過
    const tcStep = result.steps.find(s => s.name === "type_check");
    expect(tcStep).toBeDefined();
    expect(tcStep!.passed).toBe(true);
    expect(tcStep!.output).toContain("Skipped");
    // lint 應正常執行（telemetry 未涵蓋 lint）
    expect(shell).toHaveBeenCalledWith("eslint .", "/tmp");
    // type_check 不應被呼叫
    expect(shell).not.toHaveBeenCalledWith("tsc --noEmit", expect.anything());
  });

  // ==========================================================
  // AC-6: 兩者都 passed → 都跳過
  // ==========================================================

  it("[AC-6] hookTelemetry lint 和 type_check 都 passed 時應都跳過", async () => {
    // [Derived] AC-6: 完整 telemetry → 跳過所有重複步驟
    const shell = mockShell({ "pnpm test": 0 });
    const result = await runQualityGate(baseTask, qualityWithLintAndTypeCheck, {
      cwd: "/tmp",
      shellExecutor: shell,
      hookTelemetry: { lint_passed: true, type_check_passed: true },
    });

    expect(result.passed).toBe(true);
    // verify 應正常執行
    expect(shell).toHaveBeenCalledWith("pnpm test", "/tmp");
    // lint 和 type_check 都應被跳過
    expect(shell).toHaveBeenCalledTimes(1); // 只有 verify
    const lintStep = result.steps.find(s => s.name === "lint");
    const tcStep = result.steps.find(s => s.name === "type_check");
    expect(lintStep!.output).toContain("Skipped");
    expect(tcStep!.output).toContain("Skipped");
  });
});
