import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { SWEEP_PATTERNS, type SweepPattern } from "./sweep-patterns.js";

export interface SweepFinding {
  file: string;
  line: number;
  patternId: string;
  patternLabel: string;
  content: string;
  fixable: boolean;
}

export interface SweepResult {
  scannedFiles: number;
  findings: SweepFinding[];
  fixed: number;
  skippedPatterns: string[];
}

export interface AutoSweepOptions {
  cwd: string;
  include?: string[];
  exclude?: string[];
  patterns?: string[];
  fix?: boolean;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  "dist",
  ".d.ts",
  "__tests__",
  ".test.",
  ".spec.",
  "coverage",
  ".devap",
];

function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((p) => filePath.includes(p));
}

async function collectFiles(dir: string, extensions: string[], excludePatterns: string[]): Promise<string[]> {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (shouldExclude(fullPath, excludePatterns)) continue;
    let s;
    try {
      s = await stat(fullPath);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      const sub = await collectFiles(fullPath, extensions, excludePatterns);
      results.push(...sub);
    } else if (extensions.includes(extname(entry))) {
      results.push(fullPath);
    }
  }
  return results;
}

function scanLines(
  filePath: string,
  lines: string[],
  patterns: SweepPattern[],
  cwd: string,
): SweepFinding[] {
  const findings: SweepFinding[] = [];
  const relPath = relative(cwd, filePath);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        findings.push({
          file: relPath,
          line: i + 1,
          patternId: pattern.id,
          patternLabel: pattern.label,
          content: line.trim(),
          fixable: pattern.fixable,
        });
      }
    }
  }
  return findings;
}

function applyFixes(lines: string[], patterns: SweepPattern[]): { lines: string[]; fixedCount: number } {
  let fixedCount = 0;
  const newLines = lines.map((line) => {
    for (const pattern of patterns) {
      if (!pattern.fixable || !pattern.fixer) continue;
      if (pattern.regex.test(line)) {
        const result = pattern.fixer(line);
        if (result === null) {
          fixedCount++;
          return null;
        }
        if (result !== line) {
          fixedCount++;
          return result;
        }
      }
    }
    return line;
  });
  return {
    lines: newLines.filter((l): l is string => l !== null),
    fixedCount,
  };
}

export async function runAutoSweep(opts: AutoSweepOptions): Promise<SweepResult> {
  const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...(opts.exclude ?? [])];

  const activePatterns = opts.patterns
    ? SWEEP_PATTERNS.filter((p) => opts.patterns!.includes(p.id))
    : SWEEP_PATTERNS;

  const skippedPatterns = SWEEP_PATTERNS.filter((p) => !activePatterns.includes(p)).map((p) => p.id);

  const files = await collectFiles(opts.cwd, DEFAULT_EXTENSIONS, excludePatterns);

  const allFindings: SweepFinding[] = [];
  let totalFixed = 0;

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const findings = scanLines(file, lines, activePatterns, opts.cwd);
    allFindings.push(...findings);

    if (opts.fix) {
      const fixablePatterns = activePatterns.filter((p) => p.fixable);
      if (fixablePatterns.length > 0 && findings.some((f) => f.fixable)) {
        const { lines: fixed, fixedCount } = applyFixes(lines, fixablePatterns);
        if (fixedCount > 0) {
          await writeFile(file, fixed.join("\n"), "utf8");
          totalFixed += fixedCount;
        }
      }
    }
  }

  return {
    scannedFiles: files.length,
    findings: allFindings,
    fixed: totalFixed,
    skippedPatterns,
  };
}
