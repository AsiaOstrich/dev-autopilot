import { describe, it, expect } from "vitest";
import { createMissionCommand } from "../mission.js";

describe("createMissionCommand", () => {
  it("returns a Command named 'mission'", () => {
    const cmd = createMissionCommand();
    expect(cmd.name()).toBe("mission");
  });

  it("has 'start' subcommand", () => {
    const cmd = createMissionCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain("start");
  });

  it("has 'status' subcommand", () => {
    const cmd = createMissionCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain("status");
  });

  it("has 'pause' and 'resume' subcommands", () => {
    const cmd = createMissionCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain("pause");
    expect(names).toContain("resume");
  });

  it("has 'cancel' and 'list' subcommands", () => {
    const cmd = createMissionCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain("cancel");
    expect(names).toContain("list");
  });

  it("start subcommand exits with error for invalid type", async () => {
    const cmd = createMissionCommand();
    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; throw new Error("exit"); }) as never;
    try {
      await cmd.parseAsync(
        ["node", "mission", "start", "invalid-type", "do something"],
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
