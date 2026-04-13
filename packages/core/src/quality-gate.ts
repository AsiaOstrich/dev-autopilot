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

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
  /** 規格品質評分（由 UDS checklist scoring 提供） */
  score?: number;
  /** 規格品質滿分（Standard mode = 10, Boost mode = 25） */
  max_score?: number;
}

/**
 * Quality Gate 單步結果
 */
export interface QualityGateStep {
  /** 步驟名稱 */
  name: "verify" | "lint" | "type_check" | "static_analysis" | "completion_check"
       | "unit" | "integration" | "system" | "e2e" | "agents_md_check"
       | "frontend_design_check";
  /** 執行的指令 */
  command: string;
  /** 是否通過 */
  passed: boolean;
  /** 指令輸出（stdout + stderr） */
  output: string;
}

/**
 * 前端設計合規性檢查結果
 *
 * 包含缺失的必填段落與警告訊息。
 */
export interface FrontendDesignCheckResult {
  /** 檢查步驟結果 */
  step: QualityGateStep;
  /** 缺失的必填段落列表 */
  missingSections?: string[];
  /** 缺失的語義色彩 token 列表 */
  missingColorTokens?: string[];
  /** 反模式條目不足（實際數量） */
  antiPatternCount?: number;
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
 * Hook telemetry 記錄
 *
 * 由 adapter 在 agent 執行期間收集，
 * 記錄 PostToolUse hooks 已成功執行的品質檢查步驟。
 */
export interface HookTelemetry {
  /** lint hook 最後一次執行結果（true = 全部通過） */
  lint_passed?: boolean;
  /** type_check hook 最後一次執行結果（true = 全部通過） */
  type_check_passed?: boolean;
}

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
  /** Hook telemetry（若有，跳過已通過的步驟） */
  hookTelemetry?: HookTelemetry;
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
        return buildFailResult(steps, step, evidence, task);
      }
    }
  } else if (qualityConfig.verify && task.verify_command) {
    // 傳統模式：verify_command
    options.onProgress?.(`[${task.id}] Quality Gate: verify_command → ${task.verify_command}`);
    const step = await runStep("verify", task.verify_command);
    if (!step.passed) {
      return buildFailResult(steps, step, evidence, task);
    }
  }

  // lint_command（兩種模式都執行，telemetry pass 時跳過）
  if (qualityConfig.lint_command) {
    if (options.hookTelemetry?.lint_passed === true) {
      options.onProgress?.(`[${task.id}] Quality Gate: lint → skipped (hook telemetry pass)`);
      steps.push({
        name: "lint",
        command: qualityConfig.lint_command,
        passed: true,
        output: "Skipped: hook telemetry indicates pass",
      });
      evidence.push({
        command: qualityConfig.lint_command,
        exit_code: 0,
        output: "Skipped: hook telemetry indicates pass",
        timestamp: new Date().toISOString(),
      });
    } else {
      options.onProgress?.(`[${task.id}] Quality Gate: lint → ${qualityConfig.lint_command}`);
      const step = await runStep("lint", qualityConfig.lint_command);
      if (!step.passed) {
        return buildFailResult(steps, step, evidence, task);
      }
    }
  }

  // type_check_command（兩種模式都執行，telemetry pass 時跳過）
  if (qualityConfig.type_check_command) {
    if (options.hookTelemetry?.type_check_passed === true) {
      options.onProgress?.(`[${task.id}] Quality Gate: type_check → skipped (hook telemetry pass)`);
      steps.push({
        name: "type_check",
        command: qualityConfig.type_check_command,
        passed: true,
        output: "Skipped: hook telemetry indicates pass",
      });
      evidence.push({
        command: qualityConfig.type_check_command,
        exit_code: 0,
        output: "Skipped: hook telemetry indicates pass",
        timestamp: new Date().toISOString(),
      });
    } else {
      options.onProgress?.(`[${task.id}] Quality Gate: type_check → ${qualityConfig.type_check_command}`);
      const step = await runStep("type_check", qualityConfig.type_check_command);
      if (!step.passed) {
        return buildFailResult(steps, step, evidence, task);
      }
    }
  }

  // static_analysis_command（兩種模式都執行）
  if (qualityConfig.static_analysis_command) {
    options.onProgress?.(`[${task.id}] Quality Gate: static_analysis → ${qualityConfig.static_analysis_command}`);
    const step = await runStep("static_analysis", qualityConfig.static_analysis_command);
    if (!step.passed) {
      return buildFailResult(steps, step, evidence, task);
    }
  }

  // completion_criteria（逐項執行有 command 的完成準則）
  if (qualityConfig.completion_criteria && qualityConfig.completion_criteria.length > 0) {
    for (const criterion of qualityConfig.completion_criteria) {
      if (!criterion.command) continue; // 無 command → 由 Judge 審查，跳過
      options.onProgress?.(`[${task.id}] Quality Gate: completion_check(${criterion.name}) → ${criterion.command}`);
      const step = await runStep("completion_check", criterion.command);
      if (!step.passed && criterion.required) {
        return buildFailResult(steps, step, evidence, task);
      }
    }
  }

  // AGENTS.md 合規檢查（非阻塞，僅 warning）
  const agentsMdResult = await checkAgentsMdSync(options.cwd);
  if (agentsMdResult) {
    steps.push(agentsMdResult.step);
    evidence.push({
      command: "agents_md_check",
      exit_code: agentsMdResult.step.passed ? 0 : 1,
      output: agentsMdResult.step.output.slice(0, 2000),
      timestamp: new Date().toISOString(),
    });
    if (!agentsMdResult.step.passed) {
      options.onProgress?.(`[${task.id}] Quality Gate: AGENTS.md drift detected (warning only)`);
    }
  }

  // 前端設計合規性檢查（非阻塞，僅 warning）
  // 純後端 API 或 CLI 專案若無 DESIGN.md，不視為錯誤
  const frontendDesignResult = await checkFrontendDesignCompliance(options.cwd);
  if (frontendDesignResult) {
    steps.push(frontendDesignResult.step);
    evidence.push({
      command: "frontend_design_check",
      exit_code: frontendDesignResult.step.passed ? 0 : 1,
      output: frontendDesignResult.step.output.slice(0, 2000),
      timestamp: new Date().toISOString(),
    });
    if (!frontendDesignResult.step.passed) {
      options.onProgress?.(`[${task.id}] Quality Gate: DESIGN.md compliance issues detected (warning only)`);
    }
  }

  return {
    passed: true,
    steps,
    evidence,
    ...(task.spec_score != null && {
      score: task.spec_score,
      max_score: task.spec_max_score ?? (task.spec_score <= 10 ? 10 : 25),
    }),
  };
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
/**
 * 檢查 AGENTS.md 與 .standards/ 的同步狀態
 *
 * 非阻塞：drift 只產生 warning，不阻擋 QualityGate。
 * 檢查項目：
 * 1. AGENTS.md 是否存在
 * 2. UDS 標記區塊是否存在
 * 3. 標記區塊中列出的標準是否與 .standards/ 目錄一致
 *
 * @param cwd - 專案根目錄
 * @returns QualityGateStep 或 null（若無 AGENTS.md）
 */
