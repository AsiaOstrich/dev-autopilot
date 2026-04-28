import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissionManager } from "../mission-manager.js";

async function makeManager(): Promise<{ mgr: MissionManager; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "devap-mission-test-"));
  const mgr = new MissionManager(dir);
  return { mgr, dir };
}

describe("MissionManager", () => {
  it("create() 建立 Mission 並設為 PLANNING", async () => {
    const { mgr, dir } = await makeManager();
    try {
      const record = await mgr.create("genesis", "build new auth module");
      expect(record.type).toBe("genesis");
      expect(record.intent).toBe("build new auth module");
      expect(record.status).toBe("PLANNING");
      expect(record.id).toMatch(/^mission-\d+-[a-z0-9]+$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("getCurrent() 回傳最新建立的 Mission", async () => {
    const { mgr, dir } = await makeManager();
    try {
      const created = await mgr.create("renovate", "refactor payment service");
      const current = await mgr.getCurrent();
      expect(current?.id).toBe(created.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pause() 將狀態切換為 PAUSED 並記錄 pausedAt", async () => {
    const { mgr, dir } = await makeManager();
    try {
      await mgr.create("medic", "fix login crash");
      const paused = await mgr.pause();
      expect(paused.status).toBe("PAUSED");
      expect(paused.pausedAt).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resume() 將 PAUSED Mission 切換回 IN_PROGRESS", async () => {
    const { mgr, dir } = await makeManager();
    try {
      await mgr.create("exodus", "remove legacy API");
      await mgr.pause();
      const resumed = await mgr.resume();
      expect(resumed.status).toBe("IN_PROGRESS");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cancel() 標記為 CANCELLED 並清除 current", async () => {
    const { mgr, dir } = await makeManager();
    try {
      await mgr.create("guardian", "update deps");
      await mgr.cancel();
      const current = await mgr.getCurrent();
      expect(current).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("list() 回傳所有 Mission，按建立時間倒序", async () => {
    const { mgr, dir } = await makeManager();
    try {
      await mgr.create("genesis", "first");
      await new Promise((r) => setTimeout(r, 5)); // ensure different ms timestamps for sort stability
      await mgr.create("renovate", "second");
      const all = await mgr.list();
      expect(all.length).toBe(2);
      expect(all[0].intent).toBe("second");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("getCurrent() 在無 Mission 時回傳 null", async () => {
    const { mgr, dir } = await makeManager();
    try {
      const current = await mgr.getCurrent();
      expect(current).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("updateStatus 在無 current 時拋出錯誤", async () => {
    const { mgr, dir } = await makeManager();
    try {
      await expect(mgr.pause()).rejects.toThrow("Mission 不存在");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
