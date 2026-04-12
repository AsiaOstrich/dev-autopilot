/**
 * StorageRetentionManager（SPEC-013 REQ-013-004）
 *
 * 超過 max_runs_per_task 時，刪除最舊 run 的 L3 artifacts 目錄，
 * 保留 L1/L2 索引（manifest.json, index.json）。
 *
 * 與 SPEC-008 RetentionManager 的差異：
 *   - 本類別不處理 archive（由 ManifestManager 負責）
 *   - 僅關注 L3 artifact 的物理清理
 *   - 使用 policy 參數而非完整 RetentionConfig（可 Partial）
 */

import type { StorageBackend, ManifestL2, RetentionPolicy } from "./types.js";

const DEFAULT_MAX_RUNS = 50;

/**
 * L3 artifact 保留策略執行器（SPEC-013）
 */
export class StorageRetentionManager {
  private readonly maxRunsPerTask: number;

  constructor(
    private readonly backend: StorageBackend,
    policy?: Partial<RetentionPolicy>,
  ) {
    this.maxRunsPerTask = policy?.max_runs_per_task ?? DEFAULT_MAX_RUNS;
  }

  /**
   * 檢查 taskId 的 run 數是否超過上限，若超過則刪除最舊 run 的 L3 目錄。
   *
   * 保留 L2 manifest.json（run_history 記錄永久保留）。
   * 保留 L1 index.json（由 ManifestManager 管理）。
   *
   * @param taskId 要檢查的 task 識別碼
   */
  async enforce(taskId: string): Promise<void> {
    const raw = await this.backend.readFile(`${taskId}/manifest.json`);
    if (!raw) return;

    let manifest: ManifestL2;
    try {
      manifest = JSON.parse(raw) as ManifestL2;
    } catch {
      return;
    }

    const excess = manifest.run_history.length - this.maxRunsPerTask;
    if (excess <= 0) return;

    // 刪除最舊 runs 的 L3 目錄（run_history 按寫入順序排列，最舊在前）
    const toDelete = manifest.run_history.slice(0, excess);
    for (const run of toDelete) {
      await this.backend.deleteDir(`${taskId}/${run.run}`);
    }
  }
}
