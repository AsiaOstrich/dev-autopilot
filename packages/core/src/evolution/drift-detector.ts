/**
 * DriftDetector（XSPEC-004 Phase 4.5）
 *
 * 偵測 `.standards/*.ai.yaml` 和 `CLAUDE.md` / `AGENTS.md` 中引用的路徑或標準
 * 是否仍然存在，若發現失效引用則標記並產出 drift-report.md。
 *
 * 掃描策略：
 *
 * 1. **broken_reference**：掃描 `.standards/*.ai.yaml` 中所有看起來像檔案路徑的字串
 *    （如 `file:`, `path:`, `script:`, `hook:` 欄位值），檢查是否存在於 cwd。
 *
 * 2. **stale_standard**：掃描 `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` 中
 *    形如 `xxx.ai.yaml` 的標準引用，檢查是否存在於 `.standards/`。
 */

import { readdir, readFile, access } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { constants } from "node:fs";
import type { DriftAnalysisResult, DriftItem } from "./types.js";

/** 看起來像相對或絕對路徑的值（含副檔名，且不含空格）的正規式 */
const PATH_LIKE = /^\.{0,2}\/[\w.\-/]+\.\w+$|^[\w.\-/]+\/[\w.\-/]+\.\w+$/;

/** YAML 中典型指向檔案的 key（key: value 形式） */
const FILE_KEYS = new Set(["file", "path", "script", "hook", "template", "include"]);

/** 掃描 markdown/text 中的 `xxx.ai.yaml` 引用 */
const STANDARD_REF_RE = /\b([\w-]+\.ai\.yaml)\b/g;

/** 在單行 YAML 中抽取 `key: value` 的 value */
function extractYamlLineValue(line: string): string | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx < 0) return null;
  const key = line.slice(0, colonIdx).trim().toLowerCase().replace(/^-\s*/, "");
  if (!FILE_KEYS.has(key)) return null;
  const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, "");
  return value || null;
}

export class DriftDetector {
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async analyze(): Promise<DriftAnalysisResult> {
    const timestamp = new Date().toISOString();
    const items: DriftItem[] = [];
    let filesScanned = 0;

    const standardsDir = join(this.cwd, ".standards");

    // 確認 .standards/ 存在
    try {
      await access(standardsDir, constants.R_OK);
    } catch {
      return {
        analyzer: "drift-detector",
        timestamp,
        files_scanned: 0,
        items: [],
        skipped: true,
        skip_reason: "no_standards_dir",
      };
    }

    // ── 1. 掃描 .standards/*.ai.yaml 中的 broken_reference ──────────
    let yamlFiles: string[] = [];
    try {
      const entries = await readdir(standardsDir);
      yamlFiles = entries.filter((f) => f.endsWith(".ai.yaml"));
    } catch {
      yamlFiles = [];
    }

    for (const yamlFile of yamlFiles) {
      const yamlPath = join(standardsDir, yamlFile);
      let content: string;
      try {
        content = await readFile(yamlPath, "utf-8");
      } catch {
        continue;
      }
      filesScanned++;

      for (const line of content.split("\n")) {
        const value = extractYamlLineValue(line);
        if (!value) continue;
        if (!PATH_LIKE.test(value)) continue;

        // 解析為相對於 cwd 的路徑
        const absRef = isAbsolute(value)
          ? value
          : resolve(this.cwd, value);

        const exists = await this.fileExists(absRef);
        if (!exists) {
          items.push({
            source_file: `.standards/${yamlFile}`,
            reference: value,
            drift_type: "broken_reference",
            reason: `引用路徑不存在：${value}`,
          });
        }
      }
    }

    // ── 2. 掃描 CLAUDE.md / AGENTS.md 中的 stale_standard ────────────
    const docCandidates = [
      "CLAUDE.md",
      "AGENTS.md",
      ".cursor/rules",
      ".devap/CLAUDE.md",
    ];

    for (const docName of docCandidates) {
      const docPath = join(this.cwd, docName);
      let content: string;
      try {
        content = await readFile(docPath, "utf-8");
      } catch {
        continue; // 不存在則跳過
      }
      filesScanned++;

      const matches = content.matchAll(STANDARD_REF_RE);
      for (const m of matches) {
        const stdName = m[1]!;
        const stdPath = join(standardsDir, stdName);
        const exists = await this.fileExists(stdPath);
        if (!exists) {
          // 避免重複記錄同一 reference
          const alreadyRecorded = items.some(
            (i) => i.source_file === docName && i.reference === stdName,
          );
          if (!alreadyRecorded) {
            items.push({
              source_file: docName,
              reference: stdName,
              drift_type: "stale_standard",
              reason: `引用的標準不存在於 .standards/：${stdName}`,
            });
          }
        }
      }
    }

    return {
      analyzer: "drift-detector",
      timestamp,
      files_scanned: filesScanned,
      items,
      skipped: false,
    };
  }

  /**
   * 產出 drift-report.md（若有飄移項目）
   * 寫入 `.evolution/proposals/` 目錄
   */
  async writeReport(result: DriftAnalysisResult, evolutionDir: string): Promise<string | null> {
    if (result.skipped || result.items.length === 0) return null;

    const reportPath = join(evolutionDir, "proposals", "drift-report.md");
    const { writeFile, mkdir } = await import("node:fs/promises");

    await mkdir(join(evolutionDir, "proposals"), { recursive: true });

    const lines: string[] = [
      `# Drift Report`,
      ``,
      `> 生成時間: ${result.timestamp}`,
      `> 掃描檔案: ${result.files_scanned} 個`,
      `> 發現飄移: ${result.items.length} 個`,
      ``,
      `---`,
      ``,
    ];

    const broken = result.items.filter((i) => i.drift_type === "broken_reference");
    const stale = result.items.filter((i) => i.drift_type === "stale_standard");

    if (broken.length > 0) {
      lines.push(`## 失效路徑引用（broken_reference）`, ``);
      lines.push(`| 來源檔案 | 引用路徑 | 說明 |`);
      lines.push(`|----------|----------|------|`);
      for (const item of broken) {
        lines.push(`| \`${item.source_file}\` | \`${item.reference}\` | ${item.reason} |`);
      }
      lines.push(``);
    }

    if (stale.length > 0) {
      lines.push(`## 失效標準引用（stale_standard）`, ``);
      lines.push(`| 來源檔案 | 引用標準 | 說明 |`);
      lines.push(`|----------|----------|------|`);
      for (const item of stale) {
        lines.push(`| \`${item.source_file}\` | \`${item.reference}\` | ${item.reason} |`);
      }
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(`*請手動修正上述飄移引用，或在確認安全後從標準/文件中移除失效引用。*`);

    await writeFile(reportPath, lines.join("\n"), "utf-8");
    return reportPath;
  }

  private async fileExists(absPath: string): Promise<boolean> {
    try {
      await access(absPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
