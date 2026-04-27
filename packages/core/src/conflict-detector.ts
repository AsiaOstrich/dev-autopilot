/**
 * ConflictDetector — 多 Agent 檔案鎖定與衝突偵測（XSPEC-094 AC-6）
 *
 * AC-6: 排程時偵測同一檔案衝突，第二個 Agent 延後至第一個完成後執行
 */

export interface ConflictCheck {
  hasConflict: boolean;
  conflictingFiles: string[];
  /** 持有鎖定的 Agent ID */
  lockedBy?: string;
}

export interface FileLockInfo {
  agentId: string;
  files: string[];
  lockedAt: Date;
}

export class ConflictDetector {
  private readonly locks = new Map<string, { files: Set<string>; lockedAt: Date }>();

  /**
   * AC-6: 檢查並取得鎖定（atomic）
   *
   * - 若目標檔案已被其他 Agent 鎖定 → 回傳衝突，不取得鎖定
   * - 若無衝突 → 取得鎖定並回傳 hasConflict=false
   */
  acquireLock(agentId: string, files: string[]): ConflictCheck {
    const conflict = this.checkConflict(agentId, files);
    if (!conflict.hasConflict) {
      this.locks.set(agentId, { files: new Set(files), lockedAt: new Date() });
    }
    return conflict;
  }

  /** 釋放 Agent 的所有檔案鎖定（任務完成/失敗後呼叫） */
  releaseLock(agentId: string): void {
    this.locks.delete(agentId);
  }

  /** 查詢是否有衝突，不取得鎖定 */
  checkConflict(requestingAgentId: string, files: string[]): ConflictCheck {
    for (const [lockedAgentId, lock] of this.locks) {
      if (lockedAgentId === requestingAgentId) continue;
      const conflictingFiles = files.filter((f) => lock.files.has(f));
      if (conflictingFiles.length > 0) {
        return { hasConflict: true, conflictingFiles, lockedBy: lockedAgentId };
      }
    }
    return { hasConflict: false, conflictingFiles: [] };
  }

  /** 取得所有活躍鎖定（供 status --resources 顯示） */
  getActiveLocks(): FileLockInfo[] {
    return Array.from(this.locks.entries()).map(([agentId, lock]) => ({
      agentId,
      files: Array.from(lock.files),
      lockedAt: lock.lockedAt,
    }));
  }

  /** 目前鎖定數量 */
  getLockCount(): number {
    return this.locks.size;
  }
}
