import { Command } from "commander";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runAutoSweep } from "@devap/core";
import { runHITLGate } from "@devap/core";

const HITL_FIX_THRESHOLD = 20;

export function createSweepCommand(): Command {
  return new Command("sweep")
    .description("掃描程式碼瑕疵（console.log、debugger、TODO/FIXME、any 型別）")
    .option("--fix", "自動修復可修復的瑕疵（console.log / debugger）")
    .option("--report", "將掃描結果寫入 .devap/sweep-report.json")
    .option("--patterns <ids>", "逗號分隔的 pattern id（console-log、debugger、todo-fixme、ts-any）")
    .option("--exclude <globs>", "逗號分隔的額外排除 pattern")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (opts: {
      fix?: boolean;
      report?: boolean;
      patterns?: string;
      exclude?: string;
      cwd: string;
    }) => {
      const cwd = resolve(opts.cwd);
      const patterns = opts.patterns
        ? opts.patterns.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const exclude = opts.exclude
        ? opts.exclude.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      console.log(`\n🔍 掃描中：${cwd}\n`);

      const result = await runAutoSweep({ cwd, patterns, exclude });

      if (result.findings.length === 0) {
        console.log("✅ 未發現任何瑕疵。");
      } else {
        const byPattern: Record<string, typeof result.findings> = {};
        for (const f of result.findings) {
          (byPattern[f.patternId] ??= []).push(f);
        }
        for (const [pid, findings] of Object.entries(byPattern)) {
          const label = findings[0].patternLabel;
          const fixTag = findings[0].fixable ? " [可自動修復]" : " [需人工處理]";
          console.log(`\n  ${pid}${fixTag}  —  ${label}  (${findings.length} 處)`);
          for (const f of findings.slice(0, 10)) {
            console.log(`    ${f.file}:${f.line}  ${f.content.slice(0, 80)}`);
          }
          if (findings.length > 10) {
            console.log(`    ... 共 ${findings.length} 處（僅顯示前 10 筆）`);
          }
        }
        console.log(`\n  共 ${result.findings.length} 處瑕疵，掃描 ${result.scannedFiles} 個檔案`);
      }

      if (opts.fix && result.findings.some((f) => f.fixable)) {
        const fixableCount = result.findings.filter((f) => f.fixable).length;

        if (fixableCount >= HITL_FIX_THRESHOLD) {
          console.log(`\n⚠️  即將自動修復 ${fixableCount} 處，超過閾值 ${HITL_FIX_THRESHOLD}，需要人工確認。`);
          const hitlResult = await runHITLGate({
            operation: "sweep-fix",
            description: `自動修復 ${fixableCount} 處程式碼瑕疵`,
            impact: `修改 ${result.scannedFiles} 個檔案中的 console.log / debugger 語句`,
          });
          if (hitlResult.decision !== "confirmed") {
            console.log("❌ 人工審核拒絕，跳過自動修復。");
            process.exit(1);
          }
        }

        const fixResult = await runAutoSweep({ cwd, patterns, exclude, fix: true });
        console.log(`\n✅ 已修復 ${fixResult.fixed} 處瑕疵。`);
      } else if (opts.fix) {
        console.log("\nℹ️  無可自動修復的瑕疵。");
      }

      if (opts.report) {
        const devapDir = join(cwd, ".devap");
        await mkdir(devapDir, { recursive: true });
        const reportPath = join(devapDir, "sweep-report.json");
        const report = {
          generatedAt: new Date().toISOString(),
          cwd,
          scannedFiles: result.scannedFiles,
          totalFindings: result.findings.length,
          fixed: result.fixed,
          findings: result.findings,
        };
        await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
        console.log(`\n📄 報告已寫入：${reportPath}`);
      }
    });
}
