// [Implements XSPEC-086 Phase 4] devap bdd CLI command tests
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createBddCommand } from "../bdd.js";

describe("createBddCommand", () => {
  it("should_register_bdd_command", () => {
    const cmd = createBddCommand();
    expect(cmd.name()).toBe("bdd");
  });

  it("should_accept_feature_argument", () => {
    const cmd = createBddCommand();
    expect(cmd.registeredArguments.length).toBeGreaterThan(0);
    expect(cmd.registeredArguments[0]?.name()).toBe("feature");
  });

  it("should_have_bdd_cmd_option", () => {
    const cmd = createBddCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--bdd-cmd");
  });

  it("should_describe_4_phases_in_help", () => {
    const cmd = createBddCommand();
    const desc = cmd.description();
    expect(desc).toContain("Discovery");
    expect(desc).toContain("Formulation");
    expect(desc).toContain("Automation");
    expect(desc).toContain("Living Docs");
  });

  it("should_reference_xspec_086_phase_4", () => {
    const cmd = createBddCommand();
    expect(cmd.description()).toContain("XSPEC-086");
  });
});

describe("devap bdd — guard rails", () => {
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
    vi.mock("node:readline", () => ({
      createInterface: () => ({
        question: (_: string, cb: (a: string) => void) => cb(""),
        close: () => {},
      }),
    }));

    const cmd = createBddCommand();
    await expect(cmd.parseAsync(["node", "bdd"])).rejects.toThrow("process.exit(1)");
    const errors = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errors).toContain("功能描述不可為空");
  });
});
