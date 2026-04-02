/**
 * Storage Backend（SPEC-008 REQ-007）
 *
 * 儲存後端介面 + LocalStorageBackend 實作。
 * 所有路徑相對於 basePath 解析，防止路徑穿越攻擊。
 */

import { readFile, writeFile, rm, readdir, access, mkdir, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import type { StorageBackend } from "./types.js";

/**
 * 本地檔案系統儲存後端
 */
export class LocalStorageBackend implements StorageBackend {
  readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = resolve(basePath);
  }

  async readFile(path: string): Promise<string | null> {
    const fullPath = this.resolvePath(path);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) return null;
      return await readFile(fullPath, "utf-8");
    } catch {
      return null;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  async deleteFile(path: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    try {
      await rm(fullPath);
    } catch {
      // 不存在時不拋錯
    }
  }

  async deleteDir(path: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    try {
      await rm(fullPath, { recursive: true, force: true });
    } catch {
      // 不存在時不拋錯
    }
  }

  async listDir(path: string): Promise<string[]> {
    const fullPath = this.resolvePath(path);
    try {
      return await readdir(fullPath);
    } catch {
      return [];
    }
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path);
    try {
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /** 解析相對路徑並防止路徑穿越 */
  private resolvePath(path: string): string {
    const fullPath = resolve(this.basePath, path);
    const rel = relative(this.basePath, fullPath);
    if (rel.startsWith("..") || resolve(fullPath) !== fullPath && rel.startsWith("..")) {
      throw new Error(`路徑穿越攻擊：${path} 解析到 basePath 之外`);
    }
    // 額外檢查：確保 fullPath 以 basePath 開頭
    if (!fullPath.startsWith(this.basePath)) {
      throw new Error(`路徑穿越攻擊：${path} 解析到 basePath 之外`);
    }
    return fullPath;
  }
}
