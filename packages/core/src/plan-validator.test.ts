import { describe, it, expect } from "vitest";
import { validatePlan } from "./plan-validator.js";

/** 有效的最小 plan */
const validPlan = {
  project: "test-project",
  tasks: [
    { id: "T-001", title: "Task 1", spec: "Do something" },
  ],
};

/** 有依賴的有效 plan */
const validPlanWithDeps = {
  project: "test-project",
  agent: "claude",
  defaults: { max_turns: 30, max_budget_usd: 2.0 },
  tasks: [
    { id: "T-001", title: "Init", spec: "Initialize project", depends_on: [] },
    { id: "T-002", title: "Build", spec: "Build project", depends_on: ["T-001"] },
    { id: "T-003", title: "Test", spec: "Run tests", depends_on: ["T-002"] },
  ],
};

describe("validatePlan", () => {
  describe("有效的 plan", () => {
    it("應接受最小有效 plan", () => {
      const result = validatePlan(validPlan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("應接受含依賴的有效 plan", () => {
      const result = validatePlan(validPlanWithDeps);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("應接受含完整欄位的 plan", () => {
      const result = validatePlan({
        project: "full-project",
        session_id: "sess-123",
        agent: "opencode",
        defaults: {
          max_turns: 50,
          max_budget_usd: 5.0,
          allowed_tools: ["Read", "Write"],
          verify_command: "pnpm test",
        },
        tasks: [
          {
            id: "T-001",
            title: "Task 1",
            spec: "Full spec",
            depends_on: [],
            agent: "claude",
            verify_command: "pnpm build",
            max_turns: 10,
            max_budget_usd: 1.0,
            allowed_tools: ["Read"],
            fork_session: true,
          },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("Schema 驗證失敗", () => {
    it("應拒絕空物件", () => {
      const result = validatePlan({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("應拒絕缺少 project 的 plan", () => {
      const result = validatePlan({ tasks: [{ id: "T-001", title: "X", spec: "Y" }] });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("project"))).toBe(true);
    });

    it("應拒絕缺少 tasks 的 plan", () => {
      const result = validatePlan({ project: "test" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("tasks"))).toBe(true);
    });

    it("應拒絕空 tasks 陣列", () => {
      const result = validatePlan({ project: "test", tasks: [] });
      expect(result.valid).toBe(false);
    });

    it("應拒絕無效 Task ID 格式", () => {
      const result = validatePlan({
        project: "test",
        tasks: [{ id: "invalid", title: "X", spec: "Y" }],
      });
      expect(result.valid).toBe(false);
    });

    it("應拒絕缺少必填欄位的 task", () => {
      const result = validatePlan({
        project: "test",
        tasks: [{ id: "T-001" }],
      });
      expect(result.valid).toBe(false);
    });

    it("應拒絕無效的 agent 值", () => {
      const result = validatePlan({
        project: "test",
        agent: "invalid-agent",
        tasks: [{ id: "T-001", title: "X", spec: "Y" }],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("邏輯驗證", () => {
    it("應拒絕重複的 Task ID", () => {
      const result = validatePlan({
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
          { id: "T-001", title: "B", spec: "Y" },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("重複"))).toBe(true);
    });

    it("應拒絕參照不存在的依賴", () => {
      const result = validatePlan({
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X", depends_on: ["T-999"] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("不存在"))).toBe(true);
    });

    it("應拒絕有循環依賴的 plan", () => {
      const result = validatePlan({
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X", depends_on: ["T-002"] },
          { id: "T-002", title: "B", spec: "Y", depends_on: ["T-001"] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("循環"))).toBe(true);
    });

    it("應拒絕自我依賴", () => {
      const result = validatePlan({
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X", depends_on: ["T-001"] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("循環"))).toBe(true);
    });
  });
});
