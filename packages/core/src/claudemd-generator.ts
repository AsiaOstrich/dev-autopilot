/**
 * CLAUDE.md 生成器
 *
 * 為每個 sub-agent 生成客製化的 CLAUDE.md，
 * 注入任務規格、約束條件等資訊，引導 agent 專注於指定任務。
 */

import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Task, QualityConfig } from "./types.js";

/**
 * CLAUDE.md 生成選項
 */
export interface ClaudeMdOptions {
  /** 專案名稱 */
  project: string;
  /** 額外的約束條件 */
  extraConstraints?: string[];
  /** 專案的原始 CLAUDE.md 路徑（若存在則會附加） */
  existingClaudeMdPath?: string;
  /** 品質設定（若提供，注入品質要求 section） */
  qualityConfig?: QualityConfig;
}

/**
 * 為指定任務生成 CLAUDE.md 內容
 *
 * @param task - 任務定義
 * @param options - 生成選項
 * @returns 生成的 CLAUDE.md 內容
 */
export async function generateClaudeMd(
  task: Task,
  options: ClaudeMdOptions,
): Promise<string> {
  const sections: string[] = [];

  // 標頭
  sections.push(`# Task: ${task.id} - ${task.title}`);
  sections.push("");

  // 角色說明
  sections.push("## 你的角色");
  sections.push(`你是 devap 編排的 worker agent，負責執行專案 "${options.project}" 中的一個特定任務。`);
  sections.push("");

  // 任務規格
  sections.push("## 任務規格");
  sections.push(task.spec);
  sections.push("");

  // 驗收條件（若有）
  if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
    sections.push("## 驗收條件");
    sections.push("完成任務後，你的成果必須滿足以下每一條驗收條件：");
    for (let i = 0; i < task.acceptance_criteria.length; i++) {
      sections.push(`${i + 1}. ${task.acceptance_criteria[i]}`);
    }
    sections.push("");
  }

  // 使用者意圖（若有）
  if (task.user_intent) {
    sections.push("## 使用者意圖");
    sections.push(`此任務的目的：${task.user_intent}`);
    sections.push("請確保你的實作真正解決了使用者的問題，而不僅是技術上正確。");
    sections.push("");
  }

  // 約束條件
  sections.push("## 約束");
  sections.push("- 只修改與此任務相關的檔案");
  sections.push("- 不要修改其他 task 負責的檔案");
  sections.push("- 完成後確認所有修改都已儲存");

  if (task.verify_command) {
    sections.push(`- 完成後執行驗證指令：\`${task.verify_command}\``);
  }

  if (options.extraConstraints) {
    for (const constraint of options.extraConstraints) {
      sections.push(`- ${constraint}`);
    }
  }

  sections.push("");

  // 品質要求（若有 qualityConfig）
  if (options.qualityConfig) {
    sections.push("## 品質要求");
    sections.push("你的產出將經過以下自動化品質檢查：");
    if (options.qualityConfig.verify) {
      sections.push("- **驗證指令**：task 完成後會自動執行 verify_command");
    }
    if (options.qualityConfig.lint_command) {
      sections.push(`- **Lint 檢查**：\`${options.qualityConfig.lint_command}\``);
    }
    if (options.qualityConfig.type_check_command) {
      sections.push(`- **型別檢查**：\`${options.qualityConfig.type_check_command}\``);
    }
    if (options.qualityConfig.static_analysis_command) {
      sections.push(`- **靜態分析**：\`${options.qualityConfig.static_analysis_command}\``);
    }
    if (options.qualityConfig.judge_policy !== "never") {
      sections.push(`- **Judge 審查**：策略為 \`${options.qualityConfig.judge_policy}\`，獨立 Agent 會審查你的產出`);
    }
    if (options.qualityConfig.max_retries > 0) {
      sections.push(`- **自動重試**：驗證失敗時最多重試 ${options.qualityConfig.max_retries} 次`);
    }
    sections.push("");
  }

  // Harness 提示（始終注入）
  sections.push("## Harness 提示");
  sections.push("你正在 devap Harness 環境中執行。請注意：");
  sections.push("- 你的執行結果會被 Quality Gate 自動驗證");
  sections.push("- 驗證失敗時，Harness 會注入錯誤回饋並要求你重試");
  sections.push("- 請確保程式碼可編譯、測試可通過後再結束");
  sections.push("");

  // 附加原始 CLAUDE.md
  if (options.existingClaudeMdPath) {
    try {
      const existing = await readFile(options.existingClaudeMdPath, "utf-8");
      sections.push("## 專案原始指引");
      sections.push(existing.trim());
      sections.push("");
    } catch {
      // 檔案不存在，忽略
    }
  }

  return sections.join("\n");
}

/**
 * 將生成的 CLAUDE.md 寫入指定目錄
 *
 * @param content - CLAUDE.md 內容
 * @param targetDir - 目標目錄（通常是 worktree 路徑）
 */
export async function writeClaudeMd(
  content: string,
  targetDir: string,
): Promise<void> {
  const filePath = join(targetDir, "CLAUDE.md");
  await writeFile(filePath, content, "utf-8");
}
