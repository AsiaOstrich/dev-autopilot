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

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
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
});
