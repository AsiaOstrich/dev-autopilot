/**
 * Quality Gate — 品質門檻執行器
 *
 * 支援兩種模式：
 * 1. 傳統模式：依序執行 verify_command → lint_command → type_check_command
 * 2. 多層級模式：依序執行 test_levels 定義的多個測試層級
 *
 * test_levels 優先於 verify_command。全部通過才視為品質門檻通過。
 * 透過回呼函式執行 shell 指令，方便測試 mock。
 */

import type { QualityConfig, Task, CompletionCheck, VerificationEvidence } from "./types.js";

/**
 * Quality Gate 檢查結果
 */
export interface QualityGateResult {
  /** 是否全部通過 */
  passed: boolean;
  /** 各步驟結果 */
  steps: QualityGateStep[];
  /** 失敗的回饋訊息（用於 fix loop 注入 agent prompt） */
  feedback?: string;
  /** 驗證證據（借鑑 Superpowers Iron Law：Evidence before claims） */
  evidence: VerificationEvidence[];
}

/**
 * Quality Gate 單步結果
 */
export interface QualityGateStep {
  /** 步驟名稱 */
  name: "verify" | "lint" | "type_check" | "static_analysis" | "completion_check"
       | "unit" | "integration" | "system" | "e2e";
  /** 執行的指令 */
  command: string;
  /** 是否通過 */
  passed: boolean;
  /** 指令輸出（stdout + stderr） */
  output: string;
}

/**
 * Shell 指令執行器回呼
 *
 * @param command - 要執行的 shell 指令
 * @param cwd - 工作目錄
 * @returns { exitCode, stdout, stderr }
 */
export type ShellExecutor = (
  command: string,
  cwd: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/**
 * Quality Gate 選項
 */
export interface QualityGateOptions {
  /** 工作目錄 */
  cwd: string;
  /** Shell 指令執行器 */
  shellExecutor: ShellExecutor;
  /** 進度回呼 */
  onProgress?: (message: string) => void;
}

/**
 * 執行品質門檻檢查
 *
 * 若 task 有 test_levels 且非空，走多層級模式（取代 verify_command）：
 *   依序執行每個 test level，第一個失敗即停止。
 *   之後再執行 lint_command、type_check_command。
 *
 * 否則走傳統模式：
 *   1. verify_command（若 task 有設定且 quality.verify 為 true）
 *   2. lint_command（若 quality config 有設定）
 *   3. type_check_command（若 quality config 有設定）
 *
 * 任一步驟失敗即停止，回傳失敗結果。
 *
 * @param task - 已執行完成的任務
 * @param qualityConfig - 品質設定
 * @param options - 執行選項
 * @returns Quality Gate 結果
 */
export async function runQualityGate(
  task: Task,
  qualityConfig: QualityConfig,
  options: QualityGateOptions,
): Promise<QualityGateResult> {
  const steps: QualityGateStep[] = [];
  const evidence: VerificationEvidence[] = [];

  // 判斷走多層級或傳統模式
  const hasTestLevels = task.test_levels && task.test_levels.length > 0;

  /** 執行步驟並收集證據的輔助函式 */
  const runStep = async (
    name: QualityGateStep["name"],
    command: string,
  ): Promise<QualityGateStep> => {
    const step = await executeStep(name, command, options);
    steps.push(step);
    // 收集驗證證據（Iron Law: Evidence before claims）
    evidence.push({
      command,
      exit_code: step.passed ? 0 : 1,
      output: step.output.slice(0, 2000),
      timestamp: new Date().toISOString(),
    });
    return step;
  };

  if (hasTestLevels) {
    // 多層級測試模式：依序執行每個 test level
    for (const level of task.test_levels!) {
      options.onProgress?.(`[${task.id}] Quality Gate: ${level.name} → ${level.command}`);
      const step = await runStep(level.name, level.command);
      if (!step.passed) {
        return buildFailResult(steps, step, evidence);
      }
    }
  } else if (qualityConfig.verify && task.verify_command) {
    // 傳統模式：verify_command
    options.onProgress?.(`[${task.id}] Quality Gate: verify_command → ${task.verify_command}`);
    const step = await runStep("verify", task.verify_command);
    if (!step.passed) {
      return buildFailResult(steps, step, evidence);
    }
  }

  // lint_command（兩種模式都執行）
  if (qualityConfig.lint_command) {
    options.onProgress?.(`[${task.id}] Quality Gate: lint → ${qualityConfig.lint_command}`);
    const step = await runStep("lint", qualityConfig.lint_command);
    if (!step.passed) {
      return buildFailResult(steps, step, evidence);
    }
  }

  // type_check_command（兩種模式都執行）
  if (qualityConfig.type_check_command) {
    options.onProgress?.(`[${task.id}] Quality Gate: type_check → ${qualityConfig.type_check_command}`);
    const step = await runStep("type_check", qualityConfig.type_check_command);
    if (!step.passed) {
      return buildFailResult(steps, step, evidence);
    }
  }

  // static_analysis_command（兩種模式都執行）
  if (qualityConfig.static_analysis_command) {
    options.onProgress?.(`[${task.id}] Quality Gate: static_analysis → ${qualityConfig.static_analysis_command}`);
    const step = await runStep("static_analysis", qualityConfig.static_analysis_command);
    if (!step.passed) {
      return buildFailResult(steps, step, evidence);
    }
  }

  // completion_criteria（逐項執行有 command 的完成準則）
  if (qualityConfig.completion_criteria && qualityConfig.completion_criteria.length > 0) {
    for (const criterion of qualityConfig.completion_criteria) {
      if (!criterion.command) continue; // 無 command → 由 Judge 審查，跳過
      options.onProgress?.(`[${task.id}] Quality Gate: completion_check(${criterion.name}) → ${criterion.command}`);
      const step = await runStep("completion_check", criterion.command);
      if (!step.passed && criterion.required) {
        return buildFailResult(steps, step, evidence);
      }
    }
  }

  return { passed: true, steps, evidence };
}

/**
 * 執行單一品質門檻步驟
 */
async function executeStep(
  name: QualityGateStep["name"],
  command: string,
  options: QualityGateOptions,
): Promise<QualityGateStep> {
  try {
    const { exitCode, stdout, stderr } = await options.shellExecutor(command, options.cwd);
    const output = [stdout, stderr].filter(Boolean).join("\n");
    return {
      name,
      command,
      passed: exitCode === 0,
      output: output.slice(0, 5000),
    };
  } catch (error) {
    return {
      name,
      command,
      passed: false,
      output: `執行錯誤：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 構建失敗結果，含 feedback 供 fix loop 使用
 */
function buildFailResult(
  steps: QualityGateStep[],
  failedStep: QualityGateStep,
  evidence: VerificationEvidence[],
): QualityGateResult {
  const feedback = [
    `品質門檻「${failedStep.name}」失敗。`,
    `執行指令：${failedStep.command}`,
    `輸出：`,
    failedStep.output,
    "",
    "請修正上述問題後重試。",
  ].join("\n");

  return { passed: false, steps, feedback, evidence };
}
