/**
 * DiffCapture 單元測試（SPEC-008 Phase 2, AC-P2-4, AC-P2-6）
 *
 * [Source] REQ-002: code-diff.patch 來自 task 執行前後的 git diff
 * [Source] Test Plan: git repo 中正確捕獲 diff、非 git repo 回傳空字串
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DiffCapture } from "../../execution-history/diff-capture.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("DiffCapture", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "devap-diff-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ============================================================
  // AC-P2-4: git repo 中正確捕獲 diff
  // ============================================================

  describe("[AC-P2-4] git repo 中捕獲 diff", () => {
    it("[Derived] capture() 前後有變更時應回傳 unified diff", async () => {
      // Arrange: 初始化 git repo + 建立初始 commit
      await execFileAsync("git", ["init"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.name", "test"], { cwd: tempDir });
      await writeFile(join(tempDir, "file.txt"), "initial");
      await execFileAsync("git", ["add", "."], { cwd: tempDir });
      await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });

      // Act: start capture → 修改檔案 → end capture
      const capture = new DiffCapture(tempDir);
      await capture.start();
      await writeFile(join(tempDir, "file.txt"), "modified");
      const diff = await capture.end();

      // Assert
      expect(diff).toContain("file.txt");
      expect(diff).toContain("-initial");
      expect(diff).toContain("+modified");
    });

    it("[Derived] capture() 無變更時應回傳空字串", async () => {
      await execFileAsync("git", ["init"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.name", "test"], { cwd: tempDir });
      await writeFile(join(tempDir, "file.txt"), "content");
      await execFileAsync("git", ["add", "."], { cwd: tempDir });
      await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });

      const capture = new DiffCapture(tempDir);
      await capture.start();
      // 不做任何修改
      const diff = await capture.end();

      expect(diff).toBe("");
    });

    it("[Derived] capture() 應包含新增檔案的 diff", async () => {
      await execFileAsync("git", ["init"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.name", "test"], { cwd: tempDir });
      await writeFile(join(tempDir, "existing.txt"), "data");
      await execFileAsync("git", ["add", "."], { cwd: tempDir });
      await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });

      const capture = new DiffCapture(tempDir);
      await capture.start();
      await writeFile(join(tempDir, "new-file.txt"), "new content");
      const diff = await capture.end();

      expect(diff).toContain("new-file.txt");
    });
  });

  // ============================================================
  // AC-P2-6: 非 git repo 回傳空字串
  // ============================================================

  describe("[AC-P2-6] 非 git repo", () => {
    it("[Derived] 非 git repo 的 start() 不應拋錯", async () => {
      const capture = new DiffCapture(tempDir);
      await expect(capture.start()).resolves.not.toThrow();
    });

    it("[Derived] 非 git repo 的 end() 應回傳空字串", async () => {
      const capture = new DiffCapture(tempDir);
      await capture.start();
      const diff = await capture.end();
      expect(diff).toBe("");
    });
  });
});
