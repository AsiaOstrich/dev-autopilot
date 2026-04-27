// [Implements XSPEC-089 AC-A2/A3] VersionBumper 單元測試
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { VersionBumper, bumpVersion } from "../../../src/release/version-bumper.js";
import type { VersionFileSpec } from "../../../src/release/version-bumper.js";

// ─────────────────────────────────────────────
// bumpVersion (pure function)
// ─────────────────────────────────────────────

describe("bumpVersion", () => {
  it("should_bump_patch", () => {
    expect(bumpVersion("5.3.2", "patch")).toBe("5.3.3");
  });

  it("should_bump_minor_and_reset_patch", () => {
    expect(bumpVersion("5.3.2", "minor")).toBe("5.4.0");
  });

  it("should_bump_major_and_reset_minor_patch", () => {
    expect(bumpVersion("5.3.2", "major")).toBe("6.0.0");
  });

  it("should_drop_prerelease_on_patch_bump", () => {
    expect(bumpVersion("5.3.2-beta.1", "patch")).toBe("5.3.3");
  });

  it("should_create_prerelease_from_stable", () => {
    expect(bumpVersion("5.3.2", "prerelease")).toBe("5.3.3-0");
  });

  it("should_increment_existing_prerelease_number", () => {
    expect(bumpVersion("5.4.0-beta.1", "prerelease")).toBe("5.4.0-beta.2");
  });

  it("should_increment_simple_numeric_prerelease", () => {
    expect(bumpVersion("5.4.0-0", "prerelease")).toBe("5.4.0-1");
  });

  it("should_throw_on_invalid_version_format", () => {
    expect(() => bumpVersion("abc", "patch")).toThrow(/版本格式/);
  });
});

// ─────────────────────────────────────────────
// VersionBumper (with file system)
// ─────────────────────────────────────────────

describe("VersionBumper", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), "vb-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFile(rel: string, content: string): Promise<void> {
    const full = path.join(tmpDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
  }

  async function readFile(rel: string): Promise<string> {
    return fs.readFile(path.join(tmpDir, rel), "utf-8");
  }

  // [Source: XSPEC-089 AC-A2] 多檔同步 + 原子性
  it("should_update_all_version_files_atomically_on_patch_bump", async () => {
    await writeFile("package.json", JSON.stringify({ version: "5.3.2" }, null, 2) + "\n");
    await writeFile(
      "registry.json",
      JSON.stringify(
        { version: "5.3.2", repositories: { standards: { version: "5.3.2" } } },
        null,
        2
      ) + "\n"
    );
    await writeFile("README.md", "# Project\n\n**Version**: 5.3.2\n");

    const specs: VersionFileSpec[] = [
      { path: "package.json", field: "version" },
      { path: "registry.json", fields: ["version", "repositories.standards.version"] },
      { path: "README.md", pattern: "**Version**: {version}" },
    ];

    const bumper = new VersionBumper(tmpDir, specs);
    const plan = await bumper.plan("patch");

    expect(plan.from).toBe("5.3.2");
    expect(plan.to).toBe("5.3.3");
    expect(plan.files).toHaveLength(3);

    await bumper.apply(plan);

    expect(JSON.parse(await readFile("package.json")).version).toBe("5.3.3");
    const registry = JSON.parse(await readFile("registry.json"));
    expect(registry.version).toBe("5.3.3");
    expect(registry.repositories.standards.version).toBe("5.3.3");
    expect(await readFile("README.md")).toContain("**Version**: 5.3.3");
  });

  // [Source: XSPEC-089 AC-A3] 失敗時所有檔案回復
  it("should_rollback_all_files_when_any_update_fails", async () => {
    await writeFile("a.json", JSON.stringify({ version: "5.3.2" }) + "\n");
    await writeFile("b.json", JSON.stringify({ version: "5.3.2" }) + "\n");

    const specs: VersionFileSpec[] = [
      { path: "a.json", field: "version" },
      { path: "b.json", field: "version" },
    ];

    const bumper = new VersionBumper(tmpDir, specs);
    const plan = await bumper.plan("patch");

    // 模擬第二個檔案寫入失敗：把 plan 中第二個檔案的路徑換成不可寫的目錄
    const badPlan = {
      ...plan,
      files: [plan.files[0], { ...plan.files[1], path: path.join(tmpDir, "nonexistent-dir/b.json") }],
    };

    await expect(bumper.apply(badPlan)).rejects.toThrow(/寫入失敗/);

    // 驗證第一個檔案已回復
    expect(JSON.parse(await readFile("a.json")).version).toBe("5.3.2");
  });

  // [Source: XSPEC-089 AC-A1（dry-run 一部分）] plan 不寫入
  it("should_return_planned_changes_without_writing_in_plan", async () => {
    await writeFile("package.json", JSON.stringify({ version: "5.3.2" }) + "\n");

    const bumper = new VersionBumper(tmpDir, [{ path: "package.json", field: "version" }]);
    const plan = await bumper.plan("patch");

    expect(plan.to).toBe("5.3.3");
    // 檔案內容應仍為 5.3.2（plan 未呼叫 apply）
    expect(JSON.parse(await readFile("package.json")).version).toBe("5.3.2");
  });

  it("should_throw_when_pattern_does_not_match", async () => {
    await writeFile("README.md", "# Project (no version line)\n");
    const bumper = new VersionBumper(tmpDir, [
      { path: "README.md", pattern: "**Version**: {version}" },
    ]);
    await expect(
      bumper.planForVersion("5.3.2", "5.3.3")
    ).rejects.toThrow(/找不到符合樣式/);
  });

  it("should_preserve_trailing_newline_in_json_files", async () => {
    await writeFile("package.json", JSON.stringify({ version: "5.3.2" }, null, 2) + "\n");
    const bumper = new VersionBumper(tmpDir, [{ path: "package.json", field: "version" }]);
    const plan = await bumper.plan("patch");
    await bumper.apply(plan);

    const content = await readFile("package.json");
    expect(content.endsWith("\n")).toBe(true);
  });
});
