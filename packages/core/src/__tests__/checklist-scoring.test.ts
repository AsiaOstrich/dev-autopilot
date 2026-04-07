/**
 * TDD 測試 — SPEC-011 Checklist Scoring Extension
 *
 * 測試 QualityGateResult 的 score/max_score 欄位擴充。
 * 來源：SPEC-011 AC-1 ~ AC-7
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task, QualityConfig } from "../types.js";
import { runQualityGate, type QualityGateResult, type ShellExecutor } from "../quality-gate.js";

/** 建立 mock shell executor（所有指令皆通過） */
function mockShellPass(): ShellExecutor {
  return vi.fn(async () => ({
    exitCode: 0,
    stdout: "ok",
    stderr: "",
  }));
}

/** 建立 mock shell executor（指定指令失敗） */
function mockShellFail(failCommand: string): ShellExecutor {
  return vi.fn(async (command: string) => ({
    exitCode: command === failCommand ? 1 : 0,
    stdout: command === failCommand ? "" : "ok",
    stderr: command === failCommand ? "Error" : "",
  }));
}

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

describe("SPEC-011: Checklist Scoring Extension", () => {
  // ─── AC-1: QualityGateResult 介面包含 score 與 max_score ───

  describe("[AC-1] QualityGateResult 型別包含 score 與 max_score", () => {
    it("should allow QualityGateResult with score and max_score", () => {
      const result: QualityGateResult = {
        passed: true,
        steps: [],
        evidence: [],
        score: 8,
        max_score: 10,
      };
      expect(result.score).toBe(8);
      expect(result.max_score).toBe(10);
    });

    it("should allow QualityGateResult without score (backward compatible)", () => {
      const result: QualityGateResult = {
        passed: true,
        steps: [],
        evidence: [],
      };
      expect(result.score).toBeUndefined();
      expect(result.max_score).toBeUndefined();
    });
  });

  // ─── AC-2: Task 介面包含 spec_score 與 spec_max_score ───

  describe("[AC-2] Task 型別包含 spec_score 與 spec_max_score", () => {
    it("should allow Task with spec_score and spec_max_score", () => {
      const task: Task = {
        id: "T-001",
        title: "test",
        spec: "test spec",
        spec_score: 8,
        spec_max_score: 10,
      };
      expect(task.spec_score).toBe(8);
      expect(task.spec_max_score).toBe(10);
    });

    it("should allow Task without spec_score (backward compatible)", () => {
      const task: Task = {
        id: "T-001",
        title: "test",
        spec: "test spec",
      };
      expect(task.spec_score).toBeUndefined();
      expect(task.spec_max_score).toBeUndefined();
    });
  });

  // ─── AC-3: runQualityGate — spec_score 存在時傳遞 ───

  describe("[AC-3] runQualityGate — spec_score 存在時傳遞", () => {
    it("should include score when task has spec_score and spec_max_score", async () => {
      const task: Task = { ...baseTask, spec_score: 8, spec_max_score: 10 };
      const result = await runQualityGate(task, baseQuality, {
        cwd: "/tmp",
        shellExecutor: mockShellPass(),
      });
      expect(result.score).toBe(8);
      expect(result.max_score).toBe(10);
    });

    it("should infer max_score=10 when score<=10 and max not specified", async () => {
      const task: Task = { ...baseTask, spec_score: 7 };
      const result = await runQualityGate(task, baseQuality, {
        cwd: "/tmp",
        shellExecutor: mockShellPass(),
      });
      expect(result.score).toBe(7);
      expect(result.max_score).toBe(10);
    });

    it("should infer max_score=10 at boundary value score=10", async () => {
      const task: Task = { ...baseTask, spec_score: 10 };
      const result = await runQualityGate(task, baseQuality, {
        cwd: "/tmp",
        shellExecutor: mockShellPass(),
      });
      expect(result.max_score).toBe(10);
    });

    it("should infer max_score=25 when score>10", async () => {
      const task: Task = { ...baseTask, spec_score: 18 };
      const result = await runQualityGate(task, baseQuality, {
        cwd: "/tmp",
        shellExecutor: mockShellPass(),
      });
      expect(result.score).toBe(18);
      expect(result.max_score).toBe(25);
    });
  });

  // ─── AC-4: runQualityGate — 無 spec_score 時向後相容 ───

  describe("[AC-4] runQualityGate — 無 spec_score 時向後相容", () => {
    it("should not include score when task lacks spec_score", async () => {
      const result = await runQualityGate(baseTask, baseQuality, {
        cwd: "/tmp",
        shellExecutor: mockShellPass(),
      });
      expect(result.score).toBeUndefined();
      expect(result.max_score).toBeUndefined();
    });

    it("should not have score key in result object", async () => {
      const result = await runQualityGate(baseTask, baseQuality, {
        cwd: "/tmp",
        shellExecutor: mockShellPass(),
      });
      expect("score" in result).toBe(false);
      expect("max_score" in result).toBe(false);
    });
  });

  // ─── AC-5: buildFailResult — spec_score 存在時傳遞 ───

  describe("[AC-5] buildFailResult — spec_score 存在時傳遞", () => {
    it("should include score in fail result when task has spec_score", async () => {
      const task: Task = { ...baseTask, spec_score: 7, spec_max_score: 10 };
      const result = await runQualityGate(task, baseQuality, {
        cwd: "/tmp",
        shellExecutor: mockShellFail("pnpm test"),
      });
      expect(result.passed).toBe(false);
      expect(result.score).toBe(7);
      expect(result.max_score).toBe(10);
    });

    it("should not include score in fail result when task lacks spec_score", async () => {
      const result = await runQualityGate(baseTask, baseQuality, {
        cwd: "/tmp",
        shellExecutor: mockShellFail("pnpm test"),
      });
      expect(result.passed).toBe(false);
      expect("score" in result).toBe(false);
    });
  });

  // ─── AC-6: task-schema.json 包含 scoring 欄位 ───

  describe("[AC-6] task-schema.json 包含 scoring 欄位", () => {
    it("should include spec_score in task properties", () => {
      const schemaPath = join(__dirname, "../../../../specs/task-schema.json");
      const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
      const taskProps = schema.properties.tasks.items.properties;
      expect(taskProps.spec_score).toBeDefined();
      expect(taskProps.spec_score.type).toBe("number");
    });

    it("should include spec_max_score in task properties", () => {
      const schemaPath = join(__dirname, "../../../../specs/task-schema.json");
      const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
      const taskProps = schema.properties.tasks.items.properties;
      expect(taskProps.spec_max_score).toBeDefined();
      expect(taskProps.spec_max_score.type).toBe("number");
    });
  });
});
