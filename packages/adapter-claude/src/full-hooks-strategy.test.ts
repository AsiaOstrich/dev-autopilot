/**
 * Full Hooks Strategy 單元測試
 *
 * Source: SPEC-007, AC-1, AC-3, AC-4, AC-5, AC-7
 * 測試 generateFullHooksStrategy() 的完整 hooks 策略生成。
 */

import { describe, it, expect } from "vitest";
import type { QualityConfig } from "@devap/core";
import { generateFullHooksStrategy, type FullHooksConfig } from "./harness-config.js";
import { generateHarnessHooks } from "./harness-config.js";

// ============================================================
// AC-1: generateFullHooksStrategy() 產出三種 hook
// ============================================================

describe("generateFullHooksStrategy", () => {
  describe("AC-1: strict 模式產出完整 hooks", () => {
    const strictConfig: QualityConfig = {
      verify: true,
      lint_command: "pnpm lint",
      type_check_command: "pnpm tsc --noEmit",
      judge_policy: "always",
      max_retries: 2,
      max_retry_budget_usd: 2,
    };

    it("[AC-1] 應包含 PreToolUse hooks", () => {
      const result = generateFullHooksStrategy(strictConfig, { verifyCommand: "pnpm test" });
      expect(result.hooks.PreToolUse).toBeDefined();
      expect(result.hooks.PreToolUse!.length).toBeGreaterThan(0);
    });

    it("[AC-1] 應包含 PostToolUse hooks", () => {
      const result = generateFullHooksStrategy(strictConfig, { verifyCommand: "pnpm test" });
      expect(result.hooks.PostToolUse).toBeDefined();
      expect(result.hooks.PostToolUse!.length).toBeGreaterThan(0);
    });

    it("[AC-1] 應包含 Stop hooks", () => {
      const result = generateFullHooksStrategy(strictConfig, { verifyCommand: "pnpm test" });
      expect(result.hooks.Stop).toBeDefined();
      expect(result.hooks.Stop!.length).toBeGreaterThan(0);
    });

    it("[AC-1] PreToolUse 應匹配 Bash 工具", () => {
      const result = generateFullHooksStrategy(strictConfig, { verifyCommand: "pnpm test" });
      expect(result.hooks.PreToolUse![0].matcher).toContain("Bash");
    });

    it("[AC-1] PostToolUse 應匹配 Write/Edit 工具", () => {
      const result = generateFullHooksStrategy(strictConfig, { verifyCommand: "pnpm test" });
      expect(result.hooks.PostToolUse![0].matcher).toMatch(/Write|Edit/);
    });
  });

  // ============================================================
  // AC-3: Stop hook 執行 verify_command
  // ============================================================

  describe("AC-3: Stop hook 品質門檻", () => {
    const config: QualityConfig = {
      verify: true,
      judge_policy: "never",
      max_retries: 0,
      max_retry_budget_usd: 0,
    };

    it("[AC-3] 有 verifyCommand 時應生成 Stop hook", () => {
      const result = generateFullHooksStrategy(config, { verifyCommand: "pnpm test" });
      expect(result.hooks.Stop).toBeDefined();
      expect(result.hooks.Stop!.length).toBeGreaterThan(0);
    });

    it("[AC-3] Stop hook 指令應包含 verify_command", () => {
      const result = generateFullHooksStrategy(config, { verifyCommand: "pnpm test" });
      const stopHook = result.hooks.Stop![0].hooks[0];
      expect(stopHook.command).toContain("pnpm test");
    });

    it("[AC-3] 無 verifyCommand 時不應生成 Stop hook", () => {
      const result = generateFullHooksStrategy(config);
      expect(result.hooks.Stop).toBeUndefined();
    });

    it("[AC-3] Stop hook 應輸出 decision:block 的 JSON 結構", () => {
      const result = generateFullHooksStrategy(config, { verifyCommand: "pnpm test" });
      const stopHook = result.hooks.Stop![0].hooks[0];
      expect(stopHook.command).toContain("decision");
      expect(stopHook.command).toContain("block");
    });
  });

  // ============================================================
  // AC-4: quality: "none" 仍有 PreToolUse（安全永遠開啟）
  // ============================================================

  describe("AC-4: 安全永遠開啟", () => {
    const noneConfig: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 0,
      max_retry_budget_usd: 0,
    };

    it("[AC-4] quality: none 仍應有 PreToolUse hooks", () => {
      const result = generateFullHooksStrategy(noneConfig);
      expect(result.hooks.PreToolUse).toBeDefined();
      expect(result.hooks.PreToolUse!.length).toBeGreaterThan(0);
    });

    it("[AC-4] quality: none 不應有 PostToolUse hooks", () => {
      const result = generateFullHooksStrategy(noneConfig);
      expect(result.hooks.PostToolUse).toBeUndefined();
    });

    it("[AC-4] quality: none 不應有 Stop hooks", () => {
      const result = generateFullHooksStrategy(noneConfig);
      expect(result.hooks.Stop).toBeUndefined();
    });
  });

  // ============================================================
  // AC-5: generateHarnessHooks() 向後相容
  // ============================================================

  describe("AC-5: 向後相容", () => {
    it("[AC-5] generateHarnessHooks 仍可正常呼叫", () => {
      const config: QualityConfig = {
        verify: true,
        lint_command: "pnpm lint",
        judge_policy: "never",
        max_retries: 0,
        max_retry_budget_usd: 0,
      };
      const result = generateHarnessHooks(config);
      expect(result.hooks?.PostToolUse).toBeDefined();
    });

    it("[AC-5] generateHarnessHooks 回傳格式不變（無 PreToolUse/Stop）", () => {
      const config: QualityConfig = {
        verify: true,
        lint_command: "pnpm lint",
        type_check_command: "pnpm tsc --noEmit",
        judge_policy: "always",
        max_retries: 2,
        max_retry_budget_usd: 2,
      };
      const result = generateHarnessHooks(config);
      // generateHarnessHooks 只回傳 PostToolUse，不含 PreToolUse/Stop
      expect(result.hooks?.PostToolUse).toBeDefined();
      expect((result as { hooks?: { PreToolUse?: unknown } }).hooks?.PreToolUse).toBeUndefined();
      expect((result as { hooks?: { Stop?: unknown } }).hooks?.Stop).toBeUndefined();
    });
  });

  // ============================================================
  // AC-7 在 REFACTOR 階段透過 pnpm test 驗證
  // ============================================================

  describe("AC-1 邊界：minimal 只有 PreToolUse", () => {
    const minimalConfig: QualityConfig = {
      verify: true,
      judge_policy: "never",
      max_retries: 0,
      max_retry_budget_usd: 0,
    };

    it("[AC-1] minimal 品質模式應有 PreToolUse（安全）但無 PostToolUse", () => {
      const result = generateFullHooksStrategy(minimalConfig);
      expect(result.hooks.PreToolUse).toBeDefined();
      expect(result.hooks.PostToolUse).toBeUndefined();
    });
  });
});
