/**
 * MemoryGuard — Agent Spawn 前記憶體檢查（XSPEC-094 AC-2/AC-3）
 *
 * AC-2: spawn 前查詢系統可用記憶體；不足時拒絕 spawn
 * AC-3: 記憶體持續不足 → 觸發 sequential 降級
 */

import { freemem, totalmem } from "node:os";

export interface MemoryGuardConfig {
  /** 允許 spawn 的最低可用記憶體（MB），預設 2048 */
  minFreeMemoryMB?: number;
}

export interface MemoryCheckResult {
  allowed: boolean;
  freeMemoryMB: number;
  totalMemoryMB: number;
  minFreeMemoryMB: number;
  reason?: string;
}

/** 可注入的記憶體查詢函式（測試用） */
export type MemoryProvider = () => { freeBytes: number; totalBytes: number };

const defaultProvider: MemoryProvider = () => ({
  freeBytes: freemem(),
  totalBytes: totalmem(),
});

export class MemoryGuard {
  private readonly minFreeMemoryMB: number;
  private readonly provider: MemoryProvider;

  constructor(config: MemoryGuardConfig = {}, provider?: MemoryProvider) {
    this.minFreeMemoryMB = config.minFreeMemoryMB ?? 2048;
    this.provider = provider ?? defaultProvider;
  }

  /** AC-2: 檢查是否可以 spawn 新 Agent */
  checkSpawnAllowed(): MemoryCheckResult {
    const { freeBytes, totalBytes } = this.provider();
    const freeMemoryMB = Math.floor(freeBytes / 1024 / 1024);
    const totalMemoryMB = Math.floor(totalBytes / 1024 / 1024);
    const minFreeMemoryMB = this.minFreeMemoryMB;

    if (freeMemoryMB < minFreeMemoryMB) {
      return {
        allowed: false,
        freeMemoryMB,
        totalMemoryMB,
        minFreeMemoryMB,
        reason: `記憶體不足（可用: ${freeMemoryMB} MB < ${minFreeMemoryMB} MB）`,
      };
    }

    return { allowed: true, freeMemoryMB, totalMemoryMB, minFreeMemoryMB };
  }

  getFreeMemoryMB(): number {
    return Math.floor(this.provider().freeBytes / 1024 / 1024);
  }
}
