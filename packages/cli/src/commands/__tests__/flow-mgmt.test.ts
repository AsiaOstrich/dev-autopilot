import { describe, it, expect } from "vitest";
import { createFlowManagementCommand } from "../flow-mgmt.js";

describe("createFlowManagementCommand", () => {
  it("returns a Command named 'flow'", () => {
    const cmd = createFlowManagementCommand();
    expect(cmd.name()).toBe("flow");
  });

  it("has 'list' subcommand", () => {
    const cmd = createFlowManagementCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain("list");
  });

  it("has 'validate' subcommand with <id> argument", () => {
    const cmd = createFlowManagementCommand();
    const validate = cmd.commands.find((c) => c.name() === "validate");
    expect(validate).toBeDefined();
    expect(validate?.registeredArguments.length).toBe(1);
  });

  it("has 'diff' subcommand with two arguments", () => {
    const cmd = createFlowManagementCommand();
    const diff = cmd.commands.find((c) => c.name() === "diff");
    expect(diff).toBeDefined();
    expect(diff?.registeredArguments.length).toBe(2);
  });

  it("validate exits with error when flow not found", async () => {
    const cmd = createFlowManagementCommand();
    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; throw new Error("exit"); }) as never;
    try {
      await cmd.parseAsync(
        ["node", "flow", "validate", "nonexistent-flow", "--cwd", "/tmp"],
        { from: "user" }
      );
    } catch {
      // expected
    } finally {
      process.exit = originalExit;
    }
    expect(exitCode).toBe(1);
  });

  it("all subcommands have --cwd option", () => {
    const cmd = createFlowManagementCommand();
    for (const sub of cmd.commands) {
      const hasCwd = sub.options.some((o) => o.long === "--cwd");
      expect(hasCwd, `${sub.name()} should have --cwd`).toBe(true);
    }
  });
});
