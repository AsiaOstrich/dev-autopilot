/**
 * Git Worktree 管理器
 *
 * 為並行任務建立/合併/清理 git worktree。
 * 每個 task 在獨立的 worktree 中執行，完成後 merge 回主分支。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";

const execFileAsync = promisify(execFile);

/** Worktree 資訊 */
export interface WorktreeInfo {
  /** Task ID */
  taskId: string;
  /** Worktree 路徑 */
  path: string;
  /** 分支名稱 */
  branch: string;
}

/**
 * Git Worktree 管理器
 *
 * 生命週期：
 * 1. create() → 建立 worktree + 分支
 * 2. （外部執行 task）
 * 3. merge() → 合併分支回主分支
 * 4. cleanup() → 移除 worktree + 刪除分支
 */
export class WorktreeManager {
  /** 專案根目錄 */
  private readonly rootDir: string;
  /** worktree 存放目錄 */
  private readonly worktreeDir: string;
  /** 已建立的 worktree 記錄 */
  private readonly worktrees = new Map<string, WorktreeInfo>();

  /**
   * @param rootDir - 專案根目錄（git repo 所在位置）
   */
  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.worktreeDir = join(rootDir, ".devap", "worktrees");
  }

  /**
   * 為指定 task 建立 git worktree
   *
   * @param taskId - Task ID（如 T-001）
   * @returns worktree 資訊
   */
  async create(taskId: string): Promise<WorktreeInfo> {
    const branch = `autopilot/${taskId}`;
    const worktreePath = join(this.worktreeDir, taskId);

    // 確保 worktree 目錄存在
    await mkdir(this.worktreeDir, { recursive: true });

    // 建立 worktree + 新分支
    await this.git(["worktree", "add", worktreePath, "-b", branch]);

    const info: WorktreeInfo = {
      taskId,
      path: worktreePath,
      branch,
    };
    this.worktrees.set(taskId, info);

    return info;
  }

  /**
   * 將 task 分支合併回主分支
   *
   * @param taskId - Task ID
   * @throws 若合併失敗（衝突等）
   */
  async merge(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId);
    if (!info) {
      throw new Error(`找不到 Task ${taskId} 的 worktree 記錄`);
    }

    // 取得當前分支名稱
    const { stdout: currentBranch } = await this.git([
      "rev-parse", "--abbrev-ref", "HEAD",
    ]);

    // 合併 task 分支
    await this.git(["merge", info.branch, "--no-ff", "-m", `merge: ${taskId} autopilot task`]);
  }

  /**
   * 清理指定 task 的 worktree 和分支
   *
   * @param taskId - Task ID
   */
  async cleanup(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId);
    if (!info) return;

    try {
      // 移除 worktree
      await this.git(["worktree", "remove", info.path, "--force"]);
    } catch {
      // worktree 可能已被手動移除，嘗試 prune
      await this.git(["worktree", "prune"]).catch(() => {});
    }

    try {
      // 刪除分支
      await this.git(["branch", "-d", info.branch]);
    } catch {
      // 分支可能未完全合併，強制刪除
      await this.git(["branch", "-D", info.branch]).catch(() => {});
    }

    this.worktrees.delete(taskId);
  }

  /**
   * 清理所有已建立的 worktree
   */
  async cleanupAll(): Promise<void> {
    const taskIds = [...this.worktrees.keys()];
    for (const taskId of taskIds) {
      await this.cleanup(taskId);
    }
  }

  /**
   * 取得指定 task 的 worktree 資訊
   */
  getWorktree(taskId: string): WorktreeInfo | undefined {
    return this.worktrees.get(taskId);
  }

  /**
   * 執行 git 指令
   */
  private git(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, { cwd: this.rootDir });
  }
}
