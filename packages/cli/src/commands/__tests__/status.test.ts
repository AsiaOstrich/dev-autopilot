/**
 * XSPEC-092 AC-5: devap status --cost
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCostReport, createStatusCommand } from "../status.js";

// Mock existsSync and AccessReader
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("@devap/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devap/core")>();
  return {
    ...actual,
    LocalStorageBackend: vi.fn(),
    AccessReader: vi.fn(),
  };
});

import { existsSync } from "node:fs";
import { AccessReader } from "@devap/core";

const mockIndex = {
  version: "1",
  updated: new Date().toISOString(),
  max_active_tasks: 50,
  archive_threshold_days: 30,
  tasks: [
    {
      task_id: "task-001",
      task_name: "implement feature X",
      tags: [],
      latest_run: "run-001",
      latest_status: "success" as const,
      latest_date: "2026-04-27",
      total_runs: 2,
    },
  ],
};

const mockManifest = {
  task_id: "task-001",
  task_description_summary: "implement feature X",
  run_history: [
    {
      run: "run-001",
      status: "success" as const,
      date: "2026-04-27",
      duration_s: 120,
      tokens_total: 50000,
    },
  ],
  key_metrics: { pass_rate: 1, avg_tokens: 50000, avg_duration_s: 120 },
  artifacts_available: [],
};

describe("buildCostReport (AC-5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should_return_message_when_history_dir_missing", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const report = await buildCostReport({ historyDir: "/nonexistent" });
    expect(report).toContain("執行歷史不存在");
  });

  it("should_return_message_when_no_tasks", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const mockReader = {
      readL1: vi.fn().mockResolvedValue({ ...mockIndex, tasks: [] }),
      readL2: vi.fn(),
    };
    vi.mocked(AccessReader).mockImplementation(() => mockReader as unknown as AccessReader);

    const report = await buildCostReport({ historyDir: "/some/dir" });
    expect(report).toContain("尚無執行記錄");
  });

  it("should_include_token_usage_and_cost_in_report_AC5", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const mockReader = {
      readL1: vi.fn().mockResolvedValue(mockIndex),
      readL2: vi.fn().mockResolvedValue(mockManifest),
    };
    vi.mocked(AccessReader).mockImplementation(() => mockReader as unknown as AccessReader);

    const report = await buildCostReport({ historyDir: "/some/dir", accessReader: mockReader as unknown as AccessReader });
    expect(report).toContain("Token 消耗報告");
    expect(report).toContain("50,000");
    expect(report).toContain("implement feature X");
  });

  it("should_show_grand_total_across_multiple_tasks", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const multiTaskIndex = {
      ...mockIndex,
      tasks: [
        { ...mockIndex.tasks[0], task_id: "task-001" },
        { ...mockIndex.tasks[0], task_id: "task-002", task_name: "fix bug Y" },
      ],
    };
    const mockReader = {
      readL1: vi.fn().mockResolvedValue(multiTaskIndex),
      readL2: vi.fn().mockResolvedValue(mockManifest),
    };
    vi.mocked(AccessReader).mockImplementation(() => mockReader as unknown as AccessReader);

    const report = await buildCostReport({ historyDir: "/some/dir", accessReader: mockReader as unknown as AccessReader });
    expect(report).toContain("合計");
  });
});

describe("createStatusCommand", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  it("should_create_command_with_cost_option", () => {
    const cmd = createStatusCommand();
    expect(cmd.name()).toBe("status");
    expect(cmd.options.some((o) => o.long === "--cost")).toBe(true);
  });

  it("should_log_status_ok_when_no_flags", async () => {
    const cmd = createStatusCommand();
    await cmd.parseAsync([], { from: "user" });
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining("正常")
    );
  });
});
