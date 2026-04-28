/**
 * devap review — 系統性程式碼審查命令（XSPEC-086 Phase 4）
 *
 * 用法：
 *   devap review                     # 審查當前 branch 所有變更
 *   devap review src/auth.ts         # 審查特定檔案
 *   devap review --branch feature/x  # 審查特定 branch
 *   devap review --categories security,tests # 只審查指定類別
 *
 * 步驟（對應 .devap/flows/review.flow.yaml）：
 * 1. identify-changes — git diff 取得要審查的變更
 * 2. apply-checklist  — 8 個類別系統性審查
 * 3. generate-report  — 輸出結構化報告（BLOCKING/IMPORTANT/SUGGESTION/QUESTION/NOTE）
 * 4. summarize        — 整體評估：APPROVE / REQUEST_CHANGES / COMMENT
 */

import { Command } from "commander";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const execAsync = promisify(execCallback);

const REVIEW_CATEGORIES = [
  { id: "functionality", label: "Functionality", description: "功能是否正確？邏輯是否符合需求？" },
  { id: "design", label: "Design", description: "架構是否合適？介面設計是否清晰？" },
  { id: "quality", label: "Quality", description: "程式碼是否乾淨可維護？DRY/SOLID？" },
  { id: "readability", label: "Readability", description: "命名是否清楚？是否容易理解？" },
  { id: "tests", label: "Tests", description: "測試覆蓋是否足夠？是否有回歸測試？" },
  { id: "security", label: "Security", description: "是否有注入漏洞？是否有硬編碼密鑰？" },
  { id: "performance", label: "Performance", description: "是否有 N+1 查詢？是否有效率瓶頸？" },
  { id: "error-handling", label: "Error Handling", description: "錯誤是否妥善處理？未處理的邊界情況？" },
] as const;

interface Finding {
  category: string;
  prefix: "BLOCKING" | "IMPORTANT" | "SUGGESTION" | "QUESTION" | "NOTE";
  text: string;
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close();
      res(answer);
    });
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  const ans = (await promptLine(`${question} [y/n] `)).trim().toLowerCase();
  return ans === "y";
}

function getPrefixIcon(prefix: Finding["prefix"]): string {
  const icons: Record<Finding["prefix"], string> = {
    BLOCKING: "❗",
    IMPORTANT: "⚠️ ",
    SUGGESTION: "💡",
    QUESTION: "❓",
    NOTE: "📝",
  };
  return icons[prefix];
}

async function getDiff(target: string | undefined, branch: string | undefined, cwd: string): Promise<string> {
  try {
    let cmd: string;
    if (target) {
      cmd = `git diff HEAD -- "${target}"`;
    } else if (branch) {
      cmd = `git diff ${branch}...HEAD --stat`;
    } else {
      cmd = "git diff HEAD --stat";
    }
    const { stdout } = await execAsync(cmd, { cwd });
    return stdout.trim() || "（無差異）";
  } catch {
    return "（無法取得 diff）";
  }
}

