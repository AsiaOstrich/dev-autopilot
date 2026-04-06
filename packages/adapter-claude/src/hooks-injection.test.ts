/**
 * SPEC-009: Harness Hooks Configuration Injection — TDD 骨架
 *
 * [Generated] 由 /derive tdd 從 SPEC-009 AC 推演
 * Source: specs/SPEC-009-harness-hooks-injection.md
 *
 * 測試 ClaudeAdapter.executeTask() 的 hooks 配置注入與清理行為。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task, ExecuteOptions, QualityConfig } from "@devap/core";

// Mock claude-agent-sdk
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock harness-config 模組以追蹤呼叫
const mockWriteHarnessConfig = vi.fn();
const mockCleanupHarnessConfig = vi.fn();
vi.mock("./harness-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./harness-config.js")>();
  return {
    ...actual,
    writeHarnessConfig: (...args: unknown[]) => mockWriteHarnessConfig(...args),
    cleanupHarnessConfig: (...args: unknown[]) => mockCleanupHarnessConfig(...args),
  };
});

const { ClaudeAdapter } = await import("./claude-adapter.js");

/** 建立 async iterable 模擬 SDK stream */
function createStream(messages: Array<{ type: string; subtype?: string; [key: string]: unknown }>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

const successStream = () =>
  createStream([
    { type: "system", subtype: "init", session_id: "sess-009" },
    { type: "result", subtype: "success", session_id: "sess-009", total_cost_usd: 0.1, duration_ms: 100 },
  ]);

const baseTask: Task = {
  id: "T-001",
  title: "Test task",
  spec: "Do something",
  verify_command: "pnpm test",
};

const strictQuality: QualityConfig = {
  verify: true,
  lint_command: "pnpm lint",
  type_check_command: "pnpm tsc --noEmit",
  judge_policy: "always",
  max_retries: 2,
  max_retry_budget_usd: 2.0,
};

const noneQuality: QualityConfig = {
  verify: false,
  judge_policy: "never",
  max_retries: 0,
  max_retry_budget_usd: 0,
};

describe("SPEC-009: Harness Hooks Configuration Injection", () => {
  let adapter: InstanceType<typeof ClaudeAdapter>;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    mockQuery.mockReset();
    mockWriteHarnessConfig.mockReset();
    mockCleanupHarnessConfig.mockReset();
    mockQuery.mockReturnValue(successStream());
  });

  // ==========================================================
  // AC-1: executeTask 在 query() 前寫入 hooks 配置
  // ==========================================================

  describe("AC-1: executeTask 在 query() 前寫入 hooks 配置", () => {
    it("[AC-1] executeTask 有 qualityConfig 時應在 query 前呼叫 writeHarnessConfig", async () => {
      // [Derived] AC-1: strict quality → 寫入 settings.json
      // [TODO] 待 executeTask 實作 hooks 注入後啟用
      const options: ExecuteOptions = {
        cwd: "/tmp/wt-001",
        qualityConfig: strictQuality,
      };

      await adapter.executeTask(baseTask, options);

      expect(mockWriteHarnessConfig).toHaveBeenCalledTimes(1);
      // writeHarnessConfig 應在 query 前被呼叫
      const writeCallOrder = mockWriteHarnessConfig.mock.invocationCallOrder[0];
      const queryCallOrder = mockQuery.mock.invocationCallOrder[0];
      expect(writeCallOrder).toBeLessThan(queryCallOrder);
    });
  });

  // ==========================================================
  // AC-2: strict 模式生成 PostToolUse hooks
  // ==========================================================

  describe("AC-2: strict 模式生成 PostToolUse hooks", () => {
    it("[AC-2] strict 模式應將包含 PostToolUse hooks 的配置傳給 writeHarnessConfig", async () => {
      // [Derived] AC-2: strict quality → PostToolUse hooks 存在
      // [TODO] 待實作後驗證傳入的 config 物件包含 PostToolUse
      const options: ExecuteOptions = {
        cwd: "/tmp/wt-001",
        qualityConfig: strictQuality,
      };

      await adapter.executeTask(baseTask, options);

      const writtenConfig = mockWriteHarnessConfig.mock.calls[0]?.[0];
      expect(writtenConfig).toBeDefined();
      expect(writtenConfig.hooks?.PostToolUse).toBeDefined();
    });
  });

  // ==========================================================
  // AC-3: none 模式不生成 PostToolUse/Stop hooks
  // ==========================================================

  describe("AC-3: none 模式不生成 PostToolUse/Stop hooks", () => {
    it("[AC-3] none 模式不應生成 PostToolUse 和 Stop hooks", async () => {
      // [Derived] AC-3: quality: "none" → 僅 PreToolUse
      // [TODO] 待實作後驗證
      const options: ExecuteOptions = {
        cwd: "/tmp/wt-001",
        qualityConfig: noneQuality,
      };

      await adapter.executeTask(baseTask, options);

      const writtenConfig = mockWriteHarnessConfig.mock.calls[0]?.[0];
      // none 模式下 PreToolUse 始終存在（安全攔截）
      expect(writtenConfig?.hooks?.PreToolUse).toBeDefined();
      // 無 PostToolUse 和 Stop
      expect(writtenConfig?.hooks?.PostToolUse).toBeUndefined();
      expect(writtenConfig?.hooks?.Stop).toBeUndefined();
    });
  });

  // ==========================================================
  // AC-4: query() 完成後清理 settings.json
  // ==========================================================

  describe("AC-4: query() 完成後清理 hooks 配置", () => {
    it("[AC-4] query 正常完成後應呼叫 cleanupHarnessConfig", async () => {
      // [Derived] AC-4: 成功路徑 → 清理
      const options: ExecuteOptions = {
        cwd: "/tmp/wt-001",
        qualityConfig: strictQuality,
      };

      await adapter.executeTask(baseTask, options);

      expect(mockCleanupHarnessConfig).toHaveBeenCalledTimes(1);
      expect(mockCleanupHarnessConfig).toHaveBeenCalledWith("/tmp/wt-001");
    });

    it("[AC-4] query 拋錯後應仍呼叫 cleanupHarnessConfig（finally 保證）", async () => {
      // [Derived] AC-4: 異常路徑 → 仍清理
      mockQuery.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          throw new Error("SDK crash");
        },
      }));

      const options: ExecuteOptions = {
        cwd: "/tmp/wt-001",
        qualityConfig: strictQuality,
      };

      await adapter.executeTask(baseTask, options);

      expect(mockCleanupHarnessConfig).toHaveBeenCalledTimes(1);
      expect(mockCleanupHarnessConfig).toHaveBeenCalledWith("/tmp/wt-001");
    });
  });

  // ==========================================================
  // AC-5: ExecuteOptions 新增 qualityConfig 欄位
  // ==========================================================

  describe("AC-5: ExecuteOptions 接受 qualityConfig", () => {
    it("[AC-5] ExecuteOptions 應接受 qualityConfig 欄位（型別檢查）", () => {
      // [Derived] AC-5: 型別層面驗證
      // 此測試透過 TypeScript 編譯通過即為驗證
      const options: ExecuteOptions = {
        cwd: "/tmp/test",
        qualityConfig: strictQuality,
      };
      expect(options.qualityConfig).toBeDefined();
      expect(options.qualityConfig!.lint_command).toBe("pnpm lint");
    });
  });

  // ==========================================================
  // AC-8: 向後相容
  // ==========================================================

  describe("AC-8: 向後相容 — 不傳 qualityConfig 時行為不變", () => {
    it("[AC-8] 不傳 qualityConfig 時不應呼叫 writeHarnessConfig", async () => {
      // [Derived] AC-8: 無 qualityConfig → 不注入
      const options: ExecuteOptions = {
        cwd: "/tmp/wt-001",
      };

      await adapter.executeTask(baseTask, options);

      expect(mockWriteHarnessConfig).not.toHaveBeenCalled();
      expect(mockCleanupHarnessConfig).not.toHaveBeenCalled();
    });

    it("[AC-8] 不傳 qualityConfig 時 query 仍正常呼叫", async () => {
      // [Derived] AC-8: 既有行為不受影響
      const options: ExecuteOptions = {
        cwd: "/tmp/wt-001",
      };

      const result = await adapter.executeTask(baseTask, options);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("success");
    });
  });

  // ==========================================================
  // AC-9: hooks 配置不影響主 repo
  // ==========================================================

  describe("AC-9: hooks 配置僅寫入指定目錄", () => {
    it("[AC-9] writeHarnessConfig 應以 cwd 作為 targetDir", async () => {
      // [Derived] AC-9: 寫入路徑 = options.cwd
      const options: ExecuteOptions = {
        cwd: "/tmp/isolated-worktree",
        qualityConfig: strictQuality,
      };

      await adapter.executeTask(baseTask, options);

      const targetDir = mockWriteHarnessConfig.mock.calls[0]?.[1];
      expect(targetDir).toBe("/tmp/isolated-worktree");
    });
  });
});
