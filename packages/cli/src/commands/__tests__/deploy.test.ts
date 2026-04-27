/**
 * XSPEC-093: devap deploy CLI tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDeployCommand } from "../deploy.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("@devap/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devap/core")>();
  return {
    ...actual,
    DeployRunner: vi.fn(),
  };
});

import { existsSync, readFileSync } from "node:fs";
import { DeployRunner } from "@devap/core";

const validConfig = JSON.stringify({
  environments: {
    staging: { type: "cloudflare-workers", command: "wrangler deploy --env staging" },
    prod: { type: "cloudflare-workers", command: "wrangler deploy --env production", requires_staging: true },
  },
});

describe("createDeployCommand", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let processExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    processExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    processExit.mockRestore();
  });

  it("should_create_command_with_target_option", () => {
    const cmd = createDeployCommand();
    expect(cmd.name()).toBe("deploy");
    expect(cmd.options.some((o) => o.long === "--target")).toBe(true);
  });

  it("should_exit_1_when_config_missing", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const cmd = createDeployCommand();
    await cmd.parseAsync(["--target", "staging"], { from: "user" });
    expect(processExit).toHaveBeenCalledWith(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("devap.config.json"));
  });

  it("should_exit_1_when_target_env_not_in_config", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(validConfig);
    const cmd = createDeployCommand();
    await cmd.parseAsync(["--target", "unknown"], { from: "user" });
    expect(processExit).toHaveBeenCalledWith(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("unknown"));
  });

  it("should_call_deploy_runner_for_valid_target", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(validConfig);
    const mockDeploy = vi.fn().mockResolvedValue({ success: true, environment: "staging", output: "ok" });
    vi.mocked(DeployRunner).mockImplementation(() => ({ deploy: mockDeploy }) as unknown as InstanceType<typeof DeployRunner>);

    const cmd = createDeployCommand();
    await cmd.parseAsync(["--target", "staging"], { from: "user" });
    expect(mockDeploy).toHaveBeenCalledWith("staging");
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("成功"));
  });

  it("should_exit_1_and_show_error_when_deploy_fails", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(validConfig);
    const mockDeploy = vi.fn().mockResolvedValue({
      success: false,
      environment: "staging",
      output: "",
      error: "wrangler error",
    });
    vi.mocked(DeployRunner).mockImplementation(() => ({ deploy: mockDeploy }) as unknown as InstanceType<typeof DeployRunner>);

    const cmd = createDeployCommand();
    await cmd.parseAsync(["--target", "staging"], { from: "user" });
    expect(processExit).toHaveBeenCalledWith(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("失敗"));
  });
});
