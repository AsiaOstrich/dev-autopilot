import { describe, it, expect } from "vitest";
import { createRunIntentCommand } from "../run-intent.js";

describe("createRunIntentCommand", () => {
  it("returns a Command named 'run-intent'", () => {
    const cmd = createRunIntentCommand();
    expect(cmd.name()).toBe("run-intent");
  });

  it("requires intent argument", () => {
    const cmd = createRunIntentCommand();
    const args = cmd.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(true);
  });

  it("has --dry-run flag", () => {
    const cmd = createRunIntentCommand();
    const dryRunOpt = cmd.options.find((o) => o.long === "--dry-run");
    expect(dryRunOpt).toBeDefined();
  });

  it("has --list flag", () => {
    const cmd = createRunIntentCommand();
    const listOpt = cmd.options.find((o) => o.long === "--list");
    expect(listOpt).toBeDefined();
  });

  it("has --cwd option", () => {
    const cmd = createRunIntentCommand();
    const cwdOpt = cmd.options.find((o) => o.long === "--cwd");
    expect(cwdOpt).toBeDefined();
  });

  it("exits with error when intent cannot be resolved", async () => {
    const cmd = createRunIntentCommand();
    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; throw new Error("exit"); }) as never;
    try {
      await cmd.parseAsync(
        ["node", "run-intent", "nonexistent-intent-xyz", "--cwd", "/tmp"],
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
