/**
 * WorktreeManager 測試
 *
 * 測試 worktree 管理的核心邏輯，使用 mock 避免實際操作 git。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorktreeManager, type WorktreeInfo } from "./worktree-manager.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
    if (typeof _opts === "function") {
      cb = _opts;
    }
    // 模擬成功的 git 指令
    if (cb) {
      cb(null, { stdout: "main\n", stderr: "" });
    }
    return { stdout: "main\n", stderr: "" };
  }),
}));

// Mock fs/promises — 追蹤寫入呼叫
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockWriteFile = vi.fn(async (..._args: any[]) => {});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockMkdir = vi.fn(async (..._args: any[]) => {});
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn((...args: any[]) => mockMkdir(...args)),
  rm: vi.fn(async () => {}),
  writeFile: vi.fn((...args: any[]) => mockWriteFile(...args)),
  readFile: vi.fn(async () => ""),
  appendFile: vi.fn(async () => {}),
}));

describe("WorktreeManager", () => {
  let manager: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorktreeManager("/tmp/test-project");
  });

  it("應正確初始化", () => {
    expect(manager).toBeDefined();
  });

  it("create 應建立正確的 worktree 資訊", async () => {
    const info = await manager.create("T-001");

    expect(info.taskId).toBe("T-001");
    expect(info.branch).toBe("autopilot/T-001");
    expect(info.path).toContain("T-001");
    expect(info.path).toContain(".devap/worktrees");
  });

  it("getWorktree 應回傳已建立的 worktree", async () => {
    await manager.create("T-001");
    const info = manager.getWorktree("T-001");

    expect(info).toBeDefined();
    expect(info!.taskId).toBe("T-001");
  });

  it("getWorktree 應回傳 undefined 對未建立的 task", () => {
    const info = manager.getWorktree("T-999");
    expect(info).toBeUndefined();
  });

  it("merge 應拒絕不存在的 worktree", async () => {
    await expect(manager.merge("T-999")).rejects.toThrow("找不到 Task T-999");
  });

  it("cleanup 應安靜處理不存在的 worktree", async () => {
    // 不應拋出錯誤
    await manager.cleanup("T-999");
  });

  it("cleanup 應從記錄中移除 worktree", async () => {
    await manager.create("T-001");
    expect(manager.getWorktree("T-001")).toBeDefined();

    await manager.cleanup("T-001");
    expect(manager.getWorktree("T-001")).toBeUndefined();
  });

  it("cleanupAll 應清理所有 worktree", async () => {
    await manager.create("T-001");
    await manager.create("T-002");

    expect(manager.getWorktree("T-001")).toBeDefined();
    expect(manager.getWorktree("T-002")).toBeDefined();

    await manager.cleanupAll();

    expect(manager.getWorktree("T-001")).toBeUndefined();
    expect(manager.getWorktree("T-002")).toBeUndefined();
  });

  // ============================================================
  // Issue #6: 並行 Task Worktree 環境配置增強
  // Source: GitHub Issue #6, AC-1 ~ AC-3
  // ============================================================

  describe("setupTaskEnvironment (AC-1)", () => {
    it("[AC-1] 應將 CLAUDE.md 寫入 worktree 路徑", async () => {
      // [Derived] AC-1: worktree 中有獨立 CLAUDE.md
      const info = await manager.create("T-001");
      await manager.setupTaskEnvironment("T-001", "# Task: T-001 prompt");

      // 驗證 writeFile 被呼叫，寫入 worktree 路徑下的 CLAUDE.md
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        "# Task: T-001 prompt",
        "utf-8",
      );
      // 路徑應在 worktree 目錄中
      const writeCall = mockWriteFile.mock.calls.find(
        (call) => typeof call[0] === "string" && String(call[0]).includes("CLAUDE.md"),
      );
      expect(writeCall).toBeDefined();
      expect(String(writeCall![0])).toContain(info.path);
    });

    it("[AC-1] 2 個並行 task 各自有獨立 CLAUDE.md", async () => {
      // [Derived] AC-1: 並行 task 獨立環境
      const info1 = await manager.create("T-001");
      const info2 = await manager.create("T-002");

      await manager.setupTaskEnvironment("T-001", "# Prompt for T-001");
      await manager.setupTaskEnvironment("T-002", "# Prompt for T-002");

      // 應有兩次寫入 CLAUDE.md 的呼叫
      const claudeMdWrites = mockWriteFile.mock.calls.filter(
        (call) => typeof call[0] === "string" && String(call[0]).includes("CLAUDE.md"),
      );
      expect(claudeMdWrites.length).toBe(2);

      // 內容不同
      const contents = claudeMdWrites.map((call: unknown[]) => call[1]);
      expect(contents[0]).not.toBe(contents[1]);

      // 路徑不同
      const paths = claudeMdWrites.map((call: unknown[]) => call[0]);
      expect(paths[0]).not.toBe(paths[1]);
    });

    it("[AC-1] 傳入 hooksConfig 時應寫入 .claude/settings.json", async () => {
      // [Derived] AC-1: hooks 配置也寫入 worktree
      const info = await manager.create("T-001");
      const hooksConfig = {
        hooks: {
          PostToolUse: [
            { matcher: "Write|Edit", hooks: [{ type: "command" as const, command: "pnpm lint" }] },
          ],
        },
      };
      await manager.setupTaskEnvironment("T-001", "# Prompt", hooksConfig);

      // 應建立 .claude 目錄
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining(".claude"),
        expect.objectContaining({ recursive: true }),
      );

      // 應寫入 settings.json
      const settingsWrites = mockWriteFile.mock.calls.filter(
        (call) => typeof call[0] === "string" && String(call[0]).includes("settings.json"),
      );
      expect(settingsWrites.length).toBe(1);
      const settingsPath = String(settingsWrites[0][0]);
      expect(settingsPath).toContain(info.path);
    });

    it("[AC-1] 無 hooksConfig 時不寫入 settings.json", async () => {
      // [Derived] AC-1 邊界：無 hooks
      await manager.create("T-001");
      await manager.setupTaskEnvironment("T-001", "# Prompt");

      const settingsWrites = mockWriteFile.mock.calls.filter(
        (call) => typeof call[0] === "string" && String(call[0]).includes("settings.json"),
      );
      expect(settingsWrites.length).toBe(0);
    });

    it("[AC-1] 對不存在的 worktree 應拋出錯誤", async () => {
      // [Derived] AC-1 錯誤處理
      await expect(
        manager.setupTaskEnvironment("T-999", "# Prompt"),
      ).rejects.toThrow("找不到 Task T-999");
    });
  });

  describe("cleanup 環境清理 (AC-2)", () => {
    it("[AC-2] cleanup 後 worktree 記錄被移除", async () => {
      // [Derived] AC-2: 清理後無殘留記錄
      await manager.create("T-001");
      await manager.setupTaskEnvironment("T-001", "# Prompt");
      await manager.cleanup("T-001");

      expect(manager.getWorktree("T-001")).toBeUndefined();
    });
  });

  // AC-3: 既有 8 個測試已在上方覆蓋 regression 驗證
});
