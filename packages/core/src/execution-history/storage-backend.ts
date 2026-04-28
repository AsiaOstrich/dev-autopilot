/**
 * Storage Backend（SPEC-008 REQ-007, SPEC-012）
 *
 * 儲存後端介面 + LocalStorageBackend + FileServerStorageBackend 實作。
 * 所有路徑相對於 basePath 解析，防止路徑穿越攻擊。
 */

import { readFile, writeFile, rm, readdir, access, mkdir, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import type { StorageBackend } from "./types.js";
import type { TelemetryUploader } from "asiaostrich-telemetry-client";

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

  /** 解析相對路徑並防止路徑穿越（internal） */
  resolvePath(path: string): string {
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

/**
 * 遠端遙測儲存後端（SPEC-012）
 *
 * 委派本地檔案操作給 LocalStorageBackend，
 * 並在 orchestrator 完成後提供 L1 index snapshot 上傳能力。
 * 透過 TelemetryUploader 與 AsiaOstrich 遙測伺服器溝通。
 */
export class FileServerStorageBackend implements StorageBackend {
  /**
   * @param local - 委派的本地儲存後端
   * @param uploader - 遙測上傳器（asiaostrich-telemetry-client）
   */
  constructor(
    private readonly local: LocalStorageBackend,
    readonly uploader: TelemetryUploader,
  ) {}

  readFile(path: string): Promise<string | null> {
    return this.local.readFile(path);
  }

  writeFile(path: string, content: string): Promise<void> {
    return this.local.writeFile(path, content);
  }

  deleteFile(path: string): Promise<void> {
    return this.local.deleteFile(path);
  }

  deleteDir(path: string): Promise<void> {
    return this.local.deleteDir(path);
  }

  listDir(path: string): Promise<string[]> {
    return this.local.listDir(path);
  }

  exists(path: string): Promise<boolean> {
    return this.local.exists(path);
  }

  /**
   * 上傳 L1 index snapshot 到遙測伺服器。
   *
   * 讀取本地 `index.json`，若存在則上傳。
   * index.json 不存在時靜默跳過（不拋錯）。
   */
  async uploadIndexSnapshot(): Promise<void> {
    const indexContent = await this.local.readFile("index.json");
    if (!indexContent) return;
    let index: unknown;
    try {
      index = JSON.parse(indexContent);
    } catch {
      return;
    }
    await this.uploader.upload({
      type: "l1_index_snapshot",
      source: "devap",
      content: index,
      timestamp: new Date().toISOString(),
    });
  }
}
