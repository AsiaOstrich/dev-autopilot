/**
 * AccessReader（SPEC-013 REQ-013-003）
 *
 * 提供 L1/L2/L3 分層讀取 API：
 *   - readL1(): IndexJson          ← index.json（最多 50 活躍 tasks）
 *   - readL2(taskId): ManifestL2   ← {taskId}/manifest.json
 *   - readL3(taskId, run, artifactId): string ← {taskId}/{run}/{artifactId}.*
 *
 * 所有方法在找不到檔案時回傳 null，不拋錯。
 */

import type { StorageBackend, HistoryIndex, ManifestL2, ArtifactType } from "./types.js";

/** artifact 類型 → 副檔名（與 ArtifactWriter 保持一致） */
const ARTIFACT_EXTENSIONS: Record<ArtifactType, string> = {
  "task-description": "md",
  "code-diff": "patch",
  "test-results": "json",
  "execution-log": "jsonl",
  "token-usage": "json",
  "final-status": "json",
  "error-analysis": "md",
  "agent-reasoning": "md",
};

/**
 * 執行歷史分層讀取器（SPEC-013）
 */
export class AccessReader {
  constructor(private readonly backend: StorageBackend) {}

  /**
   * L1: 讀取全域活躍 task 索引。
   * 若 index.json 不存在或解析失敗，回傳 null。
   */
  async readL1(): Promise<HistoryIndex | null> {
    const raw = await this.backend.readFile("index.json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as HistoryIndex;
    } catch {
      return null;
    }
  }

  /**
   * L2: 讀取指定 task 的 manifest.json。
   * 若不存在或解析失敗，回傳 null。
   */
  async readL2(taskId: string): Promise<ManifestL2 | null> {
    const raw = await this.backend.readFile(`${taskId}/manifest.json`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ManifestL2;
    } catch {
      return null;
    }
  }

  /**
   * L3: 讀取指定 task / run / artifact 的原始內容。
   *
   * @param taskId     task 識別碼
   * @param run        三位數字字串，如 "001"
   * @param artifactId artifact 類型（ArtifactType）
   * @returns 原始字串內容，不存在時回傳 null
   */
  async readL3(taskId: string, run: string, artifactId: ArtifactType): Promise<string | null> {
    const ext = ARTIFACT_EXTENSIONS[artifactId] ?? "txt";
    return this.backend.readFile(`${taskId}/${run}/${artifactId}.${ext}`);
  }
}
