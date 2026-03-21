/**
 * Agent 映射器
 *
 * 根據 task.spec 中的關鍵字判斷應路由到哪個 VibeOps agent。
 * 參照 SPEC-004 映射表。
 */

import type { VibeOpsAgentName } from "./types.js";

/**
 * 映射規則：關鍵字 → VibeOps agent
 *
 * 每條規則包含一組中英文關鍵字和對應的 agent。
 * 先匹配到的規則優先（順序重要）。
 */
const MAPPING_RULES: Array<{ keywords: string[]; agent: VibeOpsAgentName }> = [
  { keywords: ["需求", "prd", "requirement"], agent: "planner" },
  { keywords: ["架構", "adr", "architecture"], agent: "architect" },
  { keywords: ["規格", "設計", "design", "specification"], agent: "designer" },
  { keywords: ["ui", "視覺", "ux", "介面"], agent: "uiux" },
  { keywords: ["實作", "開發", "implement", "build", "develop"], agent: "builder" },
  { keywords: ["審查", "review", "code review"], agent: "reviewer" },
  { keywords: ["部署", "deploy", "release", "ci/cd"], agent: "operator" },
  { keywords: ["評估", "度量", "evaluate", "metric"], agent: "evaluator" },
];

/**
 * 從 task spec 推斷對應的 VibeOps agent
 *
 * @param spec - 任務規格描述
 * @returns 匹配的 VibeOps agent 名稱，預設為 "builder"
 */
export function mapSpecToAgent(spec: string): VibeOpsAgentName {
  const lower = spec.toLowerCase();

  for (const rule of MAPPING_RULES) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        return rule.agent;
      }
    }
  }

  // 預設路由到 builder（最常見的使用場景）
  return "builder";
}

/**
 * 所有支援的 VibeOps agent 名稱列表
 */
export const ALL_AGENTS: readonly VibeOpsAgentName[] = [
  "planner",
  "architect",
  "designer",
  "uiux",
  "builder",
  "reviewer",
  "operator",
  "evaluator",
];
