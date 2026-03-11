import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** devap 專有 skills 清單 */
const DEVAP_SKILLS = ["plan", "orchestrate", "dev-workflow-guide"];

// 建立 mock skills 來源
const MOCK_SKILLS_DIR = mkdtempSync(join(tmpdir(), "devap-skills-src-"));

const MOCK_SKILLS = [
  { name: "plan", files: [{ name: "SKILL.md", content: "# Plan Skill" }] },
  {
    name: "orchestrate",
    files: [
      { name: "SKILL.md", content: "# Orchestrate Skill" },
      { name: "execution-guide.md", content: "# Execution Guide" },
    ],
  },
  {
    name: "dev-workflow-guide",
    files: [
      { name: "SKILL.md", content: "# Dev Workflow Guide" },
      { name: "workflow-phases.md", content: "# Workflow Phases" },
    ],
  },
];

for (const skill of MOCK_SKILLS) {
  const dir = join(MOCK_SKILLS_DIR, skill.name);
  mkdirSync(dir, { recursive: true });
  for (const file of skill.files) {
    writeFileSync(join(dir, file.name), file.content);
  }
}

/**
 * 模擬 executeInit 核心邏輯（使用 mock 來源目錄）
 */
function executeInitForTest(options: {
  force?: boolean;
  target?: string;
}): { installed: number; skipped: number; targetBase: string } {
  const { force = false, target = "." } = options;
  const skillsSource = MOCK_SKILLS_DIR;
  const targetBase = resolve(target, ".claude", "skills");
  mkdirSync(targetBase, { recursive: true });

  let installed = 0;
  let skipped = 0;

  for (const skill of DEVAP_SKILLS) {
    const src = resolve(skillsSource, skill);
    const dest = resolve(targetBase, skill);

    if (!existsSync(src)) {
      skipped++;
      continue;
    }

    if (existsSync(dest) && !force) {
      const files = readdirSync(dest);
      if (files.length > 0) {
        skipped++;
        continue;
      }
    }

    cpSync(src, dest, { recursive: true });
    installed++;
  }

  return { installed, skipped, targetBase };
}

describe("devap init", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "devap-init-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("正常安裝 — 3 個 skill 目錄都存在", () => {
    const result = executeInitForTest({ target: tempDir });

    expect(result.installed).toBe(3);
    expect(result.skipped).toBe(0);

    for (const skill of DEVAP_SKILLS) {
      const skillDir = join(tempDir, ".claude", "skills", skill);
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    }

    // 檢查特定檔案
    expect(
      existsSync(
        join(tempDir, ".claude", "skills", "orchestrate", "execution-guide.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          tempDir,
          ".claude",
          "skills",
          "dev-workflow-guide",
          "workflow-phases.md",
        ),
      ),
    ).toBe(true);
  });

  it("已存在 + 無 force → 跳過不覆蓋", () => {
    executeInitForTest({ target: tempDir });

    // 修改檔案內容
    const marker = join(tempDir, ".claude", "skills", "plan", "SKILL.md");
    writeFileSync(marker, "# Modified");

    // 再安裝一次（不 force）
    const result = executeInitForTest({ target: tempDir });

    expect(result.installed).toBe(0);
    expect(result.skipped).toBe(3);

    // 確認檔案未被覆蓋
    expect(readFileSync(marker, "utf-8")).toBe("# Modified");
  });

  it("已存在 + force → 覆蓋", () => {
    executeInitForTest({ target: tempDir });

    // 修改檔案內容
    const marker = join(tempDir, ".claude", "skills", "plan", "SKILL.md");
    writeFileSync(marker, "# Modified");

    // 用 force 再安裝
    const result = executeInitForTest({ target: tempDir, force: true });

    expect(result.installed).toBe(3);
    expect(result.skipped).toBe(0);

    // 確認檔案已被覆蓋
    expect(readFileSync(marker, "utf-8")).toBe("# Plan Skill");
  });

  it("目標不存在 → 自動建立", () => {
    const deepTarget = join(tempDir, "a", "b", "c");
    expect(existsSync(deepTarget)).toBe(false);

    const result = executeInitForTest({ target: deepTarget });

    expect(result.installed).toBe(3);
    expect(
      existsSync(join(deepTarget, ".claude", "skills", "plan", "SKILL.md")),
    ).toBe(true);
  });
});
