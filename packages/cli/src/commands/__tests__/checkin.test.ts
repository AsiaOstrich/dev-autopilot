// [Implements XSPEC-086 Phase 4] devap checkin CLI command tests
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createCheckinCommand } from "../checkin.js";

describe("createCheckinCommand", () => {
  it("should_register_checkin_command", () => {
    const cmd = createCheckinCommand();
    expect(cmd.name()).toBe("checkin");
  });

  it("should_have_test_cmd_option", () => {
    const cmd = createCheckinCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--test-cmd");
  });

  it("should_have_lint_cmd_option", () => {
    const cmd = createCheckinCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--lint-cmd");
  });

  it("should_have_skip_build_option", () => {
    const cmd = createCheckinCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--skip-build");
  });

  it("should_describe_gate_sequence_in_help", () => {
    const cmd = createCheckinCommand();
    const desc = cmd.description();
    expect(desc).toContain("build");
    expect(desc).toContain("tests");
    expect(desc).toContain("lint");
    expect(desc).toContain("XSPEC-086");
  });
});

describe("devap checkin — guard rails", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("should_exit_on_failing_lint", async () => {
    // lint 命令故意失敗
    const cmd = createCheckinCommand();
    await expect(
      cmd.parseAsync([
        "node", "checkin",
        "--skip-build",
        "--test-cmd", "true",   // 測試通過
        "--lint-cmd", "false",  // lint 失敗
      ])
    ).rejects.toThrow("process.exit(1)");
  });
});

// 注意：完整的 gate 序列測試需要真實或 mock 的 npm test / lint 環境，
// 適合放在 integration test 層。此處驗證命令結構與守衛邏輯。
