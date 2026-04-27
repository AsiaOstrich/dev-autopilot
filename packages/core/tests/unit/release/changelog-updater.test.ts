// [Implements XSPEC-089 AC-A4] ChangelogUpdater 單元測試
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChangelogUpdater } from "../../../src/release/changelog-updater.js";

describe("ChangelogUpdater", () => {
  let tmpDir: string;
  let changelogPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), "cl-test-"));
    changelogPath = path.join(tmpDir, "CHANGELOG.md");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // [Source: XSPEC-089 AC-A4]
  it("should_insert_new_version_section_at_top_of_changelog", async () => {
    const original = `# Changelog\n\n## [5.3.2] - 2026-04-20\n\n- Old content\n`;
    await fs.writeFile(changelogPath, original, "utf-8");

    const updater = new ChangelogUpdater(changelogPath);
    const plan = await updater.plan("5.3.3", "2026-04-27", "- New feature");
    await updater.apply(plan);

    const updated = await fs.readFile(changelogPath, "utf-8");

    // 新段落應出現在舊段落之前
    const newIdx = updated.indexOf("## [5.3.3]");
    const oldIdx = updated.indexOf("## [5.3.2]");
    expect(newIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(oldIdx);

    expect(updated).toContain("## [5.3.3] - 2026-04-27");
    expect(updated).toContain("- New feature");
  });

  it("should_preserve_existing_sections_unchanged", async () => {
    const original = `# Changelog\n\n## [5.3.2] - 2026-04-20\n\n- Old content\n\n## [5.3.1] - 2026-04-15\n\n- Older content\n`;
    await fs.writeFile(changelogPath, original, "utf-8");

    const updater = new ChangelogUpdater(changelogPath);
    const plan = await updater.plan("5.3.3", "2026-04-27");
    await updater.apply(plan);

    const updated = await fs.readFile(changelogPath, "utf-8");
    expect(updated).toContain("## [5.3.2] - 2026-04-20\n\n- Old content");
    expect(updated).toContain("## [5.3.1] - 2026-04-15\n\n- Older content");
  });

  it("should_insert_before_unreleased_section", async () => {
    const original = `# Changelog\n\n## [Unreleased]\n\n- WIP\n`;
    await fs.writeFile(changelogPath, original, "utf-8");

    const updater = new ChangelogUpdater(changelogPath);
    const plan = await updater.plan("5.3.3", "2026-04-27");
    await updater.apply(plan);

    const updated = await fs.readFile(changelogPath, "utf-8");
    const newIdx = updated.indexOf("## [5.3.3]");
    const unreleasedIdx = updated.indexOf("## [Unreleased]");
    expect(newIdx).toBeLessThan(unreleasedIdx);
  });

  it("should_insert_at_top_when_no_existing_version_section", async () => {
    const original = `# Changelog\n\nIntro text.\n`;
    await fs.writeFile(changelogPath, original, "utf-8");

    const updater = new ChangelogUpdater(changelogPath);
    const plan = await updater.plan("5.3.3", "2026-04-27");
    await updater.apply(plan);

    const updated = await fs.readFile(changelogPath, "utf-8");
    expect(updated).toContain("## [5.3.3] - 2026-04-27");
  });

  it("should_not_modify_oldContent_in_plan", async () => {
    const original = `# Changelog\n\n## [5.3.2] - 2026-04-20\n`;
    await fs.writeFile(changelogPath, original, "utf-8");

    const updater = new ChangelogUpdater(changelogPath);
    const plan = await updater.plan("5.3.3", "2026-04-27");

    // plan 階段檔案不應被修改
    const onDisk = await fs.readFile(changelogPath, "utf-8");
    expect(onDisk).toBe(original);
    expect(plan.oldContent).toBe(original);
    expect(plan.newContent).toContain("## [5.3.3]");
  });

  describe("buildSection (static)", () => {
    it("should_build_header_only_when_body_omitted", () => {
      expect(ChangelogUpdater.buildSection("5.3.3", "2026-04-27")).toBe(
        "## [5.3.3] - 2026-04-27\n"
      );
    });

    it("should_include_body_when_provided", () => {
      const result = ChangelogUpdater.buildSection("5.3.3", "2026-04-27", "- Feature A\n- Fix B");
      expect(result).toContain("## [5.3.3] - 2026-04-27\n\n- Feature A\n- Fix B");
    });
  });
});
