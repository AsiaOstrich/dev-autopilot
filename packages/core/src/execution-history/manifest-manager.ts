/**
 * ManifestManager（SPEC-013 REQ-013-002）
 *
 * 維護三層索引：
 *   - L2: {taskId}/manifest.json — 任務層級摘要與 run 歷史
 *   - L1: index.json — 最多 50 個活躍 tasks
 *   - L1-ext: index-archive.json — 超過 90 天無新 run 的 tasks
 */

import type {
  StorageBackend,
  HistoryIndex,
  HistoryIndexEntry,
  ManifestL2,
  RunHistoryEntry,
} from "./types.js";

const INDEX_FILE = "index.json";
const ARCHIVE_FILE = "index-archive.json";

/**
 * 執行歷史 manifest / index 管理器（SPEC-013）
 */
export class ManifestManager {
  constructor(
    private readonly backend: StorageBackend,
    private readonly maxActiveTasks = 50,
    private readonly archiveThresholdDays = 90,
  ) {}

  // ─── Run Number ──────────────────────────────────────────────────────────

  /**
   * 計算 taskId 的下一個 run number（三位數字 001-999）。
   * 基於 L2 manifest 的 run_history 長度。
   */
  async getNextRunNumber(taskId: string): Promise<string> {
    const manifest = await this.readL2(taskId);
    const count = manifest?.run_history.length ?? 0;
    return String(count + 1).padStart(3, "0");
  }

  // ─── L2 Manifest ─────────────────────────────────────────────────────────

  /**
   * 更新（或建立）taskId 的 L2 manifest.json。
   * 新增 runEntry 到 run_history，重新計算 key_metrics。
   */
  async updateL2(
    taskId: string,
    runEntry: RunHistoryEntry,
    taskName: string,
    artifactsAvailable: string[],
    failureReason?: string,
  ): Promise<void> {
    const existing = await this.readL2(taskId);
    const runHistory = [...(existing?.run_history ?? []), runEntry];

    const successCount = runHistory.filter(r => r.status === "success").length;
    const totalDuration = runHistory.reduce((s, r) => s + r.duration_s, 0);
    const totalTokens = runHistory.reduce((s, r) => s + r.tokens_total, 0);
    const count = runHistory.length;

    const manifest: ManifestL2 = {
      task_id: taskId,
      task_description_summary: existing?.task_description_summary ?? taskName,
      run_history: runHistory,
      key_metrics: {
        pass_rate: successCount / count,
        avg_tokens: count > 0 ? Math.round(totalTokens / count) : 0,
        avg_duration_s: count > 0 ? Math.round(totalDuration / count) : 0,
      },
      artifacts_available: artifactsAvailable,
      failure_summary:
        runEntry.status !== "success"
          ? failureReason ?? existing?.failure_summary
          : existing?.failure_summary,
    };

    await this.backend.writeFile(
      `${taskId}/manifest.json`,
      JSON.stringify(manifest, null, 2),
    );
  }

  // ─── L1 Index ────────────────────────────────────────────────────────────

  /**
   * 更新 L1 index.json，插入或更新 taskId 的條目。
   *
   * 若 index 已達 maxActiveTasks，先將最舊的 task（by latest_date）
   * 移至 index-archive.json，再插入新 task。
   */
  async updateL1(
    taskId: string,
    taskName: string,
    tags: string[],
    runEntry: Pick<HistoryIndexEntry, "latest_run" | "latest_status" | "latest_date" | "total_runs">,
  ): Promise<void> {
    const index = await this.readIndex();

    const entry: HistoryIndexEntry = {
      task_id: taskId,
      task_name: taskName,
      tags,
      latest_run: runEntry.latest_run,
      latest_status: runEntry.latest_status,
      latest_date: runEntry.latest_date,
      total_runs: runEntry.total_runs,
    };

    const existingIdx = index.tasks.findIndex(t => t.task_id === taskId);

    if (existingIdx >= 0) {
      index.tasks[existingIdx] = entry;
    } else {
      // 若達上限，先移出最舊的 task 到 archive
      if (index.tasks.length >= this.maxActiveTasks) {
        await this.evictOldestToArchive(index);
      }
      index.tasks.push(entry);
    }

    index.updated = new Date().toISOString();
    await this.writeIndex(index);
  }

  // ─── Archive ─────────────────────────────────────────────────────────────

