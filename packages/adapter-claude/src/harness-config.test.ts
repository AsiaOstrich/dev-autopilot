/**
 * Harness Config 單元測試
 *
 * Source: GitHub Issue #5, AC-1 ~ AC-2
 * 測試 generateHarnessHooks() 的行為。
 */

import { describe, it, expect } from "vitest";
import type { QualityConfig } from "@devap/core";
import { generateHarnessHooks } from "./harness-config.js";

/** 從 HooksConfig 提取所有 hook action 的指令 */
function extractCommands(config: ReturnType<typeof generateHarnessHooks>): string[] {
  if (!config.hooks?.PostToolUse) return [];
  return config.hooks.PostToolUse.flatMap(group => group.hooks.map(h => h.command));
}

describe("generateHarnessHooks", () => {
  // ============================================================
  // AC-1: strict 品質模式注入即時 lint/type-check hooks
  // ============================================================

  describe("AC-1: strict 品質模式", () => {
    const strictConfig: QualityConfig = {
      verify: true,
      lint_command: "pnpm lint",
      type_check_command: "pnpm tsc --noEmit",
      judge_policy: "always",
      max_retries: 3,
      max_retry_budget_usd: 5,
    };

    it("[AC-1] 應生成包含 PostToolUse hook 的配置", () => {
      // [Derived] AC-1: strict quality → PostToolUse hooks
      const result = generateHarnessHooks(strictConfig);
      expect(result.hooks).toBeDefined();
      expect(result.hooks!.PostToolUse).toBeDefined();
      expect(result.hooks!.PostToolUse!.length).toBeGreaterThan(0);
    });

    it("[AC-1] hook 指令應包含 lint_command", () => {
      // [Derived] AC-1: lint_command 轉為 hook
      const commands = extractCommands(generateHarnessHooks(strictConfig));
      expect(commands.some(cmd => cmd.includes("pnpm lint"))).toBe(true);
    });

    it("[AC-1] hook 指令應包含 type_check_command", () => {
      // [Derived] AC-1: type_check_command 轉為 hook
      const commands = extractCommands(generateHarnessHooks(strictConfig));
      expect(commands.some(cmd => cmd.includes("pnpm tsc --noEmit"))).toBe(true);
    });

    it("[AC-1] hook 應僅在寫檔工具觸發", () => {
      // [Derived] AC-1: PostToolUse 應限定 Write/Edit 工具
      const result = generateHarnessHooks(strictConfig);
      for (const group of result.hooks!.PostToolUse!) {
        expect(group.matcher).toBeDefined();
        expect(group.matcher).toMatch(/Write|Edit/);
      }
    });

    it("[AC-1] 僅有 lint_command 時只生成 lint hook", () => {
      // [Derived] AC-1 邊界：部分品質設定
      const lintOnlyConfig: QualityConfig = {
        verify: true,
        lint_command: "eslint .",
        judge_policy: "never",
        max_retries: 0,
        max_retry_budget_usd: 0,
      };
      const result = generateHarnessHooks(lintOnlyConfig);
      expect(result.hooks!.PostToolUse!.length).toBeGreaterThan(0);
      const commands = extractCommands(result);
      expect(commands.some(cmd => cmd.includes("eslint"))).toBe(true);
      expect(commands.some(cmd => cmd.includes("tsc"))).toBe(false);
    });
  });

  // ============================================================
  // AC-2: none 品質模式不注入 hooks
  // ============================================================

  describe("AC-2: none 品質模式", () => {
    const noneConfig: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 0,
      max_retry_budget_usd: 0,
    };

    it("[AC-2] 無 lint/type-check 時回傳空 hooks", () => {
      // [Derived] AC-2: quality: "none" → 不注入任何 hooks
      const result = generateHarnessHooks(noneConfig);
      const hasHooks = result.hooks?.PostToolUse && result.hooks.PostToolUse.length > 0;
      expect(hasHooks).toBeFalsy();
    });

    it("[AC-2] verify-only 設定不生成 PostToolUse hooks", () => {
      // [Derived] AC-2 邊界：有 verify 但無 lint/type-check
      const verifyOnlyConfig: QualityConfig = {
        verify: true,
        judge_policy: "never",
        max_retries: 0,
        max_retry_budget_usd: 0,
      };
      const result = generateHarnessHooks(verifyOnlyConfig);
      const hasHooks = result.hooks?.PostToolUse && result.hooks.PostToolUse.length > 0;
      expect(hasHooks).toBeFalsy();
    });
  });
});
