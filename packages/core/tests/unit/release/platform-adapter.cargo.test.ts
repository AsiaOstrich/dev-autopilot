// [Implements XSPEC-089 AC-C2] CargoPlatformAdapter 單元測試
import { describe, it, expect, vi } from "vitest";
import { CargoPlatformAdapter } from "../../../src/release/cargo-adapter.js";

describe("CargoPlatformAdapter", () => {
  it("should_have_platform_property_cargo", () => {
    expect(new CargoPlatformAdapter().platform).toBe("cargo");
  });

  describe("getDistTag", () => {
    it("should_return_stable_for_release_version", () => {
      expect(new CargoPlatformAdapter().getDistTag("0.3.0")).toBe("stable");
    });

    it("should_return_alpha_for_alpha_prerelease", () => {
      expect(new CargoPlatformAdapter().getDistTag("0.3.0-alpha.1")).toBe("alpha");
    });
  });

  describe("publish — dry-run", () => {
    it("should_not_invoke_shell_in_devap_dry_run", async () => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
      const result = await new CargoPlatformAdapter().publish("0.3.0", {
        cwd: "/tmp",
        dryRun: true,
        shellExecutor: exec,
      });
      expect(exec).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.output).toContain("[dry-run] cargo publish");
    });

    it("should_invoke_cargo_with_dry_run_flag_when_cargoDryRun_set", async () => {
      let capturedCmd = "";
      const exec = vi.fn(async (cmd: string) => {
        capturedCmd = cmd;
        return { exitCode: 0, stdout: "", stderr: "" };
      });

      await new CargoPlatformAdapter().publish("0.3.0", {
        cwd: "/proj",
        shellExecutor: exec,
        cargoDryRun: true,
      });

      expect(exec).toHaveBeenCalledTimes(1);
      expect(capturedCmd).toContain("--dry-run");
    });
  });

  // [Source: XSPEC-089 AC-C2]
  describe("publish — real call", () => {
    it("should_call_cargo_publish", async () => {
      let capturedCmd = "";
      const exec = vi.fn(async (cmd: string) => {
        capturedCmd = cmd;
        return { exitCode: 0, stdout: "Uploading my-crate v0.3.0", stderr: "" };
      });

      const result = await new CargoPlatformAdapter().publish("0.3.0", {
        cwd: "/proj",
        shellExecutor: exec,
      });

      expect(exec).toHaveBeenCalledTimes(1);
      expect(capturedCmd).toBe("cargo publish");
      expect(result.success).toBe(true);
      expect(result.platform).toBe("cargo");
    });

    it("should_include_allow_dirty_flag_when_set", async () => {
      let capturedCmd = "";
      const exec = vi.fn(async (cmd: string) => {
        capturedCmd = cmd;
        return { exitCode: 0, stdout: "", stderr: "" };
      });

      await new CargoPlatformAdapter().publish("0.3.0", {
        cwd: "/proj",
        shellExecutor: exec,
        allowDirty: true,
      });

      expect(capturedCmd).toBe("cargo publish --allow-dirty");
    });

    it("should_return_failure_when_cargo_publish_fails", async () => {
      const exec = vi.fn(async () => ({
        exitCode: 101,
        stdout: "",
        stderr: "error: crate version `0.3.0` is already uploaded",
      }));

      const result = await new CargoPlatformAdapter().publish("0.3.0", {
        cwd: "/proj",
        shellExecutor: exec,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("cargo publish 失敗");
      expect(result.error).toContain("already uploaded");
    });
  });
});
