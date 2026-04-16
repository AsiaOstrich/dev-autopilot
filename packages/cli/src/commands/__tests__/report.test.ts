/**
 * XSPEC-054: devap report 命令測試
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExecutionReport } from "@devap/core";

// 建立臨時目錄路徑
const TEST_DIR = join(tmpdir(), `devap-report-test-${Date.now()}`);
const TEST_REPORT_PATH = join(TEST_DIR, "test-report.json");

/** 建立 mock ExecutionReport */
function createMockReport(overrides?: Partial<ExecutionReport & { _meta?: Record<string, string> }>): ExecutionReport & { _meta?: Record<string, string> } {
  return {
    summary: {
      total_tasks: 3,
      succeeded: 2,
      failed: 1,
      skipped: 0,
      done_with_concerns: 0,
      needs_context: 0,
      blocked: 0,
      cancelled: 0,
      total_cost_usd: 0.05,
      total_duration_ms: 12000,
    },
    tasks: [
      { task_id: "T-001", status: "success", duration_ms: 3000, cost_usd: 0.02 },
      { task_id: "T-002", status: "failed", duration_ms: 5000, error: "Build failed: missing dependency" },
      { task_id: "T-003", status: "skipped", duration_ms: 0, error: "依賴任務失敗" },
    ],
    session_resume_pack: { "T-001": "session-abc123" },
    _meta: {
      plan_file: "test-plan.json",
      executed_at: "2026-04-16T10:00:00.000Z",
    },
    ...overrides,
  };
}

describe("XSPEC-054: executeReport", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("找不到報告時 exit(1) 並輸出友善提示", async () => {
    const { executeReport } = await import("../report.js");
    // process.exit throw 一個特殊錯誤讓後續執行中止
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      executeReport({ path: join(TEST_DIR, "nonexistent.json") }),
    ).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("找不到執行報告"));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("--json flag 輸出完整 JSON", async () => {
    const { executeReport } = await import("../report.js");
    const report = createMockReport();
    await writeFile(TEST_REPORT_PATH, JSON.stringify(report));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeReport({ path: TEST_REPORT_PATH, json: true });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.summary.total_tasks).toBe(3);

    logSpy.mockRestore();
  });

  it("格式化輸出包含 Plan、Time、Cost、Result 欄位", async () => {
    const { executeReport } = await import("../report.js");
    const report = createMockReport();
    await writeFile(TEST_REPORT_PATH, JSON.stringify(report));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeReport({ path: TEST_REPORT_PATH });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Plan:");
    expect(output).toContain("Time:");
    expect(output).toContain("Cost:");
    expect(output).toContain("Result:");

    logSpy.mockRestore();
  });

  it("failed task 顯示 ❌ 和 error 前 80 字元", async () => {
    const { executeReport } = await import("../report.js");
    const report = createMockReport();
    await writeFile(TEST_REPORT_PATH, JSON.stringify(report));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeReport({ path: TEST_REPORT_PATH });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("❌");
    expect(output).toContain("Build failed");

    logSpy.mockRestore();
  });

  it("dry_run: true 時顯示 [DRY RUN] 標籤", async () => {
    const { executeReport } = await import("../report.js");
    const report = createMockReport({ dry_run: true });
    await writeFile(TEST_REPORT_PATH, JSON.stringify(report));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeReport({ path: TEST_REPORT_PATH });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("[DRY RUN]");

    logSpy.mockRestore();
  });

  it("有 failed task 時顯示 Resume Pack 建議", async () => {
    const { executeReport } = await import("../report.js");
    const report = createMockReport();
    await writeFile(TEST_REPORT_PATH, JSON.stringify(report));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeReport({ path: TEST_REPORT_PATH });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Resume Pack");
    expect(output).toContain("--only");

    logSpy.mockRestore();
  });
});
