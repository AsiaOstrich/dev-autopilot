/**
 * branch-drift.test.ts
 *
 * 單元測試：checkBranchDrift 三級回應與邊界條件（AC-047-008）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkBranchDrift } from "./branch-drift.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";

const mockedExecSync = vi.mocked(execSync);

beforeEach(() => {
  mockedExecSync.mockReset();
});

describe("checkBranchDrift", () => {
  it("零漂移 → up-to-date", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));     // git fetch
    mockedExecSync.mockReturnValueOnce(Buffer.from("0\n")); // rev-list

    const result = await checkBranchDrift("main", "/tmp/repo");

    expect(result.status).toBe("up-to-date");
    expect(result.behindCount).toBe(0);
    expect(result.baseBranch).toBe("main");
    expect(result.warning).toBeUndefined();
  });

  it("輕微漂移（3）→ warning", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));     // git fetch
    mockedExecSync.mockReturnValueOnce(Buffer.from("3\n")); // rev-list

    const result = await checkBranchDrift("main", "/tmp/repo");

    expect(result.status).toBe("warning");
    expect(result.behindCount).toBe(3);
    expect(result.baseBranch).toBe("main");
    expect(result.warning).toContain("3");
  });

  it("嚴重漂移（10）→ blocked", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));      // git fetch
    mockedExecSync.mockReturnValueOnce(Buffer.from("10\n")); // rev-list

    const result = await checkBranchDrift("main", "/tmp/repo");

    expect(result.status).toBe("blocked");
    expect(result.behindCount).toBe(10);
    expect(result.baseBranch).toBe("main");
    expect(result.warning).toContain("10");
  });

  it("剛好在 warningThreshold（5）→ warning（邊界條件）", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));     // git fetch
    mockedExecSync.mockReturnValueOnce(Buffer.from("5\n")); // rev-list

    const result = await checkBranchDrift("main", "/tmp/repo");

    // behindCount(5) <= warningThreshold(5) → warning
    expect(result.status).toBe("warning");
    expect(result.behindCount).toBe(5);
  });

  it("剛好在 blockThreshold（6）→ blocked（邊界條件）", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));     // git fetch
    mockedExecSync.mockReturnValueOnce(Buffer.from("6\n")); // rev-list

    const result = await checkBranchDrift("main", "/tmp/repo");

    // behindCount(6) > warningThreshold(5) → blocked
    expect(result.status).toBe("blocked");
    expect(result.behindCount).toBe(6);
  });

  it("git fetch 失敗 → fetch_failed，不拋出例外", async () => {
    mockedExecSync.mockImplementationOnce(() => {
      throw new Error("network error");
    });

    const result = await checkBranchDrift("main", "/tmp/repo");

    expect(result.status).toBe("fetch_failed");
    expect(result.behindCount).toBe(-1);
    expect(result.baseBranch).toBe("main");
    expect(result.warning).toBeDefined();
    // 第二個 execSync（rev-list）不應被呼叫
    expect(mockedExecSync).toHaveBeenCalledTimes(1);
  });

  it("rev-list 輸出不是數字（detached HEAD）→ fetch_failed", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));          // git fetch 成功
    mockedExecSync.mockImplementationOnce(() => {
      throw new Error("fatal: not a git repository");
    }); // rev-list 拋出

    const result = await checkBranchDrift("main", "/tmp/repo");

    expect(result.status).toBe("fetch_failed");
    expect(result.behindCount).toBe(-1);
    expect(result.warning).toContain("detached HEAD");
  });

  it("自訂閾值：warningThreshold=2, blockThreshold=3，behindCount=3 → blocked", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));     // git fetch
    mockedExecSync.mockReturnValueOnce(Buffer.from("3\n")); // rev-list

    const result = await checkBranchDrift("main", "/tmp/repo", {
      warningThreshold: 2,
      blockThreshold: 3,
    });

    // behindCount(3) > warningThreshold(2) → blocked
    expect(result.status).toBe("blocked");
    expect(result.behindCount).toBe(3);
  });

  it("自訂閾值：warningThreshold=2，behindCount=2 → warning（邊界條件）", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));     // git fetch
    mockedExecSync.mockReturnValueOnce(Buffer.from("2\n")); // rev-list

    const result = await checkBranchDrift("main", "/tmp/repo", {
      warningThreshold: 2,
      blockThreshold: 3,
    });

    // behindCount(2) <= warningThreshold(2) → warning
    expect(result.status).toBe("warning");
    expect(result.behindCount).toBe(2);
  });

  it("使用預設 baseBranch（main）與預設 cwd", async () => {
    mockedExecSync.mockReturnValueOnce(Buffer.from(""));     // git fetch
    mockedExecSync.mockReturnValueOnce(Buffer.from("0\n")); // rev-list

    const result = await checkBranchDrift();

    expect(result.baseBranch).toBe("main");
    expect(result.status).toBe("up-to-date");

    // 確認 fetch 指令包含 main
    expect(mockedExecSync).toHaveBeenNthCalledWith(
      1,
      "git fetch origin main --quiet",
      expect.objectContaining({ stdio: "pipe" }),
    );
  });
});
