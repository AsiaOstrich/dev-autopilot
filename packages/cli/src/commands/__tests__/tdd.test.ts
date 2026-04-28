// [Implements XSPEC-086 Phase 4] devap tdd CLI command tests
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTddCommand } from "../tdd.js";

describe("createTddCommand", () => {
  it("should_register_tdd_command", () => {
    const cmd = createTddCommand();
    expect(cmd.name()).toBe("tdd");
  });

  it("should_accept_feature_argument", () => {
    const cmd = createTddCommand();
    expect(cmd.registeredArguments.length).toBeGreaterThan(0);
    expect(cmd.registeredArguments[0]?.name()).toBe("feature");
  });

  it("should_have_test_cmd_option", () => {
    const cmd = createTddCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--test-cmd");
  });

  it("should_describe_red_green_refactor_in_help", () => {
    const cmd = createTddCommand();
    expect(cmd.description()).toContain("RED");
    expect(cmd.description()).toContain("GREEN");
    expect(cmd.description()).toContain("REFACTOR");
  });

  it("should_reference_xspec_086_phase_4", () => {
    const cmd = createTddCommand();
    expect(cmd.description()).toContain("XSPEC-086");
  });
});

describe("devap tdd — guard rails", () => {
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

  it("should_exit_when_empty_feature_and_no_stdin", async () => {
    // 模擬 stdin 返回空字串（模擬非互動式環境）
    vi.mock("node:readline", () => ({
      createInterface: () => ({
        question: (_: string, cb: (a: string) => void) => cb(""),
        close: () => {},
      }),
    }));

    const cmd = createTddCommand();
    await expect(
      cmd.parseAsync(["node", "tdd"])
    ).rejects.toThrow("process.exit(1)");

    const errors = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errors).toContain("功能描述不可為空");
  });
});

// 注意：完整的 RED→GREEN→REFACTOR 循環測試需要模擬 readline 互動與 exec，
// 適合放在 integration test 層；此處僅驗證命令結構與守衛邏輯。
