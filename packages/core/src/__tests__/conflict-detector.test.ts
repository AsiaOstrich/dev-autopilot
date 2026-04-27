import { describe, it, expect, beforeEach } from "vitest";
import { ConflictDetector } from "../conflict-detector.js";

describe("ConflictDetector — AC-6: 任務衝突偵測", () => {
  let detector: ConflictDetector;

  beforeEach(() => {
    detector = new ConflictDetector();
  });

  it("無衝突時可取得鎖定", () => {
    const result = detector.acquireLock("agent-A", ["src/auth.ts", "src/user.ts"]);
    expect(result.hasConflict).toBe(false);
    expect(result.conflictingFiles).toEqual([]);
    expect(detector.getLockCount()).toBe(1);
  });

  it("AC-6: 同一檔案衝突 — 第二個 Agent 被拒絕", () => {
    detector.acquireLock("agent-A", ["src/auth.ts"]);
    const result = detector.acquireLock("agent-B", ["src/auth.ts", "src/user.ts"]);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingFiles).toEqual(["src/auth.ts"]);
    expect(result.lockedBy).toBe("agent-A");
  });

  it("AC-6: 衝突時 Agent-B 的鎖定不被取得", () => {
    detector.acquireLock("agent-A", ["src/auth.ts"]);
    detector.acquireLock("agent-B", ["src/auth.ts"]);
    // agent-B should not have acquired a lock
    expect(detector.getLockCount()).toBe(1);
  });

  it("不同檔案不產生衝突", () => {
    detector.acquireLock("agent-A", ["src/auth.ts"]);
    const result = detector.acquireLock("agent-B", ["src/payment.ts"]);
    expect(result.hasConflict).toBe(false);
    expect(detector.getLockCount()).toBe(2);
  });

  it("AC-6: 第一個 Agent 完成後釋放鎖，第二個 Agent 可取得", () => {
    detector.acquireLock("agent-A", ["src/auth.ts"]);
    const conflict = detector.acquireLock("agent-B", ["src/auth.ts"]);
    expect(conflict.hasConflict).toBe(true);

    detector.releaseLock("agent-A");
    const result = detector.acquireLock("agent-B", ["src/auth.ts"]);
    expect(result.hasConflict).toBe(false);
  });

  it("checkConflict 不取得鎖定", () => {
    detector.acquireLock("agent-A", ["src/auth.ts"]);
    const check = detector.checkConflict("agent-B", ["src/auth.ts"]);
    expect(check.hasConflict).toBe(true);
    // lock count still 1 — agent-B did not acquire
    expect(detector.getLockCount()).toBe(1);
  });

  it("同一 Agent 重新 acquire 不自衝突", () => {
    detector.acquireLock("agent-A", ["src/auth.ts"]);
    const result = detector.checkConflict("agent-A", ["src/auth.ts"]);
    expect(result.hasConflict).toBe(false);
  });

  it("getActiveLocks 回傳鎖定清單", () => {
    detector.acquireLock("agent-A", ["src/auth.ts", "src/user.ts"]);
    const locks = detector.getActiveLocks();
    expect(locks).toHaveLength(1);
    expect(locks[0].agentId).toBe("agent-A");
    expect(locks[0].files).toContain("src/auth.ts");
    expect(locks[0].lockedAt).toBeInstanceOf(Date);
  });

  it("releaseLock 移除鎖定記錄", () => {
    detector.acquireLock("agent-A", ["src/auth.ts"]);
    detector.releaseLock("agent-A");
    expect(detector.getLockCount()).toBe(0);
    expect(detector.getActiveLocks()).toHaveLength(0);
  });
});
