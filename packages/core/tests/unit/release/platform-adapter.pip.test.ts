// [Implements XSPEC-089 AC-C1] PipPlatformAdapter 單元測試
import { describe, it, expect, vi } from "vitest";
import { PipPlatformAdapter } from "../../../src/release/pip-adapter.js";

describe("PipPlatformAdapter", () => {
  it("should_have_platform_property_pip", () => {
    expect(new PipPlatformAdapter().platform).toBe("pip");
  });

  describe("getDistTag", () => {
    it("should_return_stable_for_release_version", () => {
      expect(new PipPlatformAdapter().getDistTag("1.2.3")).toBe("stable");
    });

    it("should_return_prerelease_id_for_beta_version", () => {
      expect(new PipPlatformAdapter().getDistTag("2.0.0-beta.1")).toBe("beta");
    });
  });

  describe("publish — dry-run", () => {
    it("should_not_invoke_shell_in_dry_run", async () => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
      const result = await new PipPlatformAdapter().publish("1.2.3", {
        cwd: "/tmp",
        dryRun: true,
        shellExecutor: exec,
      });
      expect(exec).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.output).toContain("[dry-run]");
      expect(result.output).toContain("python -m build");
      expect(result.output).toContain("twine upload");
    });
  });

  // [Source: XSPEC-089 AC-C1]
  describe("publish — real call", () => {
    it("should_call_python_build_then_twine_upload_in_order", async () => {
      const cmds: string[] = [];
      const exec = vi.fn(async (cmd: string) => {
        cmds.push(cmd);
        return { exitCode: 0, stdout: `ok: ${cmd}`, stderr: "" };
      });

      const result = await new PipPlatformAdapter().publish("1.2.3", {
        cwd: "/proj",
        shellExecutor: exec,
      });

      expect(cmds).toHaveLength(2);
      expect(cmds[0]).toBe("python -m build");
      expect(cmds[1]).toBe("twine upload dist/*");
      expect(result.success).toBe(true);
      expect(result.platform).toBe("pip");
    });

    it("should_use_testpypi_repository_when_specified", async () => {
      const cmds: string[] = [];
      const exec = vi.fn(async (cmd: string) => {
        cmds.push(cmd);
        return { exitCode: 0, stdout: "", stderr: "" };
      });

      await new PipPlatformAdapter().publish("1.2.3", {
        cwd: "/proj",
        shellExecutor: exec,
        repository: "testpypi",
      });

      expect(cmds[1]).toBe("twine upload --repository testpypi dist/*");
    });

    it("should_return_failure_when_build_fails", async () => {
      const exec = vi.fn(async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "ImportError: build module not found",
      }));

      const result = await new PipPlatformAdapter().publish("1.2.3", {
        cwd: "/proj",
        shellExecutor: exec,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("python -m build 失敗");
      expect(exec).toHaveBeenCalledTimes(1); // upload 不應該被呼叫
    });

    it("should_return_failure_when_twine_upload_fails", async () => {
      let call = 0;
      const exec = vi.fn(async () => {
        call += 1;
        return call === 1
          ? { exitCode: 0, stdout: "build ok", stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "401 Unauthorized" };
      });

      const result = await new PipPlatformAdapter().publish("1.2.3", {
        cwd: "/proj",
        shellExecutor: exec,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("twine upload 失敗");
      expect(result.error).toContain("401 Unauthorized");
    });
  });
});