export async function checkAgentsMdSync(
  cwd: string,
): Promise<{ step: QualityGateStep; driftedFiles?: string[] } | null> {
  const agentsMdPath = join(cwd, "AGENTS.md");
  const standardsDir = join(cwd, ".standards");

  let agentsMdContent: string;
  try {
    agentsMdContent = await readFile(agentsMdPath, "utf-8");
  } catch {
    return null; // No AGENTS.md — skip check
  }

  // Extract UDS marker block
  const startMarker = "<!-- UDS:STANDARDS:START -->";
  const endMarker = "<!-- UDS:STANDARDS:END -->";
  const startIdx = agentsMdContent.indexOf(startMarker);
  const endIdx = agentsMdContent.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    return {
      step: {
        name: "agents_md_check",
        command: "agents_md_check",
        passed: true,
        output: "AGENTS.md 存在但無 UDS 標記區塊，跳過檢查。",
      },
    };
  }

  // Parse listed standards from marker block
  const block = agentsMdContent.slice(startIdx + startMarker.length, endIdx);
  const listedFiles = new Set<string>();
  for (const match of block.matchAll(/`([^`]+\.ai\.yaml)`/g)) {
    listedFiles.add(match[1]);
  }

  // Read actual .standards/ directory
  let actualFiles: Set<string>;
  try {
    const entries = await readdir(standardsDir);
    actualFiles = new Set(entries.filter(f => f.endsWith(".ai.yaml")));
  } catch {
    return {
      step: {
        name: "agents_md_check",
        command: "agents_md_check",
        passed: false,
        output: ".standards/ 目錄不存在，但 AGENTS.md 有 UDS 標記區塊。請執行 uds init。",
      },
    };
  }

  // Compare
  const missing = [...actualFiles].filter(f => !listedFiles.has(f));
  const extra = [...listedFiles].filter(f => !actualFiles.has(f));
  const drifted = [...missing, ...extra];

  if (drifted.length === 0) {
    return {
      step: {
        name: "agents_md_check",
        command: "agents_md_check",
        passed: true,
        output: `AGENTS.md 與 .standards/ 同步（${actualFiles.size} 項標準）。`,
      },
    };
  }

  const details: string[] = [];
  if (missing.length > 0) details.push(`新增但未列入 AGENTS.md：${missing.join(", ")}`);
  if (extra.length > 0) details.push(`AGENTS.md 列出但已移除：${extra.join(", ")}`);

  return {
    step: {
      name: "agents_md_check",
      command: "agents_md_check",
      passed: false,
      output: `AGENTS.md drift detected:\n${details.join("\n")}\n建議執行 uds update 更新。`,
    },
    driftedFiles: drifted,
  };
}

/**
 * 前端設計合規性驗證常數
 *
 * 來源：UDS frontend-design-standards.ai.yaml（XSPEC-026 Phase 1）
 */

/** DESIGN.md 必填段落（支援 snake_case 和 kebab-case 兩種格式） */
const REQUIRED_DESIGN_SECTIONS = [
  ["visual_theme", "visual-theme"],
  ["color_palette", "color-palette"],
  ["typography"],
  ["component_styling", "component-styling"],
  ["layout_spacing", "layout-spacing"],
  ["design_guidelines", "design-guidelines"],
] as const;

/** 語義色彩必要 token（支援 snake_case 和 kebab-case 兩種格式） */
const REQUIRED_COLOR_TOKENS = [
  ["background"],
  ["surface"],
  ["primary_text", "primary-text"],
  ["muted_text", "muted-text"],
  ["accent"],
] as const;

/** design_guidelines.anti_patterns 建議最低條目數 */
const MIN_ANTI_PATTERN_COUNT = 5;

/**
 * 驗證前端設計合規性
 *
 * 非阻塞：DESIGN.md 不存在時回傳 null（純後端專案不應被 block）。
 * DESIGN.md 存在時驗證：
 * 1. 6 個必填段落是否完整
 * 2. 語義色彩 5 個必要 token 是否存在（warn）
 * 3. anti_patterns 條目數是否 ≥ 5（warn）
 *
 * @param cwd - 專案根目錄
 * @returns FrontendDesignCheckResult 或 null（若無 DESIGN.md）
 */
export async function checkFrontendDesignCompliance(
  cwd: string,
): Promise<FrontendDesignCheckResult | null> {
  const designMdPath = join(cwd, "DESIGN.md");

  let content: string;
  try {
    content = await readFile(designMdPath, "utf-8");
  } catch {
    // DESIGN.md 不存在 → 跳過（非前端專案不應被 block）
    return null;
  }

  const issues: string[] = [];
  const missingSections: string[] = [];
  const missingColorTokens: string[] = [];
  let antiPatternCount: number | undefined;

  // 1. 必填段落完整性檢查
  for (const aliases of REQUIRED_DESIGN_SECTIONS) {
    const found = aliases.some(alias =>
      // 符合 Markdown heading（## section_name）或 YAML key（section_name:）
      new RegExp(`(?:^#{1,6}\\s+${alias}\\b|^${alias}\\s*:)`, "im").test(content)
    );
    if (!found) {
      const primaryName = aliases[0];
      missingSections.push(primaryName);
    }
  }

  if (missingSections.length > 0) {
    issues.push(
      `缺少必填段落（${missingSections.length} 個）：${missingSections.join(", ")}\n` +
      `  → 請在 DESIGN.md 中補充上述段落（支援 ## section_name 或 section_name: 格式）`
    );
  }

  // 2. 語義色彩 token 檢查（warn）
  for (const aliases of REQUIRED_COLOR_TOKENS) {
    const found = aliases.some(alias =>
      new RegExp(`\\b${alias}\\s*[=:\\-]`, "i").test(content)
    );
    if (!found) {
      missingColorTokens.push(aliases[0]);
    }
  }

  if (missingColorTokens.length > 0) {
    issues.push(
      `語義色彩 token 不完整，缺少：${missingColorTokens.join(", ")}\n` +
      `  → 建議在 color_palette 段落中補充上述 token`
    );
  }

  // 3. anti_patterns 條目數檢查（warn）
  // 計算 anti_patterns 區塊中的清單條目（- 或 * 開頭的行）
  const antiPatternSection = content.match(
    /(?:anti[_-]patterns?)\s*[:\n]([^]*?)(?=\n#{1,6}\s|\n\w+[_-]\w+\s*:|$)/i
  );
  if (antiPatternSection) {
    const listItems = (antiPatternSection[1].match(/^\s*[-*+]\s+\S/gm) ?? []).length;
    antiPatternCount = listItems;
    if (listItems < MIN_ANTI_PATTERN_COUNT) {
      issues.push(
        `design_guidelines.anti_patterns 條目不足（目前 ${listItems} 條，建議 ≥ ${MIN_ANTI_PATTERN_COUNT} 條）\n` +
        `  → 請補充常見的前端設計反模式`
      );
    }
  }

  const passed = missingSections.length === 0;
  const outputLines: string[] = [];

  if (passed && issues.length === 0) {
    outputLines.push("DESIGN.md 前端設計合規性驗證通過。");
  } else {
    outputLines.push("DESIGN.md 前端設計合規性問題：");
    outputLines.push(...issues.map((issue, i) => `\n[${i + 1}] ${issue}`));
    if (passed) {
      outputLines.push("\n（必填段落完整，上述為 warning 項目）");
    } else {
      outputLines.push("\n請修正上述 error 項目（必填段落缺失），warning 項目建議補充。");
    }
  }

  return {
    step: {
      name: "frontend_design_check",
      command: "frontend_design_check",
      passed,
      output: outputLines.join(""),
    },
    missingSections: missingSections.length > 0 ? missingSections : undefined,
    missingColorTokens: missingColorTokens.length > 0 ? missingColorTokens : undefined,
    antiPatternCount,
  };
}

function buildFailResult(
  steps: QualityGateStep[],
  failedStep: QualityGateStep,
  evidence: VerificationEvidence[],
  task?: Task,
): QualityGateResult {
  const feedback = [
    `品質門檻「${failedStep.name}」失敗。`,
    `執行指令：${failedStep.command}`,
    `輸出：`,
    failedStep.output,
    "",
    "請修正上述問題後重試。",
  ].join("\n");

  return {
    passed: false,
    steps,
    feedback,
    evidence,
    ...(task?.spec_score != null && {
      score: task.spec_score,
      max_score: task.spec_max_score ?? (task.spec_score <= 10 ? 10 : 25),
    }),
  };
}
