/**
 * LogCollector（SPEC-008 Phase 2）
 *
 * 包裝 onProgress callback，收集結構化事件並同時轉發原始 callback。
 */

/**
 * 執行日誌收集器
 */
export class LogCollector {
  private readonly entries: Array<{ timestamp: string; message: string }> = [];
  private readonly originalCallback?: (message: string) => void;

  constructor(originalCallback?: (message: string) => void) {
    this.originalCallback = originalCallback;
  }

  /** onProgress handler — 同時收集 + 轉發 */
  handler = (message: string): void => {
    this.entries.push({
      timestamp: new Date().toISOString(),
      message,
    });
    this.originalCallback?.(message);
  };

  /** 取得已收集的所有 log entries（回傳副本） */
  getEntries(): Array<{ timestamp: string; message: string }> {
    return [...this.entries];
  }
}
