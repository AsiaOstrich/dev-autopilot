/**
 * Harness Hook 配置生成器
 *
 * 根據 QualityConfig 動態生成 Claude Code PostToolUse hooks，
 * 實現寫檔時即時品質檢查（lint/type-check），減少 FixLoop 觸發率。
 *
 * 輸出符合 Claude Code settings.json hooks schema。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { QualityConfig } from "@devap/core";
import { generatePreToolUseScript } from "./safety-script-generator.js";

/**
 * 單一 hook 動作定義
 *
 * 符合 Claude Code settings.json 的 hook entry schema。
 */
export interface HookAction {
  /** hook 類型（僅支援 command） */
  type: "command";
  /** 執行指令 */
  command: string;
  /** 逾時秒數 */
  timeout?: number;
  /** 顯示給使用者的進度訊息 */
  statusMessage?: string;
}

/**
 * Matcher Group — 一組針對特定工具的 hooks
 *
 * matcher 為正規表達式，匹配觸發的工具名稱。
 */
export interface MatcherGroup {
  /** 工具名稱 matcher（正則表達式） */
  matcher: string;
  /** 該 matcher 下的 hook 動作列表 */
  hooks: HookAction[];
}

/**
 * Hooks 配置
 *
 * 可直接寫入 .claude/settings.json 的 hooks 區段。
 */
export interface HooksConfig {
  /** PostToolUse hooks（寫檔後觸發） */
  hooks?: {
    PostToolUse?: MatcherGroup[];
  };
}

/**
 * 從 QualityConfig 生成 Claude Code PostToolUse hooks
 *
 * 僅在有 lint_command 或 type_check_command 時生成 hooks，
 * 確保 quality: "none" 或 verify-only 設定不注入任何 hooks。
 *
 * @param qualityConfig - 品質設定
 * @returns hooks 配置（可能為空）
 */
export function generateHarnessHooks(qualityConfig: QualityConfig): HooksConfig {
  const hookActions: HookAction[] = [];

  if (qualityConfig.lint_command) {
    hookActions.push({
      type: "command",
      command: qualityConfig.lint_command,
      timeout: 30,
      statusMessage: "Harness: lint 檢查中...",
    });
  }

  if (qualityConfig.type_check_command) {
    hookActions.push({
      type: "command",
      command: qualityConfig.type_check_command,
      timeout: 60,
      statusMessage: "Harness: 型別檢查中...",
    });
  }

  // 無品質指令時不注入 hooks
  if (hookActions.length === 0) {
    return {};
  }

  return {
    hooks: {
      PostToolUse: [
        {
          matcher: "Write|Edit|NotebookEdit",
          hooks: hookActions,
        },
      ],
    },
  };
}

/**
 * 完整 hooks 策略配置（SPEC-007）
 *
 * 涵蓋 PreToolUse（安全攔截）、PostToolUse（品質檢查）、Stop（品質門檻 gate）。
 */
export interface FullHooksConfig {
  hooks: {
    PreToolUse?: MatcherGroup[];
    PostToolUse?: MatcherGroup[];
    Stop?: MatcherGroup[];
  };
}

/**
 * generateFullHooksStrategy 選項
 */
export interface FullHooksStrategyOptions {
  /** 驗證指令（用於 Stop hook） */
  verifyCommand?: string;
}

/**
 * 生成完整 hooks 策略（SPEC-007）
 *
 * - PreToolUse：安全攔截（始終啟用，即使 quality: "none"）
 * - PostToolUse：品質檢查（有 lint/type-check 時啟用）
 * - Stop：品質門檻（有 verifyCommand 時啟用）
 *
 * @param qualityConfig - 品質設定
 * @param options - 額外選項（verifyCommand 等）
 * @returns 完整 hooks 配置
 */
export function generateFullHooksStrategy(
  qualityConfig: QualityConfig,
  options?: FullHooksStrategyOptions,
): FullHooksConfig {
  const result: FullHooksConfig = { hooks: {} };

  // PreToolUse：安全攔截（始終啟用）
  const safetyScript = generatePreToolUseScript();
  result.hooks.PreToolUse = [
    {
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command: safetyScript,
          timeout: 10,
          statusMessage: "DevAP Safety: 檢查危險操作...",
        },
      ],
    },
  ];

  // PostToolUse：品質檢查（有 lint/type-check 時啟用）
  const postToolUse = generateHarnessHooks(qualityConfig);
  if (postToolUse.hooks?.PostToolUse) {
    result.hooks.PostToolUse = postToolUse.hooks.PostToolUse;
  }

  // Stop：品質門檻（有 verifyCommand 時啟用）
  if (options?.verifyCommand) {
    const verifyCmd = options.verifyCommand;
    // 生成 Stop hook 腳本：執行 verify_command，失敗時輸出 decision:block
    const stopScript = [
      "#!/bin/bash",
      "# DevAP Quality Gate — Stop hook",
      `RESULT=$(${verifyCmd} 2>&1)`,
      "EXIT_CODE=$?",
      "if [ $EXIT_CODE -ne 0 ]; then",
      '  echo \'{"decision":"block","reason":"verify_command 失敗，請修復後再結束"}\'',
      "  exit 0",
      "fi",
      "exit 0",
    ].join("\n");

    result.hooks.Stop = [
      {
        matcher: ".*",
        hooks: [
          {
            type: "command",
            command: stopScript,
            timeout: 120,
            statusMessage: "DevAP Quality Gate: 執行驗證...",
          },
        ],
      },
    ];
  }

  // 清除空的 hook 類別
  if (!result.hooks.PostToolUse) delete result.hooks.PostToolUse;
  if (!result.hooks.Stop) delete result.hooks.Stop;

  return result;
}

/**
 * 將 hooks 配置寫入目標目錄的 .claude/settings.json
 *
 * 僅在有實際 hooks 時才寫入，避免產生空設定檔。
 * 設計用於 worktree 目錄，不影響主 repo。
 *
 * @param config - hooks 配置
 * @param targetDir - 目標目錄（通常是 worktree 路徑）
 */
export async function writeHarnessConfig(
  config: HooksConfig,
  targetDir: string,
): Promise<void> {
  // 無 hooks 時不建立設定檔
  const hasHooks = config.hooks?.PostToolUse && config.hooks.PostToolUse.length > 0;
  if (!hasHooks) {
    return;
  }

  const claudeDir = join(targetDir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  const settingsPath = join(claudeDir, "settings.json");
  const settings = { hooks: config.hooks };
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}
