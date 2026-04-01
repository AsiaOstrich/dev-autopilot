/**
 * Harness Config 整合測試
 *
 * Source: GitHub Issue #5, AC-3
 * 測試 writeHarnessConfig() 寫入 worktree 路徑的行為。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QualityConfig } from "@devap/core";
import { generateHarnessHooks, writeHarnessConfig } from "./harness-config.js";

describe("writeHarnessConfig (AC-3)", () => {
  let worktreeDir: string;
  let mainRepoDir: string;

  beforeEach(async () => {
    worktreeDir = await mkdtemp(join(tmpdir(), "devap-wt-"));
    mainRepoDir = await mkdtemp(join(tmpdir(), "devap-main-"));
  });

  afterEach(async () => {
    await rm(worktreeDir, { recursive: true, force: true });
    await rm(mainRepoDir, { recursive: true, force: true });
  });

  const strictConfig: QualityConfig = {
    verify: true,
    lint_command: "pnpm lint",
    type_check_command: "pnpm tsc --noEmit",
    judge_policy: "always",
    max_retries: 3,
    max_retry_budget_usd: 5,
  };

  it("[AC-3] 應寫入 worktree 下的 .claude/settings.json", async () => {
    // [Derived] AC-3: 配置寫入 worktree 路徑
    const hooks = generateHarnessHooks(strictConfig);
    await writeHarnessConfig(hooks, worktreeDir);

    const settingsPath = join(worktreeDir, ".claude", "settings.json");
    const content = await readFile(settingsPath, "utf-8");
    const settings = JSON.parse(content);

    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
  });

  it("[AC-3] 不應影響主 repo 的 .claude/settings.json", async () => {
    // [Derived] AC-3: 主 repo 不受影響
    // 在主 repo 建立既有 settings
    await mkdir(join(mainRepoDir, ".claude"), { recursive: true });
    const originalSettings = JSON.stringify({ theme: "dark" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(mainRepoDir, ".claude", "settings.json"), originalSettings);

    // 寫入 worktree
    const hooks = generateHarnessHooks(strictConfig);
    await writeHarnessConfig(hooks, worktreeDir);

    // 驗證主 repo 未被修改
    const mainContent = await readFile(join(mainRepoDir, ".claude", "settings.json"), "utf-8");
    expect(mainContent).toBe(originalSettings);
  });

  it("[AC-3] 無 hooks 時不建立 settings.json", async () => {
    // [Derived] AC-3 邊界：無 hooks → 不寫入
    const noneConfig: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 0,
      max_retry_budget_usd: 0,
    };
    const hooks = generateHarnessHooks(noneConfig);
    await writeHarnessConfig(hooks, worktreeDir);

    const { access } = await import("node:fs/promises");
    await expect(
      access(join(worktreeDir, ".claude", "settings.json")),
    ).rejects.toThrow();
  });
});
