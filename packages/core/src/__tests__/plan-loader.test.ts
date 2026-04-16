/**
 * XSPEC-057: Plan Loader 測試
 *
 * 涵蓋：
 * - 單計劃格式（向後相容）
 * - 多計劃格式 + --plan 選擇
 * - default_plan 自動選用
 * - 多計劃無 default_plan 時報錯
 * - 計劃名稱不存在時報錯
 * - defaults 合併規則
 * - isMultiPlanFile() 型別守衛
 * - listPlans() 回傳資訊
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dump as toYaml } from "js-yaml";
import {
  loadPlan,
  listPlans,
  PlanNotFoundError,
  MultiPlanFileRequiresPlanFlagError,
} from "../plan-loader.js";
import { isMultiPlanFile } from "../types.js";
import type { TaskPlan, MultiPlanFile } from "../types.js";

const TEST_DIR = join(tmpdir(), `devap-plan-loader-test-${Date.now()}`);

function makeSinglePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    project: "test-project",
    tasks: [{ id: "t1", title: "Task 1", spec: "do something" }],
    ...overrides,
  };
}

function makeMultiPlan(overrides?: Partial<MultiPlanFile>): MultiPlanFile {
  return {
    default_plan: "dev",
    plans: {
      dev: makeSinglePlan({ quality: "standard" }),
      ci: makeSinglePlan({
        quality: "strict",
        tasks: [
          { id: "t1", title: "Task 1", spec: "do something" },
          { id: "t2", title: "Task 2", spec: "do another", depends_on: ["t1"] },
        ],
      }),
      staging: makeSinglePlan({ quality: "standard" }),
    },
    ...overrides,
  };
}

async function writeJson(name: string, data: unknown): Promise<string> {
  const p = join(TEST_DIR, name);
  await writeFile(p, JSON.stringify(data));
  return p;
}

async function writeYaml(name: string, data: unknown): Promise<string> {
  const p = join(TEST_DIR, name);
  await writeFile(p, toYaml(data));
  return p;
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ─── isMultiPlanFile() ────────────────────────────────────────────────────────

describe("isMultiPlanFile()", () => {
  it("單計劃格式回傳 false", () => {
    expect(isMultiPlanFile(makeSinglePlan())).toBe(false);
  });

  it("多計劃格式回傳 true", () => {
    expect(isMultiPlanFile(makeMultiPlan())).toBe(true);
  });
});

// ─── loadPlan() — 單計劃 ─────────────────────────────────────────────────────

describe("loadPlan() — 單計劃格式", () => {
  it("AC-057-001: 讀取 JSON，行為與現有版本相同", async () => {
    const plan = makeSinglePlan();
    const p = await writeJson("single.json", plan);
    const { plan: loaded, planName } = await loadPlan(p);
    expect(loaded.project).toBe("test-project");
    expect(planName).toBeUndefined();
  });

  it("讀取 YAML 單計劃格式", async () => {
    const plan = makeSinglePlan();
    const p = await writeYaml("single.yaml", plan);
    const { plan: loaded, planName } = await loadPlan(p);
    expect(loaded.project).toBe("test-project");
    expect(planName).toBeUndefined();
  });

  it("AC-057-001: --plan 旗標對單計劃格式無影響", async () => {
    const plan = makeSinglePlan();
    const p = await writeJson("single.json", plan);
    const { plan: loaded, planName } = await loadPlan(p, "anything");
    expect(loaded.project).toBe("test-project");
    expect(planName).toBeUndefined();
  });
});

// ─── loadPlan() — 多計劃 ─────────────────────────────────────────────────────

describe("loadPlan() — 多計劃格式", () => {
  it("AC-057-002: --plan ci 選擇 plans.ci", async () => {
    const p = await writeYaml("multi.yaml", makeMultiPlan());
    const { plan, planName } = await loadPlan(p, "ci");
    expect(planName).toBe("ci");
    expect(plan.tasks.length).toBe(2);
    expect(plan.quality).toBe("strict");
  });

  it("AC-057-004: default_plan 自動選用", async () => {
    const p = await writeYaml("multi.yaml", makeMultiPlan({ default_plan: "staging" }));
    const { plan, planName } = await loadPlan(p);
    expect(planName).toBe("staging");
    expect(plan.quality).toBe("standard");
  });

  it("AC-057-005: 多計劃無 default_plan 且無 --plan 拋出錯誤", async () => {
    const multi = makeMultiPlan();
    delete multi.default_plan;
    const p = await writeYaml("multi.yaml", multi);
    await expect(loadPlan(p)).rejects.toBeInstanceOf(MultiPlanFileRequiresPlanFlagError);
  });

  it("AC-057-006: 計劃名稱不存在拋出 PlanNotFoundError", async () => {
    const p = await writeYaml("multi.yaml", makeMultiPlan());
    const err = await loadPlan(p, "nonexistent").catch((e) => e);
    expect(err).toBeInstanceOf(PlanNotFoundError);
    expect((err as PlanNotFoundError).availablePlans).toContain("dev");
    expect((err as PlanNotFoundError).availablePlans).toContain("ci");
  });

  it("AC-057-003: defaults 被正確合併（plan 設定優先）", async () => {
    const multi: MultiPlanFile = {
      defaults: { quality: "minimal", max_parallel: 1 },
      plans: {
        overrider: makeSinglePlan({ quality: "strict" }),
        inheritor: makeSinglePlan(),
      },
    };
    const p = await writeYaml("multi.yaml", multi);

    // overrider 的 quality 覆蓋 defaults
    const { plan: over } = await loadPlan(p, "overrider");
    expect(over.quality).toBe("strict");
    expect(over.max_parallel).toBe(1);   // 繼承 defaults

    // inheritor 完全繼承 defaults
    const { plan: inh } = await loadPlan(p, "inheritor");
    expect(inh.quality).toBe("minimal");
  });

  it("AC-057-008: planName 記錄在回傳值中", async () => {
    const p = await writeYaml("multi.yaml", makeMultiPlan());
    const { planName } = await loadPlan(p, "dev");
    expect(planName).toBe("dev");
  });
});

// ─── listPlans() ──────────────────────────────────────────────────────────────

describe("listPlans()", () => {
  it("AC-057-007: 單計劃格式回傳 null", async () => {
    const p = await writeJson("single.json", makeSinglePlan());
    const result = await listPlans(p);
    expect(result).toBeNull();
  });

  it("AC-057-007: 多計劃格式回傳計劃清單", async () => {
    const p = await writeYaml("multi.yaml", makeMultiPlan());
    const plans = await listPlans(p);
    expect(plans).not.toBeNull();
    const names = plans!.map((pl) => pl.name);
    expect(names).toContain("dev");
    expect(names).toContain("ci");
    expect(names).toContain("staging");
  });

  it("isDefault 欄位正確標示預設計劃", async () => {
    const p = await writeYaml("multi.yaml", makeMultiPlan({ default_plan: "ci" }));
    const plans = await listPlans(p);
    const ci = plans!.find((pl) => pl.name === "ci");
    const dev = plans!.find((pl) => pl.name === "dev");
    expect(ci!.isDefault).toBe(true);
    expect(dev!.isDefault).toBe(false);
  });

  it("taskCount 回傳正確任務數", async () => {
    const p = await writeYaml("multi.yaml", makeMultiPlan());
    const plans = await listPlans(p);
    const ci = plans!.find((pl) => pl.name === "ci");
    expect(ci!.taskCount).toBe(2);
  });
});

// ─── AC-057-009: isMultiPlanFile() 型別守衛 ──────────────────────────────────

describe("AC-057-009: isMultiPlanFile() 型別守衛", () => {
  it("有 plans 鍵時回傳 true", () => {
    expect(isMultiPlanFile({ plans: {} })).toBe(true);
  });

  it("無 plans 鍵時回傳 false", () => {
    expect(isMultiPlanFile(makeSinglePlan())).toBe(false);
  });
});
