// [Implements XSPEC-089 AC-B1/B2] NpmPlatformAdapter 單元測試
import { describe, it, expect, vi } from "vitest";
import { NpmPlatformAdapter } from "../../../src/release/npm-adapter.js";
import { inferDistTag } from "../../../src/release/platform-adapter.js";

describe("inferDistTag (pure)", () => {
  // [Source: XSPEC-089 AC-B1] dist-tag 自動推斷
  it("should_return_latest_for_stable_version", () => {
    expect(inferDistTag("5.3.3")).toBe("latest");
    expect(inferDistTag("1.0.0")).toBe("latest");
  });

  it("should_return_beta_for_beta_prerelease", () => {
    expect(inferDistTag("5.4.0-beta.1")).toBe("beta");
    expect(inferDistTag("2.0.0-beta.10")).toBe("beta");
  });

  it("should_return_alpha_for_alpha_prerelease", () => {
    expect(inferDistTag("5.4.0-alpha.1")).toBe("alpha");
  });

  it("should_return_rc_for_rc_prerelease", () => {
    expect(inferDistTag("5.4.0-rc.1")).toBe("rc");
  });

  it("should_return_next_for_unknown_prerelease_id", () => {
    expect(inferDistTag("5.4.0-canary.1")).toBe("next");
    expect(inferDistTag("5.4.0-experimental.5")).toBe("next");
  });

  it("should_return_next_for_pure_numeric_prerelease", () => {
    expect(inferDistTag("5.3.3-0")).toBe("next");
    expect(inferDistTag("5.4.0-1")).toBe("next");
  });

  it("should_throw_on_invalid_version_format", () => {
    expect(() => inferDistTag("invalid")).toThrow(/版本格式/);
  });
});

describe("NpmPlatformAdapter", () => {
  it("should_have_platform_property_npm", () => {
    const adapter = new NpmPlatformAdapter();
    expect(adapter.platform).toBe("npm");
  });

  // [Source: XSPEC-089 AC-B1]
  it("getDistTag_should_delegate_to_inferDistTag", () => {
    const adapter = new NpmPlatformAdapter();
    expect(adapter.getDistTag("5.3.3")).toBe("latest");
    expect(adapter.getDistTag("5.4.0-beta.1")).toBe("beta");
  });

  describe("publish — dry-run", () => {
    it("should_not_call_shell_executor_in_dry_run", async () => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
      const adapter = new NpmPlatformAdapter();

      const result = await adapter.publish("5.3.3", {
        cwd: "/tmp",
        dryRun: true,
        shellExecutor: exec,
      });

      expect(exec).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.tag).toBe("latest");
      expect(result.output).toContain("[dry-run]");
      expect(result.output).toContain("v5.3.3");
    });
  });

  describe("publish — real call", () => {
    // [Source: XSPEC-089 AC-B2]
    it("should_call_gh_release_create_to_trigger_actions_publish", async () => {
      let capturedCmd = "";
      const exec = vi.fn(async (cmd: string) => {
        capturedCmd = cmd;
        return { exitCode: 0, stdout: "release created", stderr: "" };
      });

      const adapter = new NpmPlatformAdapter();
      const result = await adapter.publish("5.3.3", {
        cwd: "/tmp/proj",
        shellExecutor: exec,
      });

      expect(exec).toHaveBeenCalledTimes(1);
      expect(capturedCmd).toMatch(/^gh release create v5\.3\.3/);
      expect(result.success).toBe(true);
      expect(result.tag).toBe("latest");
    });

    it("should_return_failure_when_gh_command_fails", async () => {
      const exec = vi.fn(async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "release v5.3.3 already exists",
      }));

      const adapter = new NpmPlatformAdapter();
      const result = await adapter.publish("5.3.3", {
        cwd: "/tmp",
        shellExecutor: exec,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("gh release create 失敗");
      expect(result.error).toContain("already exists");
    });

    it("should_pass_correct_dist_tag_for_beta_version", async () => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
      const adapter = new NpmPlatformAdapter();

      const result = await adapter.publish("5.4.0-beta.1", {
        cwd: "/tmp",
        shellExecutor: exec,
      });

      expect(result.tag).toBe("beta");
    });
  });
});
