// [Implements XSPEC-089 AC-A1/A5/A6] ReleaseFlow runner 單元測試
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReleaseFlow } from "../../../src/release/release-flow.js";
import type { ReleaseFlowOptions } from "../../../src/release/release-flow.js";
import type { VersionFileSpec } from "../../../src/release/version-bumper.js";
import { NpmPlatformAdapter } from "../../../src/release/npm-adapter.js";

describe("ReleaseFlow", () => {
  let tmpDir: string;
  let pkgPath: string;
  let changelogPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), "rf-test-"));
    pkgPath = path.join(tmpDir, "package.json");
    changelogPath = path.join(tmpDir, "CHANGELOG.md");
    await fs.writeFile(pkgPath, JSON.stringify({ version: "5.3.2" }, null, 2) + "\n");
    await fs.writeFile(changelogPath, "# Changelog\n\n## [5.3.2] - 2026-04-20\n", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function buildOptions(overrides: Partial<ReleaseFlowOptions> = {}): ReleaseFlowOptions {
    const versionFiles: VersionFileSpec[] = [{ path: "package.json", field: "version" }];
    return {
      rootDir: tmpDir,
      versionFiles,
      changelogPath,
      bumpLevel: "patch",
      date: "2026-04-27",
      ...overrides,
    };
  }

  // [Source: XSPEC-089 AC-A1] dry-run 列出步驟不修改檔案
  describe("dryRun", () => {
    it("should_list_all_steps_without_modifying_files_or_running_git", async () => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
      const steps = await ReleaseFlow.dryRun(buildOptions({ shellExecutor: exec }));

      expect(steps.map((s) => s.id)).toEqual([
        "version-bump",
        "changelog-update",
        "git-commit-tag",
        "git-push",
      ]);
      expect(steps[0].description).toContain("5.3.2 → 5.3.3");
      expect(steps[2].description).toContain("v5.3.3");
      expect(steps[3].description).toContain("git push origin main v5.3.3");
      expect(exec).not.toHaveBeenCalled();

      // 檔案不變
      expect(JSON.parse(await fs.readFile(pkgPath, "utf-8")).version).toBe("5.3.2");
      expect(await fs.readFile(changelogPath, "utf-8")).not.toContain("5.3.3");
    });

    it("should_include_publish_step_when_platformAdapter_provided", async () => {
      const adapter = new NpmPlatformAdapter();
      const steps = await ReleaseFlow.dryRun(buildOptions({ platformAdapter: adapter }));

      const publishStep = steps.find((s) => s.id === "publish");
      expect(publishStep).toBeDefined();
      expect(publishStep!.description).toContain("npm");
      expect(publishStep!.description).toContain("latest");
    });
  });

  // [Source: XSPEC-089 AC-A5] git tag 建立 (透過 shell exec)
  describe("run — happy path", () => {
    it("should_execute_steps_in_order_and_modify_files", async () => {
      const cmds: string[] = [];
      const exec = vi.fn(async (cmd: string) => {
        cmds.push(cmd);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      });

      const steps = await ReleaseFlow.run(buildOptions({ shellExecutor: exec }));

      expect(steps.every((s) => s.status === "completed")).toBe(true);
      expect(steps.map((s) => s.id)).toEqual([
        "version-bump",
        "changelog-update",
        "git-commit-tag",
        "git-push",
      ]);

      // 檔案已更新
      expect(JSON.parse(await fs.readFile(pkgPath, "utf-8")).version).toBe("5.3.3");
      expect(await fs.readFile(changelogPath, "utf-8")).toContain("## [5.3.3] - 2026-04-27");

      // git 指令依序呼叫
      expect(cmds[0]).toContain("git commit");
      expect(cmds[0]).toContain("git tag v5.3.3");
      expect(cmds[1]).toBe("git push origin main v5.3.3");
    });
  });

  // [Source: XSPEC-089 AC-A6] push 失敗 → publish 不執行 + 手動補救指令
  describe("run — push failure (AC-A6)", () => {
    it("should_not_execute_publish_when_push_fails_and_show_manual_recovery", async () => {
      const adapter = new NpmPlatformAdapter();
      const exec = vi.fn(async (cmd: string) => {
        if (cmd.startsWith("git push")) {
          return { exitCode: 1, stdout: "", stderr: "Network unreachable" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      });

      const steps = await ReleaseFlow.run(
        buildOptions({ shellExecutor: exec, platformAdapter: adapter })
      );

      const pushStep = steps.find((s) => s.id === "git-push")!;
      expect(pushStep.status).toBe("failed");
      expect(pushStep.error).toContain("git push 失敗");
      expect(pushStep.error).toContain("git push origin main v5.3.3"); // 手動補救指令

      // publish 必須是 skipped
      const publishStep = steps.find((s) => s.id === "publish")!;
      expect(publishStep.status).toBe("skipped");
    });
  });

  describe("run — onPushConfirm gate", () => {
    it("should_skip_push_and_publish_when_user_rejects_confirmation", async () => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
      const adapter = new NpmPlatformAdapter();

      const steps = await ReleaseFlow.run(
        buildOptions({
          shellExecutor: exec,
          platformAdapter: adapter,
          onPushConfirm: async () => false,
        })
      );

      // bump、changelog、commit-tag 都完成
      expect(steps.find((s) => s.id === "version-bump")?.status).toBe("completed");
      expect(steps.find((s) => s.id === "git-commit-tag")?.status).toBe("completed");

      // push 與 publish 都跳過
      const pushStep = steps.find((s) => s.id === "git-push")!;
      expect(pushStep.status).toBe("skipped");
      expect(pushStep.output).toContain("使用者取消");
      expect(pushStep.output).toContain("git push origin main v5.3.3");

      expect(steps.find((s) => s.id === "publish")?.status).toBe("skipped");
    });

    it("should_proceed_when_user_confirms", async () => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
      const steps = await ReleaseFlow.run(
        buildOptions({ shellExecutor: exec, onPushConfirm: async () => true })
      );
      expect(steps.find((s) => s.id === "git-push")?.status).toBe("completed");
    });
  });

  describe("run — publish step", () => {
    it("should_call_platform_adapter_publish_after_successful_push", async () => {
      const exec = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
      const adapter = new NpmPlatformAdapter();
      const publishSpy = vi.spyOn(adapter, "publish");

      await ReleaseFlow.run(buildOptions({ shellExecutor: exec, platformAdapter: adapter }));

      expect(publishSpy).toHaveBeenCalledWith(
        "5.3.3",
        expect.objectContaining({ cwd: tmpDir })
      );
    });
  });
});
