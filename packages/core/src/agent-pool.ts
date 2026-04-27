/**
 * AgentPool — Multi-Agent 並行資源管理（XSPEC-094 AC-1/2/3）
 *
 * AC-1: maxConcurrentAgents 硬性上限 + 等待佇列
 * AC-2: spawn 前查詢 MemoryGuard；不足時拒絕
 * AC-3: 連續 N 次記憶體不足 → 觸發 sequential 降級模式
 */

import { MemoryGuard, type MemoryGuardConfig } from "./memory-guard.js";

export interface AgentPoolConfig {
  /** 最大並行 Agent 數量，預設 4 */
  maxConcurrentAgents?: number;
  /** 連續記憶體不足幾次後進入 sequential 降級，預設 3 */
  memoryFailThreshold?: number;
  memoryGuard?: MemoryGuardConfig;
}

export type SpawnDecision =
  | "spawned"
  | "queued"
  | "rejected-memory"
  | "rejected-sequential";

export interface SpawnResult {
  decision: SpawnDecision;
  agentId: string;
  reason?: string;
}

export interface AgentPoolState {
  activeCount: number;
  queueLength: number;
  isSequentialMode: boolean;
  consecutiveMemoryFailures: number;
}

type QueuedResolve = (result: SpawnResult) => void;

export class AgentPool {
  private readonly maxConcurrent: number;
  private readonly memoryFailThreshold: number;
  private readonly memoryGuard: MemoryGuard;

  private activeCount = 0;
  private consecutiveMemoryFailures = 0;
  private isSequentialMode = false;
  private readonly queue: Array<{ agentId: string; resolve: QueuedResolve }> =
    [];

  constructor(config: AgentPoolConfig = {}) {
    this.maxConcurrent = config.maxConcurrentAgents ?? 4;
    this.memoryFailThreshold = config.memoryFailThreshold ?? 3;
    this.memoryGuard = new MemoryGuard(config.memoryGuard ?? {});
  }

  /**
   * AC-1/2/3: 請求 spawn 一個新 Agent。
   *
   * - 若已達上限 → 加入等待佇列（queued）
   * - sequential 模式下且已有 active agent → rejected-sequential
   * - 記憶體不足 → rejected-memory；連續失敗達閾值 → 啟動 sequential 模式
   * - 否則 → spawned
   */
  async requestSpawn(agentId: string): Promise<SpawnResult> {
    // AC-3: sequential 模式 — 只允許一個 agent 同時執行
    if (this.isSequentialMode && this.activeCount > 0) {
      return {
        decision: "rejected-sequential",
        agentId,
        reason: `sequential 降級模式：目前已有 ${this.activeCount} 個 Agent 執行中`,
      };
    }

    // AC-1: 達到並行上限 → 排隊
    if (this.activeCount >= this.maxConcurrent) {
      return new Promise<SpawnResult>((resolve) => {
        this.queue.push({ agentId, resolve });
      });
    }

    // AC-2: 記憶體檢查
    const memCheck = this.memoryGuard.checkSpawnAllowed();
    if (!memCheck.allowed) {
      this.consecutiveMemoryFailures++;
      // AC-3: 連續失敗達閾值 → 進入 sequential 降級
      if (this.consecutiveMemoryFailures >= this.memoryFailThreshold) {
        this.isSequentialMode = true;
      }
      return {
        decision: "rejected-memory",
        agentId,
        reason: memCheck.reason,
      };
    }

    // 記憶體充足 — 重置連續失敗計數
    this.consecutiveMemoryFailures = 0;
    this.activeCount++;

    return { decision: "spawned", agentId };
  }

  /**
   * Agent 完成後釋放資源，並嘗試喚醒佇列中下一個等待者。
   */
  release(agentId: string): void {
    if (this.activeCount > 0) this.activeCount--;

    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // 直接遞迴呼叫（同步路徑，不再加入佇列）
      this.requestSpawn(next.agentId).then(next.resolve);
    }
  }

  /** 手動退出 sequential 降級模式（例如記憶體釋放後由呼叫端觸發） */
  exitSequentialMode(): void {
    this.isSequentialMode = false;
    this.consecutiveMemoryFailures = 0;
  }

  getState(): AgentPoolState {
    return {
      activeCount: this.activeCount,
      queueLength: this.queue.length,
      isSequentialMode: this.isSequentialMode,
      consecutiveMemoryFailures: this.consecutiveMemoryFailures,
    };
  }
}