export function createReviewCommand(): Command {
  return new Command("review")
    .description(
      "系統性程式碼審查：identify → 8-category checklist → report → summarize（XSPEC-086 Phase 4）"
    )
    .argument("[target]", "審查目標（檔案路徑）")
    .option("--branch <branch>", "審查特定 branch 的差異")
    .option(
      "--categories <list>",
      "只審查指定類別（逗號分隔：functionality,design,quality,readability,tests,security,performance,error-handling）"
    )
    .action(
      async (
        target: string | undefined,
        opts: { branch?: string; categories?: string }
      ) => {
        try {
          const cwd = process.cwd();

          console.log("\n🔍 devap review — 系統性程式碼審查");
          console.log("═".repeat(60));

          // ── 1. identify-changes ──────────────────────────────────
          console.log("\n📋 Step 1：識別變更範圍");
          const diff = await getDiff(target, opts.branch, cwd);
          const diffPreview = diff.split("\n").slice(0, 15).join("\n");
          console.log(diffPreview || "  （無差異）");

          // ── 2. apply-checklist ───────────────────────────────────
          const activeCategories = opts.categories
            ? opts.categories.split(",").map((s) => s.trim())
            : REVIEW_CATEGORIES.map((c) => c.id);

          const categoriesToReview = REVIEW_CATEGORIES.filter((c) =>
            activeCategories.includes(c.id)
          );

          console.log(`\n📋 Step 2：8 類審查（審查 ${categoriesToReview.length} 項）`);
          console.log("─".repeat(60));
          console.log("請針對每個類別輸入發現的問題：");
          console.log("  格式：[BLOCKING|IMPORTANT|SUGGESTION|QUESTION|NOTE] 描述");
          console.log("  範例：BLOCKING 第 42 行 SQL 查詢未參數化，存在注入風險");
          console.log("  按 Enter 跳過（無發現）");

          const findings: Finding[] = [];

          for (const category of categoriesToReview) {
            console.log(`\n🏷️  ${category.label}：${category.description}`);
            const input = (await promptLine("  > ")).trim();
            if (!input) continue;

            const match = input.match(/^(BLOCKING|IMPORTANT|SUGGESTION|QUESTION|NOTE)\s+(.+)$/i);
            if (match) {
              findings.push({
                category: category.label,
                prefix: match[1]!.toUpperCase() as Finding["prefix"],
                text: match[2]!,
              });
            } else {
              findings.push({ category: category.label, prefix: "NOTE", text: input });
            }
          }

          // ── 3. generate-report ───────────────────────────────────
          console.log("\n─".repeat(60));
          console.log("📊 Step 3：審查報告");
          console.log("─".repeat(60));

          if (findings.length === 0) {
            console.log("  無發現項目。");
          } else {
            const blockings = findings.filter((f) => f.prefix === "BLOCKING");
            const importants = findings.filter((f) => f.prefix === "IMPORTANT");
            const suggestions = findings.filter((f) => f.prefix === "SUGGESTION");
            const questions = findings.filter((f) => f.prefix === "QUESTION");
            const notes = findings.filter((f) => f.prefix === "NOTE");

            for (const group of [blockings, importants, suggestions, questions, notes]) {
              for (const finding of group) {
                const icon = getPrefixIcon(finding.prefix);
                console.log(`  ${icon} [${finding.prefix}] ${finding.category}`);
                console.log(`       ${finding.text}`);
              }
            }
          }

          // ── 4. summarize ─────────────────────────────────────────
          const blockingCount = findings.filter((f) => f.prefix === "BLOCKING").length;
          const importantCount = findings.filter((f) => f.prefix === "IMPORTANT").length;

          console.log("\n─".repeat(60));
          console.log("📋 Step 4：整體評估");

          let outcome: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
          if (blockingCount > 0) {
            outcome = "REQUEST_CHANGES";
            console.log(`\n❌ REQUEST_CHANGES（${blockingCount} 個 BLOCKING 項目）`);
            console.log("   必須修復所有 BLOCKING 項目後重新提交審查。");
          } else if (importantCount > 0) {
            outcome = "COMMENT";
            console.log(`\n💬 COMMENT（${importantCount} 個 IMPORTANT 項目）`);
            console.log("   建議修復 IMPORTANT 項目，由作者決定是否在合併前處理。");
          } else {
            outcome = "APPROVE";
            console.log("\n✅ APPROVE");
            console.log("   無 BLOCKING 項目，程式碼可合併。");
          }

          // 摘要
          console.log(`\n發現統計：`);
          console.log(`  BLOCKING:   ${blockingCount}`);
          console.log(`  IMPORTANT:  ${importantCount}`);
          console.log(`  SUGGESTION: ${findings.filter((f) => f.prefix === "SUGGESTION").length}`);
          console.log(`  QUESTION:   ${findings.filter((f) => f.prefix === "QUESTION").length}`);
          console.log(`  NOTE:       ${findings.filter((f) => f.prefix === "NOTE").length}`);

          console.log("\n📋 建議下一步：");
          if (outcome === "REQUEST_CHANGES") {
            console.log("  修復 BLOCKING 項目 → devap review 重新審查");
          } else {
            console.log("  devap checkin   — 品質關卡驗證");
            console.log("  devap commit    — 提交程式碼");
          }
        } catch (e) {
          console.error("❌ devap review 執行失敗：", (e as Error).message);
          process.exit(1);
        }
      }
    );
}
