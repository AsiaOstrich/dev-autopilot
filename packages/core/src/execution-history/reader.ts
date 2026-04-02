/**
 * HistoryReader（SPEC-008 REQ-004）
 *
 * L1/L2/L3 分層讀取 API，供 agent 或外部工具查詢執行歷史。
 */

import type { StorageBackend, HistoryIndex, TaskManifest } from "./types.js";

/**
 * 執行歷史讀取器
 */
export class HistoryReader {
  private readonly backend: StorageBackend;

  constructor(backend: StorageBackend) {
    this.backend = backend;
  }

  /** L1: 讀取全域 index */
  async readIndex(): Promise<HistoryIndex | null> {
    const raw = await this.backend.readFile("index.json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as HistoryIndex;
    } catch {
      return null;
    }
  }

  /** L2: 讀取 task manifest */
  async readTaskManifest(taskId: string): Promise<TaskManifest | null> {
    const raw = await this.backend.readFile(`${taskId}/manifest.json`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TaskManifest;
    } catch {
      return null;
    }
  }

  /** L3: 讀取 artifact 原始內容 */
  async readArtifact(taskId: string, runNumber: string, artifactId: string): Promise<string | null> {
    return this.backend.readFile(`${taskId}/${runNumber}/${artifactId}`);
  }
}
