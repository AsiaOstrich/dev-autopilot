import { describe, it, expect } from "vitest";
import { createSweepCommand } from "../sweep.js";

describe("createSweepCommand", () => {
  it("returns a Command named 'sweep'", () => {
    const cmd = createSweepCommand();
    expect(cmd.name()).toBe("sweep");
  });

  it("has --fix option", () => {
    const cmd = createSweepCommand();
    expect(cmd.options.some((o) => o.long === "--fix")).toBe(true);
  });

  it("has --report option", () => {
    const cmd = createSweepCommand();
    expect(cmd.options.some((o) => o.long === "--report")).toBe(true);
  });

  it("has --patterns option", () => {
    const cmd = createSweepCommand();
    expect(cmd.options.some((o) => o.long === "--patterns")).toBe(true);
  });

  it("has --cwd option", () => {
    const cmd = createSweepCommand();
    expect(cmd.options.some((o) => o.long === "--cwd")).toBe(true);
  });

  it("has --exclude option", () => {
    const cmd = createSweepCommand();
    expect(cmd.options.some((o) => o.long === "--exclude")).toBe(true);
  });
});
