/**
 * LocalStorageBackend 單元測試（SPEC-008 REQ-007）
 *
 * 17 個測試：writeFile、readFile、deleteFile、deleteDir、listDir、exists、路徑安全。
 * 使用真實 temp 目錄。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LocalStorageBackend } from "../../execution-history/storage-backend.js";
import { mkdtemp, rm, readFile as fsReadFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("LocalStorageBackend", () => {
  let tempDir: string;
  let backend: LocalStorageBackend;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "devap-storage-test-"));
    backend = new LocalStorageBackend(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ============================================================
  // writeFile
  // ============================================================

  describe("writeFile", () => {
    it("應建立檔案並寫入內容", async () => {
      await backend.writeFile("test.txt", "hello");
      const content = await fsReadFile(join(tempDir, "test.txt"), "utf-8");
      expect(content).toBe("hello");
    });

    it("應自動建立不存在的父目錄", async () => {
      await backend.writeFile("a/b/c/test.txt", "nested");
      const content = await fsReadFile(join(tempDir, "a/b/c/test.txt"), "utf-8");
      expect(content).toBe("nested");
    });

    it("應覆寫已存在的檔案", async () => {
      await backend.writeFile("file.txt", "old");
      await backend.writeFile("file.txt", "new");
      const content = await fsReadFile(join(tempDir, "file.txt"), "utf-8");
      expect(content).toBe("new");
    });

    it("應正確處理 UTF-8 內容", async () => {
      const text = "繁體中文測試 🎉 日本語テスト";
      await backend.writeFile("utf8.txt", text);
      const content = await fsReadFile(join(tempDir, "utf8.txt"), "utf-8");
      expect(content).toBe(text);
    });

    it("應正確寫入空字串", async () => {
      await backend.writeFile("empty.txt", "");
      const content = await fsReadFile(join(tempDir, "empty.txt"), "utf-8");
      expect(content).toBe("");
    });
  });

  // ============================================================
  // readFile
  // ============================================================

  describe("readFile", () => {
    it("應回傳已寫入檔案的內容", async () => {
      await backend.writeFile("data.txt", "content");
      const result = await backend.readFile("data.txt");
      expect(result).toBe("content");
    });

    it("檔案不存在時應回傳 null", async () => {
      const result = await backend.readFile("nonexistent.txt");
      expect(result).toBeNull();
    });

    it("路徑為目錄時應回傳 null", async () => {
      await mkdir(join(tempDir, "some-dir"), { recursive: true });
      const result = await backend.readFile("some-dir");
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // deleteFile
  // ============================================================

  describe("deleteFile", () => {
    it("應刪除存在的檔案", async () => {
      await backend.writeFile("to-delete.txt", "bye");
      await backend.deleteFile("to-delete.txt");
      const exists = await backend.exists("to-delete.txt");
      expect(exists).toBe(false);
    });

    it("刪除不存在的檔案不應拋出錯誤", async () => {
      await expect(backend.deleteFile("ghost.txt")).resolves.not.toThrow();
    });
  });

  // ============================================================
  // deleteDir
  // ============================================================

  describe("deleteDir", () => {
    it("應遞迴刪除目錄及其內容", async () => {
      await backend.writeFile("dir/a.txt", "a");
      await backend.writeFile("dir/sub/b.txt", "b");
      await backend.deleteDir("dir");
      const exists = await backend.exists("dir");
      expect(exists).toBe(false);
    });

    it("刪除不存在的目錄不應拋出錯誤", async () => {
      await expect(backend.deleteDir("ghost-dir")).resolves.not.toThrow();
    });
  });

  // ============================================================
  // listDir
  // ============================================================

  describe("listDir", () => {
    it("應列出目錄中的所有項目", async () => {
      await backend.writeFile("dir/a.txt", "a");
      await backend.writeFile("dir/b.txt", "b");
      const entries = await backend.listDir("dir");
      expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
    });

    it("應包含子目錄名稱", async () => {
      await backend.writeFile("dir/sub/file.txt", "data");
      const entries = await backend.listDir("dir");
      expect(entries).toContain("sub");
    });

    it("空目錄應回傳空陣列", async () => {
      await mkdir(join(tempDir, "empty-dir"), { recursive: true });
      const entries = await backend.listDir("empty-dir");
      expect(entries).toEqual([]);
    });

    it("目錄不存在時應回傳空陣列", async () => {
      const entries = await backend.listDir("nonexistent");
      expect(entries).toEqual([]);
    });
  });

  // ============================================================
  // exists
  // ============================================================

  describe("exists", () => {
    it("存在的檔案應回傳 true", async () => {
      await backend.writeFile("exists.txt", "yes");
      expect(await backend.exists("exists.txt")).toBe(true);
    });

    it("存在的目錄應回傳 true", async () => {
      await backend.writeFile("dir/file.txt", "data");
      expect(await backend.exists("dir")).toBe(true);
    });

    it("不存在的路徑應回傳 false", async () => {
      expect(await backend.exists("nope.txt")).toBe(false);
    });
  });

  // ============================================================
  // 路徑安全性
  // ============================================================

  describe("路徑安全性", () => {
    it("應基於 basePath 解析所有路徑", async () => {
      await backend.writeFile("test.txt", "data");
      const content = await fsReadFile(join(tempDir, "test.txt"), "utf-8");
      expect(content).toBe("data");
    });

    it("應防止路徑穿越攻擊（../）", async () => {
      await expect(backend.writeFile("../escape.txt", "bad")).rejects.toThrow();
    });
  });
});
