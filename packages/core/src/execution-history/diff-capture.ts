/**
 * DiffCapture（SPEC-008 Phase 2）
 *
 * 捕獲 task 執行前後的 git diff。
 * 非 git repo 中安靜回傳空字串（不拋錯）。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Git diff 捕獲器
 */
export class DiffCapture {
  private readonly cwd: string;
  private startSha: string | null = null;
  private isGitRepo = false;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** 記錄起始點（git HEAD 的 SHA） */
  async start(): Promise<void> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: this.cwd });
      this.startSha = stdout.trim();
      this.isGitRepo = true;
    } catch {
      // 非 git repo，靜默處理
      this.isGitRepo = false;
      this.startSha = null;
    }
  }

  /** 計算起始點到目前的 diff（含 staged、unstaged 和新增檔案） */
  async end(): Promise<string> {
    if (!this.isGitRepo) return "";

    try {
      const parts: string[] = [];

      // tracked files diff（staged + unstaged）
      const { stdout: trackedDiff } = await execFileAsync(
        "git", ["diff", this.startSha ?? "HEAD"],
        { cwd: this.cwd },
      );
      if (trackedDiff) parts.push(trackedDiff);

      // untracked files（新增檔案）— 產生 pseudo diff
      const { stdout: untrackedRaw } = await execFileAsync(
        "git", ["ls-files", "--others", "--exclude-standard"],
        { cwd: this.cwd },
      );
      const untrackedFiles = untrackedRaw.trim().split("\n").filter(Boolean);
      for (const file of untrackedFiles) {
        try {
          const { stdout: content } = await execFileAsync(
            "git", ["diff", "--no-index", "/dev/null", file],
            { cwd: this.cwd },
          );
          if (content) parts.push(content);
        } catch (err: unknown) {
          // git diff --no-index exits with 1 when files differ, which is expected
          const e = err as { stdout?: string };
          if (e.stdout) parts.push(e.stdout);
        }
      }

      return parts.join("\n");
    } catch {
      return "";
    }
  }
}
