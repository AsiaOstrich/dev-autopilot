import { describe, it, expect } from "vitest";
import { MemoryGuard } from "../memory-guard.js";

const MB = 1024 * 1024;

describe("MemoryGuard", () => {
  it("AC-2: 記憶體充足時允許 spawn", () => {
    const guard = new MemoryGuard({ minFreeMemoryMB: 512 }, () => ({
      freeBytes: 1024 * MB,
      totalBytes: 8192 * MB,
    }));
    const result = guard.checkSpawnAllowed();
    expect(result.allowed).toBe(true);
    expect(result.freeMemoryMB).toBe(1024);
    expect(result.totalMemoryMB).toBe(8192);
    expect(result.minFreeMemoryMB).toBe(512);
    expect(result.reason).toBeUndefined();
  });

  it("AC-2: 記憶體不足時拒絕 spawn", () => {
    const guard = new MemoryGuard({ minFreeMemoryMB: 2048 }, () => ({
      freeBytes: 512 * MB,
      totalBytes: 8192 * MB,
    }));
    const result = guard.checkSpawnAllowed();
    expect(result.allowed).toBe(false);
    expect(result.freeMemoryMB).toBe(512);
    expect(result.minFreeMemoryMB).toBe(2048);
    expect(result.reason).toMatch(/記憶體不足/);
  });

  it("AC-2: 剛好等於閾值時允許 spawn", () => {
    const guard = new MemoryGuard({ minFreeMemoryMB: 1024 }, () => ({
      freeBytes: 1024 * MB,
      totalBytes: 8192 * MB,
    }));
    expect(guard.checkSpawnAllowed().allowed).toBe(true);
  });

  it("AC-2: 預設閾值為 2048 MB", () => {
    const guard = new MemoryGuard({}, () => ({
      freeBytes: 1000 * MB,
      totalBytes: 8192 * MB,
    }));
    const result = guard.checkSpawnAllowed();
    expect(result.allowed).toBe(false);
    expect(result.minFreeMemoryMB).toBe(2048);
  });

  it("getFreeMemoryMB() 回傳可用記憶體 MB", () => {
    const guard = new MemoryGuard({}, () => ({
      freeBytes: 3072 * MB,
      totalBytes: 8192 * MB,
    }));
    expect(guard.getFreeMemoryMB()).toBe(3072);
  });

  it("error reason 包含可用與閾值資訊", () => {
    const guard = new MemoryGuard({ minFreeMemoryMB: 4096 }, () => ({
      freeBytes: 2048 * MB,
      totalBytes: 16384 * MB,
    }));
    const result = guard.checkSpawnAllowed();
    expect(result.reason).toContain("2048");
    expect(result.reason).toContain("4096");
  });
});
