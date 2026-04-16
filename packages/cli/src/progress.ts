/**
 * CLI 結構化進度顯示（XSPEC-049 EventEmitter 消費）
 *
 * 建立 EventEmitter 監聽 OrchestratorEvent，輸出清晰的執行進度。
 * 預設輸出：task:start / complete / failed / cancelled / skipped 結構化行
 * --verbose 模式：額外輸出 onProgress 詳細訊息（縮排顯示）
 */

import { EventEmitter } from "node:events";
import type { OrchestratorEvent } from "@devap/core";

export interface ProgressEmitterResult {
  /** 傳入 OrchestratorOptions.emitter */
  emitter: EventEmitter;
  /** 傳入 OrchestratorOptions.onProgress（verbose 模式才回傳函式，否則 undefined） */
  onProgress: ((msg: string) => void) | undefined;
}

/**
 * 建立結構化進度顯示的 EventEmitter。
 *
 * 監聽 OrchestratorEvent discriminated union，輸出：
 * - ⏳ [N/M] task_id: title（task:start）
 * - ✅ [N/M] task_id 完成（Xs）（task:complete）
 * - ❌ [N/M] task_id 失敗：error（task:failed）
 * - 🚫 task_id 取消（reason）（task:cancelled）
 * - ⏭  task_id 跳過（reason）（task:skipped）
 * - ⚠  已中止（reason），剩餘 N 個 Task（signal:abort）
 *
 * @param verbose - 若為 true，onProgress 回傳縮排版詳細訊息
 * @param writeLine - 輸出函式（預設 console.log，方便測試替換）
 */
export function createProgressEmitter(
  verbose = false,
  writeLine: (msg: string) => void = console.log,
): ProgressEmitterResult {
  const emitter = new EventEmitter();

  let taskTotal = 0;
  let taskIndex = 0;

  emitter.on("event", (event: OrchestratorEvent) => {
    switch (event.type) {
      case "orchestrator:start":
        taskTotal = event.task_count;
        taskIndex = 0;
        break;

      case "task:start":
        taskIndex++;
        writeLine(`⏳ [${taskIndex}/${taskTotal}] ${event.task_id}: ${event.title}`);
        break;

      case "task:complete": {
        const secs = (event.duration_ms / 1000).toFixed(1);
        writeLine(`✅ [${taskIndex}/${taskTotal}] ${event.task_id} 完成（${secs}s）`);
        break;
      }

      case "task:failed":
        writeLine(`❌ [${taskIndex}/${taskTotal}] ${event.task_id} 失敗：${event.error}`);
        break;

      case "task:cancelled":
        writeLine(`🚫 ${event.task_id} 取消（${event.reason}）`);
        break;

      case "task:skipped":
        writeLine(`⏭  ${event.task_id} 跳過（${event.reason}）`);
        break;

      case "signal:abort":
        writeLine(`⚠  已中止（${event.reason}），剩餘 ${event.remaining_tasks} 個 Task`);
        break;

      // orchestrator:start/complete、layer:start/complete 不顯示（避免噪音）
      default:
        break;
    }
  });

  const onProgress = verbose
    ? (msg: string) => writeLine(`   ${msg}`)
    : undefined;

  return { emitter, onProgress };
}
