/**
 * Recovery Recipe Registry（XSPEC-046）
 *
 * 統一管理恢復食譜，根據 failureSource 精準匹配恢復策略。
 * 借鑑：ultraworkers/claw-code ROADMAP Phase 3 Recovery Recipes（DEC-035）
 */

import type { FailureSource, RecoveryRecipe } from "./types.js";

/** 5 個預設恢復食譜 */
export const DEFAULT_RECIPES: ReadonlyArray<RecoveryRecipe> = [
  {
    id: "RR-001",
    name: "Fix Loop for Compilation Errors",
    match: { failureSource: "compilation" },
    strategy: "fix_loop",
    config: { max_attempts: 3, budget_usd: 0.5 },
    escalation: { onExhaust: "human_checkpoint" },
  },
  {
    id: "RR-002",
    name: "Fix Loop for Test Failures",
    match: { failureSource: "test_failure" },
    strategy: "fix_loop",
    config: { max_attempts: 3, budget_usd: 0.5 },
    escalation: { onExhaust: "human_checkpoint" },
  },
  {
    id: "RR-003",
    name: "Model Switch for Degradation",
    match: { failureSource: "model_degradation" },
    strategy: "model_switch",
    config: { max_attempts: 2 },
    escalation: { onExhaust: "degraded_mode" },
  },
  {
    id: "RR-004",
    name: "Rebase for Branch Divergence",
    match: { failureSource: "branch_divergence" },
    strategy: "rebase_and_retry",
    config: { max_attempts: 1 },
    escalation: {
      onExhaust: "human_checkpoint",
      message: "Rebase 衝突，需人工解決",
    },
  },
  {
    id: "RR-005",
    name: "Degraded Mode for Resource Exhaustion",
    match: { failureSource: "resource_exhaustion" },
    strategy: "degraded_mode",
    escalation: { onExhaust: "human_checkpoint" },
  },
];

export class RecoveryRegistry {
  private readonly recipes: RecoveryRecipe[];

  constructor(recipes: ReadonlyArray<RecoveryRecipe> = DEFAULT_RECIPES) {
    this.recipes = [...recipes];
  }

  /**
   * 根據 failureSource（和可選的 severity）找到匹配的恢復食譜。
   * 返回第一個匹配的 recipe；無匹配時返回 null（fallback 到現有行為）。
   */
  findRecipe(params: {
    failureSource: FailureSource;
    severity?: string;
  }): RecoveryRecipe | null {
    return (
      this.recipes.find((recipe) => {
        if (recipe.match.failureSource !== params.failureSource) return false;
        if (!recipe.match.severity || recipe.match.severity.length === 0) return true;
        return params.severity
          ? recipe.match.severity.includes(params.severity as never)
          : true;
      }) ?? null
    );
  }

  /** 新增自訂 recipe（使用者配置，優先於預設） */
  register(recipe: RecoveryRecipe): void {
    this.recipes.unshift(recipe); // 使用者 recipe 放前面，優先匹配
  }
}
