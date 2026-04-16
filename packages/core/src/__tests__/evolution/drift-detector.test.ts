import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DriftDetector } from "../../evolution/drift-detector.js";

// ─── Helpers ────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "drift-detector-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function mkStandardsDir(): string {
  const dir = join(tmpDir, ".standards");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Tests ──────────────────────────────────────────────────

describe("DriftDetector", () => {
  describe("analyze()", () => {
    it("無 .standards/ 目錄時應 skip（no_standards_dir）", async () => {
      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();
      expect(result.skipped).toBe(true);
      expect(result.skip_reason).toBe("no_standards_dir");
      expect(result.items).toHaveLength(0);
    });

    it(".standards/ 存在但無 yaml 時應回傳空結果", async () => {
      mkStandardsDir();
      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();
      expect(result.skipped).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it("yaml 中無路徑引用時不應產生 broken_reference", async () => {
      const stdDir = mkStandardsDir();
      writeFileSync(join(stdDir, "testing.ai.yaml"), [
        "name: testing",
        "description: 測試標準",
        "enforcement:",
        "  severity: error",
      ].join("\n"));
      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();
      expect(result.items.filter((i) => i.drift_type === "broken_reference")).toHaveLength(0);
    });

    it("yaml file: 欄位指向不存在的路徑應標記 broken_reference", async () => {
      const stdDir = mkStandardsDir();
      writeFileSync(join(stdDir, "commit-message.ai.yaml"), [
        "name: commit-message",
        "enforcement:",
        "  file: scripts/validate-commit.sh",
      ].join("\n"));
      // 不建立 scripts/validate-commit.sh

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();

      const broken = result.items.filter((i) => i.drift_type === "broken_reference");
      expect(broken).toHaveLength(1);
      expect(broken[0]!.source_file).toBe(".standards/commit-message.ai.yaml");
      expect(broken[0]!.reference).toContain("validate-commit.sh");
    });

    it("yaml file: 欄位指向存在的路徑不應標記", async () => {
      const stdDir = mkStandardsDir();
      mkdirSync(join(tmpDir, "scripts"), { recursive: true });
      writeFileSync(join(tmpDir, "scripts", "validate.sh"), "#!/bin/sh\n");
      writeFileSync(join(stdDir, "testing.ai.yaml"), [
        "name: testing",
        "enforcement:",
        "  file: scripts/validate.sh",
      ].join("\n"));

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();
      expect(result.items.filter((i) => i.drift_type === "broken_reference")).toHaveLength(0);
    });

    it("CLAUDE.md 中引用不存在的 standard 應標記 stale_standard", async () => {
      mkStandardsDir();
      // .standards/ 裡沒有 ghost.ai.yaml
      writeFileSync(join(tmpDir, "CLAUDE.md"), [
        "# Instructions",
        "Follow ghost.ai.yaml for all commits.",
      ].join("\n"));

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();

      const stale = result.items.filter((i) => i.drift_type === "stale_standard");
      expect(stale).toHaveLength(1);
      expect(stale[0]!.reference).toBe("ghost.ai.yaml");
      expect(stale[0]!.source_file).toBe("CLAUDE.md");
    });

    it("CLAUDE.md 中引用存在的 standard 不應標記", async () => {
      const stdDir = mkStandardsDir();
      writeFileSync(join(stdDir, "testing.ai.yaml"), "name: testing\n");
      writeFileSync(join(tmpDir, "CLAUDE.md"), [
        "# Instructions",
        "Follow testing.ai.yaml for all tests.",
      ].join("\n"));

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();
      expect(result.items.filter((i) => i.drift_type === "stale_standard")).toHaveLength(0);
    });

    it("AGENTS.md 也應被掃描（stale_standard）", async () => {
      mkStandardsDir();
      writeFileSync(join(tmpDir, "AGENTS.md"), [
        "# Agent Rules",
        "Always follow missing-standard.ai.yaml.",
      ].join("\n"));

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();

      const stale = result.items.filter((i) => i.drift_type === "stale_standard");
      expect(stale.some((i) => i.source_file === "AGENTS.md")).toBe(true);
    });

    it("同一文件同一引用不應重複記錄", async () => {
      mkStandardsDir();
      // ghost.ai.yaml 出現兩次
      writeFileSync(join(tmpDir, "CLAUDE.md"), [
        "Follow ghost.ai.yaml standards.",
        "Also see ghost.ai.yaml for details.",
      ].join("\n"));

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();

      const staleForGhost = result.items.filter(
        (i) => i.drift_type === "stale_standard" && i.reference === "ghost.ai.yaml",
      );
      expect(staleForGhost).toHaveLength(1);
    });

    it("files_scanned 應正確計數掃描的檔案數", async () => {
      const stdDir = mkStandardsDir();
      writeFileSync(join(stdDir, "testing.ai.yaml"), "name: testing\n");
      writeFileSync(join(stdDir, "commit-message.ai.yaml"), "name: commit-message\n");
      writeFileSync(join(tmpDir, "CLAUDE.md"), "# Instructions\n");

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();
      // 2 yaml + 1 CLAUDE.md = 3
      expect(result.files_scanned).toBe(3);
    });

    it("混合問題時 items 應包含所有飄移類型", async () => {
      const stdDir = mkStandardsDir();
      // broken_reference: yaml 指向不存在的 script
      writeFileSync(join(stdDir, "api-design.ai.yaml"), [
        "name: api-design",
        "enforcement:",
        "  script: tools/api-lint.sh",
      ].join("\n"));
      // stale_standard: CLAUDE.md 引用不存在的 standard
      writeFileSync(join(tmpDir, "CLAUDE.md"), "Follow ghost.ai.yaml.\n");

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();

      const broken = result.items.filter((i) => i.drift_type === "broken_reference");
      const stale = result.items.filter((i) => i.drift_type === "stale_standard");
      expect(broken.length).toBeGreaterThanOrEqual(1);
      expect(stale.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("writeReport()", () => {
    it("無飄移項目時不應寫入報告（回傳 null）", async () => {
      mkStandardsDir();
      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();
      const reportPath = await detector.writeReport(result, join(tmpDir, ".evolution"));
      expect(reportPath).toBeNull();
    });

    it("有飄移項目時應寫入 drift-report.md", async () => {
      mkStandardsDir();
      writeFileSync(join(tmpDir, "CLAUDE.md"), "Follow ghost.ai.yaml.\n");

      const detector = new DriftDetector(tmpDir);
      const result = await detector.analyze();
      const reportPath = await detector.writeReport(result, join(tmpDir, ".evolution"));

      expect(reportPath).not.toBeNull();
      expect(reportPath).toContain("drift-report.md");

      const { readFileSync } = await import("node:fs");
      const content = readFileSync(reportPath!, "utf-8");
      expect(content).toContain("ghost.ai.yaml");
      expect(content).toContain("stale_standard");
    });
  });
});
