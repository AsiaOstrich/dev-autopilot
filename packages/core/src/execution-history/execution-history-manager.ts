/**
 * ExecutionHistoryManager（SPEC-013 REQ-013-005）
 *
 * 主入口：提供兩個公開函式：
 *   - recordRun(config, artifacts): 完整記錄一次 task 執行結果
 *   - getHistory(config): 讀取 L1 全域 index
 *
 * 此模組協調 ArtifactWriter、ManifestManager、AccessReader、StorageRetentionManager。
 * `.workflow-state/` 任務完成時應呼叫 recordRun() 歸檔。
 */

import { join } from "node:path";
import { LocalStorageBackend } from "./storage-backend.js";
import { ArtifactWriter } from "./artifact-writer.js";
import { ManifestManager } from "./manifest-manager.js";
import { AccessReader } from "./access-reader.js";
import { StorageRetentionManager } from "./retention-manager.js";
import type {
  StorageConfig,
  RunArtifacts,
  HistoryIndex,
  StorageBackend,
  RunHistoryEntry,
} from "./types.js";

/** .execution-history/ 的相對路徑 */
const HISTORY_DIR = ".execution-history";

/**
 * 建立儲存後端實例。
 * Phase 4 將支援 file_server backend；目前僅支援 local。
 */
function createBackend(config: StorageConfig): StorageBackend {
  const historyPath = join(config.basePath, HISTORY_DIR);
  return new LocalStorageBackend(historyPath);
}

/**
 * 記錄單次 task 執行結果到 .execution-history/。
 *
 * 流程：
 *   1. 若 task 在 archive，先 reactivate（移回 active index）
 *   2. 計算下一個 run number
 *   3. 寫入 artifacts（含 redaction）
 *   4. 更新 L2 manifest
 *   5. 更新 L1 index（處理 50 task 上限 & archive eviction）
 *   6. 歸檔超過 90 天的 stale tasks
 *   7. 執行 retention 清理（超過 max_runs_per_task 刪最舊 L3）
 *
 * @param config   儲存配置（basePath 等）
 * @param artifacts 要記錄的 artifacts 內容
 */
export async function recordRun(
  config: StorageConfig,
  artifacts: RunArtifacts,
): Promise<void> {
  const backend = createBackend(config);
  const writer = new ArtifactWriter(backend, config.sensitivePatternsExtra);
  const manifestMgr = new ManifestManager(backend);
  const retention = new StorageRetentionManager(backend, config.retention);

  const { taskId, taskName, tags = [], status, content, durationS = 0, tokensTotal = 0 } =
    artifacts;

  // 1. Reactivate if archived
  await manifestMgr.reactivateTask(taskId);

  // 2. Run number
  const runNumber = await manifestMgr.getNextRunNumber(taskId);

  // 3. Write artifacts
  const writtenArtifacts = await writer.writeRun(taskId, runNumber, content);

  // 4. Update L2 manifest
  const runEntry: RunHistoryEntry = {
    run: runNumber,
    status,
    date: new Date().toISOString(),
    duration_s: durationS,
    tokens_total: tokensTotal,
  };

  const failureReason =
    status !== "success" ? (content["final-status"] ?? undefined) : undefined;

  await manifestMgr.updateL2(taskId, runEntry, taskName, writtenArtifacts, failureReason);

  // 5. Update L1 index
  const currentManifest = await manifestMgr.readL2(taskId);
  const totalRuns = currentManifest?.run_history.length ?? 1;

  await manifestMgr.updateL1(taskId, taskName, tags, {
    latest_run: runNumber,
    latest_status: status,
    latest_date: runEntry.date,
    total_runs: totalRuns,
  });

  // 6. Archive stale tasks
  await manifestMgr.archiveStaleTasks();

  // 7. Retention cleanup
  await retention.enforce(taskId);
}

/**
 * 讀取 L1 全域活躍 task index。
 *
 * @param config 儲存配置（basePath）
 * @returns HistoryIndex 或 null（若 index.json 不存在）
 */
export async function getHistory(config: StorageConfig): Promise<HistoryIndex | null> {
  const backend = createBackend(config);
  const reader = new AccessReader(backend);
  return reader.readL1();
}
