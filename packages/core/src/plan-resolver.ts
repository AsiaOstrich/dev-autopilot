/**
 * Plan Resolver — 純函式橋接層
 *
 * 整合 validatePlan、topologicalLayers、mergeDefaults、detectDangerousCommand、generateClaudeMd，
 * 輸出結構化的 ResolvedPlan JSON。
 *
 * 作為獨立模式（CLI orchestrate）與 Claude Code 模式（/orchestrate skill）的共用橋接。
 * 純計算、無副作用。
 */

import { validatePlan } from "./plan-validator.js";
import { topologicalLayers } from "./orchestrator.js";
import { mergeDefaults } from "./orchestrator.js";
import { detectDangerousCommand, detectHardcodedSecrets } from "./safety-hook.js";
import { generateClaudeMd, type ClaudeMdOptions } from "./claudemd-generator.js";
import { resolveQualityProfile, checkQualityWarnings } from "./quality-profile.js";
import type {
  TaskPlan,
  QualityConfig,
  ResolvedPlan,
  ResolvedLayer,
  ResolvedTask,
} from "./types.js";

export { type ResolvedPlan, type ResolvedLayer, type ResolvedTask };

/**
 * Plan Resolver 選項
 */
export interface PlanResolverOptions {
  /** 專案原始 CLAUDE.md 路徑（若存在會附加到 prompt） */
  existingClaudeMdPath?: string;
  /** 額外的約束條件 */
  extraConstraints?: string[];
}

/**
 * 解析 TaskPlan，產出 ResolvedPlan
 *
 * 流程：
 * 1. validatePlan() → 格式 + DAG 驗證
 * 2. topologicalLayers() → 分層
 * 3. mergeDefaults() → 合併預設值
 * 4. detectDangerousCommand() → 安全檢查
 * 5. generateClaudeMd() → 生成每個 task 的 prompt
 *
 * @param plan - 原始 TaskPlan
 * @param options - 解析選項
 * @returns 結構化的 ResolvedPlan
 */
export async function resolvePlan(
  plan: TaskPlan,
  options: PlanResolverOptions = {},
): Promise<ResolvedPlan> {
  // 1. 驗證
  const validation = validatePlan(plan);

  // 解析 quality profile
  const qualityConfig = resolveQualityProfile(plan);

  // 驗證失敗時仍回傳結構（含錯誤資訊），不 throw
  if (!validation.valid) {
    return {
      project: plan.project ?? "unknown",
      mode: "sequential",
      max_parallel: 1,
      layers: [],
      validation,
      safety_issues: [],
      total_tasks: plan.tasks?.length ?? 0,
      quality: qualityConfig,
      quality_warnings: [],
    };
  }

  // 檢查品質相關警告
  const qualityWarnings = checkQualityWarnings(plan, qualityConfig);

  // 2. 分層
  const layers = topologicalLayers(plan.tasks);

  // 3 + 4 + 5. 合併 defaults、安全檢查、生成 prompt
  const safetyIssues: Array<{ task_id: string; issue: string }> = [];
  const claudeMdOptions: ClaudeMdOptions = {
    project: plan.project,
    existingClaudeMdPath: options.existingClaudeMdPath,
    extraConstraints: options.extraConstraints,
    qualityConfig: qualityConfig,
  };

  const resolvedLayers: ResolvedLayer[] = [];

  for (let i = 0; i < layers.length; i++) {
    const layerTasks: ResolvedTask[] = [];

    for (const rawTask of layers[i]) {
      const merged = mergeDefaults(rawTask, plan);

      // 安全檢查 spec
      const specDanger = detectDangerousCommand(merged.spec);
      if (specDanger) {
        safetyIssues.push({ task_id: merged.id, issue: specDanger });
      }

      // 安全檢查 verify_command
      if (merged.verify_command) {
        const verifyDanger = detectDangerousCommand(merged.verify_command);
        if (verifyDanger) {
          safetyIssues.push({ task_id: merged.id, issue: verifyDanger });
        }
      }

      // 祕密掃描 spec
      const specSecrets = detectHardcodedSecrets(merged.spec);
      for (const secret of specSecrets) {
        safetyIssues.push({ task_id: merged.id, issue: secret });
      }

      // 生成 prompt
      const generatedPrompt = await generateClaudeMd(merged, claudeMdOptions);

      layerTasks.push({
        ...merged,
        generated_prompt: generatedPrompt,
      });
    }

    resolvedLayers.push({ index: i, tasks: layerTasks });
  }

  // 判斷模式
  const hasParallelLayer = layers.some((layer) => layer.length > 1);
  const mode = hasParallelLayer ? "parallel" : "sequential";
  const maxParallel = plan.max_parallel ?? Infinity;

  return {
    project: plan.project,
    mode,
    max_parallel: maxParallel === Infinity ? -1 : maxParallel,
    layers: resolvedLayers,
    validation,
    safety_issues: safetyIssues,
    total_tasks: plan.tasks.length,
    quality: qualityConfig,
    quality_warnings: qualityWarnings,
  };
}
