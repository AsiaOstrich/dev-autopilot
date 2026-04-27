// [Implements XSPEC-089] devap release CLI command tests
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReleaseCommand } from "../release.js";

describe("createReleaseCommand", () => {
  it("should_register_release_command_with_required_options", () => {
    const cmd = createReleaseCommand();
    expect(cmd.name()).toBe("release");

    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--bump");
    expect(opts).toContain("--dry-run");
    expect(opts).toContain("--platform");
    expect(opts).toContain("--skip-confirm");
  });

  it("should_have_bump_as_required_option", () => {
    const cmd = createReleaseCommand();
    const bumpOpt = cmd.options.find((o) => o.long === "--bump");
    expect(bumpOpt?.required).toBe(true);
  });
});

describe("devap release — config loading", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "release-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should_fail_when_config_file_missing", async () => {
    const cmd = createReleaseCommand();

    // process.exit 會被測試框架捕獲；用 spy 驗證
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(cmd.parseAsync(["node", "release", "--bump", "patch"])).rejects.toThrow(
      "process.exit(1)"
    );

    const calls = errSpy.mock.calls.map((c) => c.join(" "));
    expect(calls.join("\n")).toContain(".devap/release-config.json");

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("should_fail_when_bump_value_is_invalid", async () => {
    // 必須先有 config 才能進到 bump 驗證
    mkdirSync(join(tmpDir, ".devap"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".devap", "release-config.json"),
      JSON.stringify({
        versionFiles: [{ path: "package.json", field: "version" }],
        changelog: { path: "CHANGELOG.md" },
      })
    );

    const cmd = createReleaseCommand();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      cmd.parseAsync(["node", "release", "--bump", "invalid-level"])
    ).rejects.toThrow("process.exit(1)");

    const calls = errSpy.mock.calls.map((c) => c.join(" "));
    expect(calls.join("\n")).toContain("--bump");

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("devap release — dry-run", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "release-dryrun-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // 建立完整測試環境
    mkdirSync(join(tmpDir, ".devap"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".devap", "release-config.json"),
      JSON.stringify({
        versionFiles: [{ path: "package.json", field: "version" }],
        changelog: { path: "CHANGELOG.md" },
      })
    );
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ version: "1.0.0" }, null, 2));
    writeFileSync(join(tmpDir, "CHANGELOG.md"), "# Changelog\n");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // [Source: XSPEC-089 AC-A1] dry-run 不修改檔案
  it("should_not_modify_any_files_in_dry_run", async () => {
    const cmd = createReleaseCommand();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await cmd.parseAsync(["node", "release", "--bump", "patch", "--dry-run"]);

    const pkg = require("fs").readFileSync(join(tmpDir, "package.json"), "utf-8");
    expect(JSON.parse(pkg).version).toBe("1.0.0");
    const changelog = require("fs").readFileSync(join(tmpDir, "CHANGELOG.md"), "utf-8");
    expect(changelog).toBe("# Changelog\n");

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Dry-run");
    expect(output).toContain("1.0.0 → 1.0.1");

    logSpy.mockRestore();
  });

  it("should_include_publish_step_when_platform_is_specified", async () => {
    const cmd = createReleaseCommand();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await cmd.parseAsync([
      "node",
      "release",
      "--bump",
      "patch",
      "--dry-run",
      "--platform",
      "npm",
    ]);

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("publish to npm");
    expect(output).toContain("latest"); // dist-tag for stable

    logSpy.mockRestore();
  });

  it("should_reject_invalid_platform_value", async () => {
    const cmd = createReleaseCommand();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      cmd.parseAsync(["node", "release", "--bump", "patch", "--platform", "rubygems"])
    ).rejects.toThrow("process.exit(1)");

    const errors = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errors).toContain("rubygems");

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// 確認 .devap/release-config.json 樣板可以被解析（schema 文件化）
describe("devap release — config schema", () => {
  it("should_accept_versionFiles_with_field_or_fields_or_pattern", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "release-schema-"));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    mkdirSync(join(tmpDir, ".devap"), { recursive: true });
    const config = {
      versionFiles: [
        { path: "package.json", field: "version" },
        { path: "registry.json", fields: ["version", "repos.a.version"] },
        { path: "README.md", pattern: "**Version**: {version}" },
      ],
      changelog: { path: "CHANGELOG.md" },
      branch: "develop",
    };
    writeFileSync(join(tmpDir, ".devap", "release-config.json"), JSON.stringify(config, null, 2));
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ version: "2.0.0" }, null, 2));
    writeFileSync(
      join(tmpDir, "registry.json"),
      JSON.stringify({ version: "2.0.0", repos: { a: { version: "2.0.0" } } }, null, 2)
    );
    writeFileSync(join(tmpDir, "README.md"), "# Project\n\n**Version**: 2.0.0\n");
    writeFileSync(join(tmpDir, "CHANGELOG.md"), "# Changelog\n");

    const cmd = createReleaseCommand();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await cmd.parseAsync(["node", "release", "--bump", "minor", "--dry-run"]);

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("2.0.0 → 2.1.0");
    expect(output).toContain("git push origin develop"); // 自訂 branch

    expect(existsSync(join(tmpDir, "package.json"))).toBe(true); // 沒被刪
    logSpy.mockRestore();

    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
