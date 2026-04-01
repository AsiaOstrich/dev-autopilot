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
