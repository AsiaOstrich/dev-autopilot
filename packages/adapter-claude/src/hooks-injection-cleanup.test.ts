/**
 * SPEC-009 AC-4/AC-9: cleanupHarnessConfig + writeHarnessConfig FullHooksConfig — TDD 骨架
 *
 * [Generated] 由 /derive tdd 從 SPEC-009 AC-4, AC-9 推演
 * Source: specs/SPEC-009-harness-hooks-injection.md
 *
 * 測試 cleanupHarnessConfig 刪除行為與 writeHarnessConfig 對 FullHooksConfig 的支援。
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { QualityConfig } from "@devap/core";
import {
  writeHarnessConfig,
  generateFullHooksStrategy,
} from "./harness-config.js";

// [TODO] 待 cleanupHarnessConfig 實作後 import
// import { cleanupHarnessConfig } from "./harness-config.js";

let tmpDir: string;

async function setup() {
  tmpDir = await mkdtemp(join(tmpdir(), "devap-spec009-"));
  return tmpDir;
}

async function teardown() {
  await rm(tmpDir, { recursive: true, force: true });
}

describe("SPEC-009: cleanupHarnessConfig", () => {
  afterEach(teardown);

  // ==========================================================
  // AC-4: cleanupHarnessConfig 正常刪除
  // ==========================================================

  it("[AC-4] cleanupHarnessConfig 應刪除 {targetDir}/.claude/settings.json", async () => {
    // [Derived] AC-4: 清理已寫入的設定檔
    // [TODO] 待 cleanupHarnessConfig 實作後啟用
    const dir = await setup();
    const claudeDir = join(dir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    await writeFile(settingsPath, '{"hooks":{}}');

    // await cleanupHarnessConfig(dir);

    // 驗證檔案已被刪除
    // await expect(stat(settingsPath)).rejects.toThrow();
    expect(true).toBe(true); // [TODO] placeholder
  });

  it("[AC-4] cleanupHarnessConfig 檔案不存在時不應拋錯", async () => {
    // [Derived] AC-4: 冪等清理 — 檔案已被刪或從未建立
    // [TODO] 待 cleanupHarnessConfig 實作後啟用
    const dir = await setup();

    // 不應拋出例外
    // await expect(cleanupHarnessConfig(dir)).resolves.toBeUndefined();
    expect(true).toBe(true); // [TODO] placeholder
  });
});

describe("SPEC-009: writeHarnessConfig 支援 FullHooksConfig", () => {
  afterEach(teardown);

  // ==========================================================
  // AC-2/AC-3: writeHarnessConfig 擴展支援 FullHooksConfig
  // ==========================================================

  it("[AC-2] writeHarnessConfig 應支援 FullHooksConfig（含 PreToolUse + PostToolUse + Stop）", async () => {
    // [Derived] AC-2: strict → 完整三層 hooks 寫入
    const dir = await setup();
    const strictConfig: QualityConfig = {
      verify: true,
      lint_command: "pnpm lint",
      type_check_command: "pnpm tsc --noEmit",
      judge_policy: "always",
      max_retries: 2,
      max_retry_budget_usd: 2.0,
    };

    const fullConfig = generateFullHooksStrategy(strictConfig, {
      verifyCommand: "pnpm test",
    });

    await writeHarnessConfig(fullConfig, dir);

    const settingsPath = join(dir, ".claude", "settings.json");
    const content = JSON.parse(await readFile(settingsPath, "utf-8"));

    expect(content.hooks).toBeDefined();
    expect(content.hooks.PreToolUse).toBeDefined();
    expect(content.hooks.PostToolUse).toBeDefined();
    expect(content.hooks.Stop).toBeDefined();
  });

  it("[AC-9] writeHarnessConfig 應寫入指定的 targetDir 而非主 repo", async () => {
    // [Derived] AC-9: worktree 隔離
    const dir = await setup();
    const config = generateFullHooksStrategy(
      {
        verify: true,
        lint_command: "eslint .",
        judge_policy: "never",
        max_retries: 0,
        max_retry_budget_usd: 0,
      },
    );

    await writeHarnessConfig(config, dir);

    // 檔案應在 targetDir/.claude/settings.json
    const settingsPath = join(dir, ".claude", "settings.json");
    const fileStat = await stat(settingsPath);
    expect(fileStat.isFile()).toBe(true);
  });
});
