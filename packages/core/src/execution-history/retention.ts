/**
 * RetentionManager（SPEC-008 REQ-006）
 *
 * 自動清理超過保留上限的歷史，避免磁碟空間膨脹。
 * - max_runs_per_task: 超過時刪除最舊 run 的 L3 artifacts（L1/L2 索引保留）
 * - archive_threshold_days: 超過時將 task 從 index 移至 index-archive
 * - reactivate: 已歸檔 task 有新 run 時移回 index
 */

import type { StorageBackend, RetentionConfig, HistoryIndex, TaskManifest } from "./types.js";

/**
 * 歷史保留管理器
 */
export class RetentionManager {
  private readonly backend: StorageBackend;
  private readonly config: RetentionConfig;

  constructor(backend: StorageBackend, config: RetentionConfig) {
    this.backend = backend;
    this.config = config;
  }

  /** 清理指定 task 超過 max_runs 的舊 runs（刪 L3，保留 L1/L2） */
  async cleanupTask(taskId: string): Promise<void> {
    const raw = await this.backend.readFile(`${taskId}/manifest.json`);
    if (!raw) return;

    let manifest: TaskManifest;
    try {
      manifest = JSON.parse(raw) as TaskManifest;
    } catch {
      return;
    }

    const excess = manifest.run_history.length - this.config.max_runs_per_task;
    if (excess <= 0) return;

    // 刪除最舊的 runs（L3 artifacts 目錄）
    const toDelete = manifest.run_history.slice(0, excess);
    for (const run of toDelete) {
      await this.backend.deleteDir(`${taskId}/${run.run}`);
    }
  }

  /** 歸檔超過 archive_threshold_days 的 stale tasks */
  async archiveStaleTasks(): Promise<void> {
    const indexRaw = await this.backend.readFile("index.json");
    if (!indexRaw) return;

    let index: HistoryIndex;
    try {
      index = JSON.parse(indexRaw) as HistoryIndex;
    } catch {
      return;
    }

    const now = Date.now();
    const thresholdMs = this.config.archive_threshold_days * 24 * 60 * 60 * 1000;

    const stale = index.tasks.filter(t => {
      const lastDate = new Date(t.latest_date).getTime();
      return now - lastDate > thresholdMs;
    });

    if (stale.length === 0) return;

    // 讀取現有 archive
    const archiveRaw = await this.backend.readFile("index-archive.json");
    let archive: HistoryIndex;
    try {
      archive = archiveRaw ? JSON.parse(archiveRaw) as HistoryIndex : this.emptyIndex();
    } catch {
      archive = this.emptyIndex();
    }

    // 移動 stale tasks 到 archive
    archive.tasks.push(...stale);
    archive.updated = new Date().toISOString();

    // 從 index 移除 stale tasks
    const staleIds = new Set(stale.map(t => t.task_id));
    index.tasks = index.tasks.filter(t => !staleIds.has(t.task_id));
    index.updated = new Date().toISOString();

    await this.backend.writeFile("index.json", JSON.stringify(index, null, 2));
    await this.backend.writeFile("index-archive.json", JSON.stringify(archive, null, 2));
  }

  /** 從歸檔移回活躍 index */
  async reactivateTask(taskId: string): Promise<void> {
    const archiveRaw = await this.backend.readFile("index-archive.json");
    if (!archiveRaw) return;

    let archive: HistoryIndex;
    try {
      archive = JSON.parse(archiveRaw) as HistoryIndex;
    } catch {
      return;
    }

    const task = archive.tasks.find(t => t.task_id === taskId);
    if (!task) return;

    // 從 archive 移除
    archive.tasks = archive.tasks.filter(t => t.task_id !== taskId);
    archive.updated = new Date().toISOString();

    // 加入 index
    const indexRaw = await this.backend.readFile("index.json");
    let index: HistoryIndex;
    try {
      index = indexRaw ? JSON.parse(indexRaw) as HistoryIndex : this.emptyIndex();
    } catch {
      index = this.emptyIndex();
    }

    index.tasks.push(task);
    index.updated = new Date().toISOString();

    await this.backend.writeFile("index.json", JSON.stringify(index, null, 2));
    await this.backend.writeFile("index-archive.json", JSON.stringify(archive, null, 2));
  }

  private emptyIndex(): HistoryIndex {
    return {
      version: "1.0.0",
      updated: new Date().toISOString(),
      max_active_tasks: 50,
      archive_threshold_days: this.config.archive_threshold_days,
      tasks: [],
    };
  }
}
