import { describe, it, expect } from "vitest";
import { createHitlCommand } from "../hitl.js";

describe("createHitlCommand", () => {
  it("returns a Command named 'hitl'", () => {
    const cmd = createHitlCommand();
    expect(cmd.name()).toBe("hitl");
  });

  it("requires --op option", () => {
    const cmd = createHitlCommand();
    const opOpt = cmd.options.find((o) => o.long === "--op");
    expect(opOpt).toBeDefined();
    expect(opOpt?.mandatory).toBe(true);
  });

  it("has --desc option with default value", () => {
    const cmd = createHitlCommand();
    const descOpt = cmd.options.find((o) => o.long === "--desc");
    expect(descOpt).toBeDefined();
    expect(descOpt?.defaultValue).toBe("Human review required");
  });

  it("has --timeout option", () => {
    const cmd = createHitlCommand();
    const timeoutOpt = cmd.options.find((o) => o.long === "--timeout");
    expect(timeoutOpt).toBeDefined();
  });

  it("has --always-require option for whitelist", () => {
    const cmd = createHitlCommand();
    const whitelistOpt = cmd.options.find((o) => o.long === "--always-require");
    expect(whitelistOpt).toBeDefined();
  });

  it("has --skip-if-not-required flag", () => {
    const cmd = createHitlCommand();
    const skipOpt = cmd.options.find((o) => o.long === "--skip-if-not-required");
    expect(skipOpt).toBeDefined();
  });
});
