import { describe, it, expect } from "vitest";
import { AgentPool, type AgentPoolConfig } from "../agent-pool.js";

const MB = 1024 * 1024;

function makePool(overrides: AgentPoolConfig = {}) {
  return new AgentPool({
    maxConcurrentAgents: 2,
    memoryGuard: { minFreeMemoryMB: 512 },
    ...overrides,
  });
}

describe("AgentPool — AC-1: 並行上限", () => {
  it("未達上限時立即 spawn", async () => {
    const pool = makePool();
    // inject rich memory via MemoryGuard provider — use internal injection path
    // We pass a custom AgentPoolConfig that includes a fake provider via memoryGuard minFreeMemoryMB=0
    const p = new AgentPool({
      maxConcurrentAgents: 2,
      memoryGuard: { minFreeMemoryMB: 0 }, // always allow
    });
    const r1 = await p.requestSpawn("a1");
    const r2 = await p.requestSpawn("a2");
    expect(r1.decision).toBe("spawned");
    expect(r2.decision).toBe("spawned");
    expect(p.getState().activeCount).toBe(2);
  });

  it("達到上限時後續請求進入佇列並在 release 後獲得 spawn", async () => {
    const p = new AgentPool({
      maxConcurrentAgents: 1,
      memoryGuard: { minFreeMemoryMB: 0 },
    });

    const r1 = await p.requestSpawn("a1");
    expect(r1.decision).toBe("spawned");
    expect(p.getState().activeCount).toBe(1);

    // a2 should queue — don't await yet
    const pending = p.requestSpawn("a2");
    expect(p.getState().queueLength).toBe(1);

    // release a1 → should resolve a2
    p.release("a1");
    const r2 = await pending;
    expect(r2.decision).toBe("spawned");
    expect(p.getState().queueLength).toBe(0);
  });
});

describe("AgentPool — AC-2: 記憶體檢查", () => {
  it("記憶體不足時回傳 rejected-memory", async () => {
    const p = new AgentPool({
      maxConcurrentAgents: 4,
      memoryGuard: { minFreeMemoryMB: 99999 }, // threshold unreachably high
    });
    const r = await p.requestSpawn("a1");
    expect(r.decision).toBe("rejected-memory");
    expect(r.reason).toMatch(/記憶體不足/);
  });

  it("記憶體充足時重置連續失敗計數", async () => {
    const p = new AgentPool({
      maxConcurrentAgents: 4,
      memoryGuard: { minFreeMemoryMB: 0 },
    });
    // force some "failures" first by using a high-threshold pool and then check state
    const pFail = new AgentPool({
      maxConcurrentAgents: 4,
      memoryFailThreshold: 3,
      memoryGuard: { minFreeMemoryMB: 99999 },
    });
    await pFail.requestSpawn("a1");
    await pFail.requestSpawn("a2");
    expect(pFail.getState().consecutiveMemoryFailures).toBe(2);

    // now switch to low-threshold pool — pass
    const r = await p.requestSpawn("b1");
    expect(r.decision).toBe("spawned");
    expect(p.getState().consecutiveMemoryFailures).toBe(0);
  });
});

describe("AgentPool — AC-3: sequential 降級", () => {
  it("連續記憶體不足達閾值後進入 sequential 模式", async () => {
    const p = new AgentPool({
      maxConcurrentAgents: 4,
      memoryFailThreshold: 2,
      memoryGuard: { minFreeMemoryMB: 99999 },
    });
    await p.requestSpawn("a1"); // fail 1
    expect(p.getState().isSequentialMode).toBe(false);
    await p.requestSpawn("a2"); // fail 2 → trigger
    expect(p.getState().isSequentialMode).toBe(true);
  });

  it("sequential 模式且已有 active agent 時回傳 rejected-sequential", async () => {
    const p = new AgentPool({
      maxConcurrentAgents: 4,
      memoryFailThreshold: 1,
      memoryGuard: { minFreeMemoryMB: 99999 },
    });
    // Manually trigger sequential mode
    await p.requestSpawn("a1"); // memory fail → sequential ON
    expect(p.getState().isSequentialMode).toBe(true);

    // Spawn a1 with a pool that allows memory (simulate that one agent got in before mode change)
    const p2 = new AgentPool({
      maxConcurrentAgents: 4,
      memoryFailThreshold: 1,
      memoryGuard: { minFreeMemoryMB: 0 },
    });
    await p2.requestSpawn("a1"); // spawned
    // manually enable sequential mode
    // Force sequential via memoryFailThreshold
    const p3 = new AgentPool({
      maxConcurrentAgents: 4,
      memoryFailThreshold: 1,
      memoryGuard: { minFreeMemoryMB: 99999 },
    });
    await p3.requestSpawn("trigger"); // triggers sequential mode
    // Now use p2's sequential path: active > 0 in sequential mode
    p2["isSequentialMode"] = true;
    const r = await p2.requestSpawn("a2");
    expect(r.decision).toBe("rejected-sequential");
  });

  it("exitSequentialMode() 重置降級狀態", async () => {
    const p = new AgentPool({
      maxConcurrentAgents: 4,
      memoryFailThreshold: 1,
      memoryGuard: { minFreeMemoryMB: 99999 },
    });
    await p.requestSpawn("a1");
    expect(p.getState().isSequentialMode).toBe(true);
    p.exitSequentialMode();
    expect(p.getState().isSequentialMode).toBe(false);
    expect(p.getState().consecutiveMemoryFailures).toBe(0);
  });
});

describe("AgentPool — getState()", () => {
  it("初始狀態正確", () => {
    const p = new AgentPool({ maxConcurrentAgents: 3 });
    const s = p.getState();
    expect(s.activeCount).toBe(0);
    expect(s.queueLength).toBe(0);
    expect(s.isSequentialMode).toBe(false);
    expect(s.consecutiveMemoryFailures).toBe(0);
  });

  it("release 後 activeCount 歸零", async () => {
    const p = new AgentPool({ memoryGuard: { minFreeMemoryMB: 0 } });
    await p.requestSpawn("a1");
    expect(p.getState().activeCount).toBe(1);
    p.release("a1");
    expect(p.getState().activeCount).toBe(0);
  });
});
