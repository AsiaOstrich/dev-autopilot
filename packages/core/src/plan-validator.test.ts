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

  describe("system level 驗證", () => {
    it("應接受含 system level 的 test_levels", () => {
      const result = validatePlan({
        project: "test",
        tasks: [
          {
            id: "T-001",
            title: "A",
            spec: "X",
            test_levels: [
              { name: "unit", command: "pnpm test:unit" },
              { name: "system", command: "pnpm test:system" },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it("應接受 defaults 中含 system level 的 test_levels", () => {
      const result = validatePlan({
        project: "test",
        defaults: {
          test_levels: [
            { name: "unit", command: "pnpm test:unit" },
            { name: "system", command: "pnpm test:system" },
          ],
        },
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it("應接受含 4 層完整 test_levels", () => {
      const result = validatePlan({
        project: "test",
        tasks: [
          {
            id: "T-001",
            title: "A",
            spec: "X",
            test_levels: [
              { name: "unit", command: "pnpm test:unit" },
              { name: "integration", command: "pnpm test:integration" },
              { name: "system", command: "pnpm test:system" },
              { name: "e2e", command: "pnpm test:e2e" },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("test_policy schema 驗證", () => {
    it("應接受含 test_policy 的 plan", () => {
      const result = validatePlan({
        project: "test",
        test_policy: {
          pyramid_ratio: { unit: 70, integration: 20, system: 7, e2e: 3 },
          static_analysis_command: "semgrep --config auto .",
          completion_criteria: [
            { name: "docs_check", command: "check-docs", required: true },
            { name: "judge_review", required: false },
          ],
        },
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it("應接受無 test_policy 的 plan（向後相容）", () => {
      const result = validatePlan({
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });
});

// ============================================================
// DEC-011: Stigmergic Coordination — ActivationPredicate 驗證
// [Source] specs/DEC-011-stigmergic-coordination.md
// ============================================================

describe("DEC-011: ActivationPredicate 驗證", () => {
  /** 建立含 activationPredicate 的 plan */
  function planWithPredicate(
    predicate: Record<string, unknown>,
    extraTasks?: Array<Record<string, unknown>>,
  ) {
    return {
      project: "test",
      tasks: [
        ...(extraTasks ?? [{ id: "T-001", title: "Pre", spec: "prerequisite" }]),
        {
          id: "T-002",
          title: "Conditional",
          spec: "conditional task",
          depends_on: ["T-001"],
          activationPredicate: predicate,
        },
      ],
    };
  }

  describe("[AC-011-006] JSON Schema 驗證 activationPredicate 結構", () => {
    it("[Source] 應接受合法的 threshold predicate", () => {
      const result = validatePlan(planWithPredicate({
        type: "threshold",
        metric: "fail_rate",
        operator: ">",
        value: 0.3,
        description: "失敗率超過 30%",
      }));
      expect(result.valid).toBe(true);
    });

    it("[Source] 應接受合法的 state_flag predicate", () => {
      const result = validatePlan(planWithPredicate({
        type: "state_flag",
        taskId: "T-001",
        expectedStatus: "failed",
        description: "T-001 失敗時觸發",
      }));
      expect(result.valid).toBe(true);
    });

    it("[Source] 應接受合法的 custom predicate", () => {
      const result = validatePlan(planWithPredicate({
        type: "custom",
        command: "test -f coverage.json",
        description: "coverage 存在",
      }));
      expect(result.valid).toBe(true);
    });

    it("[Source] 應拒絕無效的 type 值", () => {
      const result = validatePlan(planWithPredicate({
        type: "invalid_type",
        description: "無效類型",
      }));
      expect(result.valid).toBe(false);
    });

    it("[Source] 應拒絕無效的 operator 值", () => {
      const result = validatePlan(planWithPredicate({
        type: "threshold",
        metric: "fail_rate",
        operator: "!=",
        value: 0.3,
        description: "無效運算子",
      }));
      expect(result.valid).toBe(false);
    });

    it("[Source] 應拒絕缺少 description 的 predicate", () => {
      const result = validatePlan(planWithPredicate({
        type: "threshold",
        metric: "fail_rate",
        operator: ">",
        value: 0.3,
      }));
      expect(result.valid).toBe(false);
    });
  });

  describe("[AC-011-003] threshold 類型語義驗證", () => {
    it("[Source] 缺少 operator 和 value 時驗證失敗", () => {
      const result = validatePlan(planWithPredicate({
        type: "threshold",
        metric: "fail_rate",
        description: "缺少 operator/value",
      }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("threshold") || e.includes("operator") || e.includes("value"))).toBe(true);
    });

    it("[Source] 缺少 metric 時驗證失敗", () => {
      const result = validatePlan(planWithPredicate({
        type: "threshold",
        operator: ">",
        value: 0.3,
        description: "缺少 metric",
      }));
      expect(result.valid).toBe(false);
    });

    it("[Source] 三欄位齊全時驗證通過", () => {
      const result = validatePlan(planWithPredicate({
        type: "threshold",
        metric: "fail_rate",
        operator: ">",
        value: 0.3,
        description: "失敗率超過 30%",
      }));
      expect(result.valid).toBe(true);
    });
  });

  describe("[AC-011-004] state_flag 類型語義驗證", () => {
    it("[Source] 引用不存在的 taskId 時驗證失敗", () => {
      const result = validatePlan(planWithPredicate({
        type: "state_flag",
        taskId: "T-999",
        expectedStatus: "failed",
        description: "T-999 不存在",
      }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("T-999"))).toBe(true);
    });

    it("[Source] 引用有效 taskId 時驗證通過", () => {
      const result = validatePlan(planWithPredicate({
        type: "state_flag",
        taskId: "T-001",
        expectedStatus: "failed",
        description: "T-001 失敗時觸發",
      }));
      expect(result.valid).toBe(true);
    });

    it("[Derived] 缺少 taskId 時驗證失敗", () => {
      const result = validatePlan(planWithPredicate({
        type: "state_flag",
        expectedStatus: "failed",
        description: "缺少 taskId",
      }));
      expect(result.valid).toBe(false);
    });
  });

  describe("[AC-011-005] custom 類型語義驗證", () => {
    it("[Source] 含危險指令時驗證失敗", () => {
      const result = validatePlan(planWithPredicate({
        type: "custom",
        command: "rm -rf /",
        description: "危險指令",
      }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("危險"))).toBe(true);
    });

    it("[Source] 安全指令驗證通過", () => {
      const result = validatePlan(planWithPredicate({
        type: "custom",
        command: "test -f coverage.json",
        description: "coverage 存在",
      }));
      expect(result.valid).toBe(true);
    });

    it("[Derived] 缺少 command 時驗證失敗", () => {
      const result = validatePlan(planWithPredicate({
        type: "custom",
        description: "缺少 command",
      }));
      expect(result.valid).toBe(false);
    });
  });

  describe("[AC-011-010] 向後相容", () => {
    it("[Source] 無 activationPredicate 的 plan 驗證不受影響", () => {
      const result = validatePlan({
        project: "test",
        tasks: [
          { id: "T-001", title: "A", spec: "X" },
          { id: "T-002", title: "B", spec: "Y", depends_on: ["T-001"] },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("[AC-011-013] 既有測試零回歸", () => {
    it("[Derived] 既有最小 plan 仍通過", () => {
      const result = validatePlan(validPlan);
      expect(result.valid).toBe(true);
    });

    it("[Derived] 既有含依賴 plan 仍通過", () => {
      const result = validatePlan(validPlanWithDeps);
      expect(result.valid).toBe(true);
    });
  });
});
