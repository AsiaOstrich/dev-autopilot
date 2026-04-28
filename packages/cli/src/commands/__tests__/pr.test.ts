import { describe, it, expect } from "vitest";
import { createPrCommand } from "../pr.js";

describe("createPrCommand", () => {
  it("returns a Command named 'pr'", () => {
    const cmd = createPrCommand();
    expect(cmd.name()).toBe("pr");
  });

  it("accepts optional branch argument", () => {
    const cmd = createPrCommand();
    const args = cmd.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].required).toBe(false);
  });

  it("has --base option defaulting to main", () => {
    const cmd = createPrCommand();
    const baseOpt = cmd.options.find((o) => o.long === "--base");
    expect(baseOpt).toBeDefined();
    expect(baseOpt?.defaultValue).toBe("main");
  });

  it("has --pr option for existing PR number", () => {
    const cmd = createPrCommand();
    const prOpt = cmd.options.find((o) => o.long === "--pr");
    expect(prOpt).toBeDefined();
  });

  it("has --squash / --no-squash merge strategy options", () => {
    const cmd = createPrCommand();
    const squashOpt = cmd.options.find((o) => o.long === "--squash");
    expect(squashOpt).toBeDefined();
  });

  it("describes the PR lifecycle phases", () => {
    const cmd = createPrCommand();
    const desc = cmd.description();
    expect(desc).toContain("CREATE");
    expect(desc).toContain("MERGE");
    expect(desc).toContain("CLEANUP");
  });
});
