import { describe, it, expect } from "vitest";
import { createWorkflowCommand } from "../workflow.js";

describe("createWorkflowCommand", () => {
  it("returns a Command named 'workflow'", () => {
    const cmd = createWorkflowCommand();
    expect(cmd.name()).toBe("workflow");
  });

  it("has 'list' subcommand", () => {
    const cmd = createWorkflowCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain("list");
  });

  it("has 'execute' subcommand with <name> argument", () => {
    const cmd = createWorkflowCommand();
    const execute = cmd.commands.find((c) => c.name() === "execute");
    expect(execute).toBeDefined();
    expect(execute?.registeredArguments.length).toBe(1);
  });

  it("has 'status' subcommand with optional [name] argument", () => {
    const cmd = createWorkflowCommand();
    const status = cmd.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
    expect(status?.registeredArguments.length).toBe(1);
    expect(status?.registeredArguments[0].required).toBe(false);
  });

  it("execute subcommand has --resume option", () => {
    const cmd = createWorkflowCommand();
    const execute = cmd.commands.find((c) => c.name() === "execute")!;
    expect(execute.options.some((o) => o.long === "--resume")).toBe(true);
  });

  it("execute subcommand has --dry-run option", () => {
    const cmd = createWorkflowCommand();
    const execute = cmd.commands.find((c) => c.name() === "execute")!;
    expect(execute.options.some((o) => o.long === "--dry-run")).toBe(true);
  });

  it("all subcommands have --cwd option", () => {
    const cmd = createWorkflowCommand();
    for (const sub of cmd.commands) {
      const hasCwd = sub.options.some((o) => o.long === "--cwd");
      expect(hasCwd, `${sub.name()} should have --cwd`).toBe(true);
    }
  });

  it("execute exits with error when flow not found", async () => {
    const cmd = createWorkflowCommand();
    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; throw new Error("exit"); }) as never;
    try {
      await cmd.parseAsync(
        ["node", "workflow", "execute", "nonexistent-flow", "--cwd", "/tmp"],
        { from: "user" }
      );
    } catch {
      // expected
    } finally {
      process.exit = originalExit;
    }
    expect(exitCode).toBe(1);
  });
});
