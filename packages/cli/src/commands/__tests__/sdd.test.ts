// [Implements XSPEC-086 Phase 4] devap sdd CLI command tests
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSddCommand } from "../sdd.js";

describe("createSddCommand", () => {
  it("should_register_sdd_command", () => {
    const cmd = createSddCommand();
    expect(cmd.name()).toBe("sdd");
  });

  it("should_accept_feature_argument", () => {
    const cmd = createSddCommand();
    expect(cmd.registeredArguments.length).toBeGreaterThan(0);
    expect(cmd.registeredArguments[0]?.name()).toBe("feature");
  });

  it("should_have_phase_option", () => {
    const cmd = createSddCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--phase");
  });

  it("should_describe_7_phases_in_help", () => {
    const cmd = createSddCommand();
    const desc = cmd.description();
    expect(desc).toContain("Discuss");
    expect(desc).toContain("Create");
    expect(desc).toContain("Review");
    expect(desc).toContain("Approve");
    expect(desc).toContain("Implement");
    expect(desc).toContain("Verify");
    expect(desc).toContain("Archive");
  });

  it("should_reference_xspec_086_phase_4", () => {
    const cmd = createSddCommand();
    expect(cmd.description()).toContain("XSPEC-086");
  });
});

describe("devap sdd — guard rails", () => {
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

  it("should_exit_on_invalid_phase", async () => {
    vi.mock("node:readline", () => ({
      createInterface: () => ({
        question: (_: string, cb: (a: string) => void) => cb("test-feature"),
        close: () => {},
      }),
    }));

    const cmd = createSddCommand();
    await expect(
      cmd.parseAsync(["node", "sdd", "test-feature", "--phase", "invalid-phase"])
    ).rejects.toThrow("process.exit(1)");

    const errors = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errors).toContain("不支援的 phase");
  });
});

// 注意：完整的 7-phase 互動測試需要 mock readline 多次問答，
// 適合放在 integration test 層。此處驗證命令結構與守衛邏輯。
