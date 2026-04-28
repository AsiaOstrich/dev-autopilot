import { describe, it, expect } from "vitest";
import { createAtddCommand } from "../atdd.js";

describe("createAtddCommand", () => {
  it("returns a Command named 'atdd'", () => {
    const cmd = createAtddCommand();
    expect(cmd.name()).toBe("atdd");
  });

  it("accepts optional feature argument", () => {
    const cmd = createAtddCommand();
    const args = cmd.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(false);
  });

  it("has --phase option with valid phase IDs", () => {
    const cmd = createAtddCommand();
    const phaseOpt = cmd.options.find((o) => o.long === "--phase");
    expect(phaseOpt).toBeDefined();
  });

  it("has --test-cmd option defaulting to cucumber-js", () => {
    const cmd = createAtddCommand();
    const testCmdOpt = cmd.options.find((o) => o.long === "--test-cmd");
    expect(testCmdOpt).toBeDefined();
    expect(testCmdOpt?.defaultValue).toBe("npx cucumber-js");
  });

  it("describes the ATDD lifecycle phases", () => {
    const cmd = createAtddCommand();
    const desc = cmd.description();
    expect(desc).toContain("WORKSHOP");
    expect(desc).toContain("DONE");
  });

  it("exits with error for unknown --phase value", async () => {
    const cmd = createAtddCommand();
    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; throw new Error("exit"); }) as never;
    try {
      await cmd.parseAsync(["node", "atdd", "--phase", "invalid-phase"], { from: "user" });
    } catch {
      // expected
    } finally {
      process.exit = originalExit;
    }
    expect(exitCode).toBe(1);
  });
});