  /**
   * 將 latest_date 超過 archiveThresholdDays 的 tasks 從 index.json
   * 移至 index-archive.json。
   */
  async archiveStaleTasks(): Promise<void> {
    const index = await this.readIndex();
    const now = Date.now();
    const thresholdMs = this.archiveThresholdDays * 24 * 60 * 60 * 1000;

    const stale = index.tasks.filter(
      t => now - new Date(t.latest_date).getTime() > thresholdMs,
    );
    if (stale.length === 0) return;

    const archive = await this.readArchive();
    const staleIds = new Set(stale.map(t => t.task_id));

    // 移動到 archive（避免重複）
    for (const task of stale) {
      const alreadyArchived = archive.tasks.some(t => t.task_id === task.task_id);
      if (!alreadyArchived) {
        archive.tasks.push(task);
      }
    }
    archive.updated = new Date().toISOString();

    // 從 index 移除
    index.tasks = index.tasks.filter(t => !staleIds.has(t.task_id));
    index.updated = new Date().toISOString();

    await this.writeIndex(index);
    await this.writeArchive(archive);
  }

  /**
   * 若 taskId 在 index-archive.json，移回 index.json。
   * 已在 active index 中則不做任何事。
   */
  async reactivateTask(taskId: string): Promise<void> {
    const archive = await this.readArchive();
    const task = archive.tasks.find(t => t.task_id === taskId);
    if (!task) return;

    // 從 archive 移除
    archive.tasks = archive.tasks.filter(t => t.task_id !== taskId);
    archive.updated = new Date().toISOString();

    // 加入 index
    const index = await this.readIndex();
    const alreadyActive = index.tasks.some(t => t.task_id === taskId);
    if (!alreadyActive) {
      if (index.tasks.length >= this.maxActiveTasks) {
        await this.evictOldestToArchive(index);
      }
      index.tasks.push(task);
      index.updated = new Date().toISOString();
      await this.writeIndex(index);
    }

    await this.writeArchive(archive);
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /** 讀取 L2 manifest（internal） */
  async readL2(taskId: string): Promise<ManifestL2 | null> {
    const raw = await this.backend.readFile(`${taskId}/manifest.json`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ManifestL2;
    } catch {
      return null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async readIndex(): Promise<HistoryIndex> {
    const raw = await this.backend.readFile(INDEX_FILE);
    if (!raw) return this.emptyIndex();
    try {
      return JSON.parse(raw) as HistoryIndex;
    } catch {
      return this.emptyIndex();
    }
  }

  private async writeIndex(index: HistoryIndex): Promise<void> {
    await this.backend.writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
  }

  private async readArchive(): Promise<HistoryIndex> {
    const raw = await this.backend.readFile(ARCHIVE_FILE);
    if (!raw) return this.emptyArchive();
    try {
      return JSON.parse(raw) as HistoryIndex;
    } catch {
      return this.emptyArchive();
    }
  }

  private async writeArchive(archive: HistoryIndex): Promise<void> {
    await this.backend.writeFile(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
  }

  /** 將 index 中 latest_date 最舊的 task 移入 archive（in-place 修改 index.tasks） */
  private async evictOldestToArchive(index: HistoryIndex): Promise<void> {
    if (index.tasks.length === 0) return;

    // 找出 latest_date 最舊的 task
    const oldest = index.tasks.reduce((min, t) =>
      new Date(t.latest_date).getTime() < new Date(min.latest_date).getTime() ? t : min,
    );

    index.tasks = index.tasks.filter(t => t.task_id !== oldest.task_id);

    const archive = await this.readArchive();
    const alreadyArchived = archive.tasks.some(t => t.task_id === oldest.task_id);
    if (!alreadyArchived) {
      archive.tasks.push(oldest);
    }
    archive.updated = new Date().toISOString();
    await this.writeArchive(archive);
  }

  private emptyIndex(): HistoryIndex {
    return {
      version: "1.0.0",
      updated: new Date().toISOString(),
      max_active_tasks: this.maxActiveTasks,
      archive_threshold_days: this.archiveThresholdDays,
      tasks: [],
    };
  }

  private emptyArchive(): HistoryIndex {
    return {
      version: "1.0.0",
      updated: new Date().toISOString(),
      max_active_tasks: this.maxActiveTasks,
      archive_threshold_days: this.archiveThresholdDays,
      tasks: [],
    };
  }
}
