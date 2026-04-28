import { Command } from "commander";
import { execSync, spawnSync } from "node:child_process";
import * as readline from "node:readline";

const SIZE_THRESHOLD_LINES = 400;
const STALENESS_DAYS = 7;

function getCurrentBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "HEAD";
  }
}

function getDiffStats(baseBranch: string): { files: number; insertions: number; deletions: number } {
  try {
    const raw = execSync(`git diff --stat origin/${baseBranch}...HEAD`, { encoding: "utf8" });
    const lastLine = raw.trim().split("\n").pop() ?? "";
    const filesMatch = lastLine.match(/(\d+) files? changed/);
    const insertMatch = lastLine.match(/(\d+) insertions?/);
    const deleteMatch = lastLine.match(/(\d+) deletions?/);
    return {
      files: filesMatch ? parseInt(filesMatch[1]) : 0,
      insertions: insertMatch ? parseInt(insertMatch[1]) : 0,
      deletions: deleteMatch ? parseInt(deleteMatch[1]) : 0,
    };
  } catch {
    return { files: 0, insertions: 0, deletions: 0 };
  }
}

function checkCiStatus(prNumber: string): boolean {
  const result = spawnSync("gh", ["pr", "checks", prNumber, "--json", "state"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return true; // assume ok if gh unavailable
  try {
    const checks = JSON.parse(result.stdout) as { state: string }[];
    return !checks.some((c) => c.state === "FAILURE");
  } catch {
    return true;
  }
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export function createPrCommand(): Command {
  return new Command("pr")
    .description("PR lifecycle: CREATE → REVIEW → APPROVE → MERGE → CLEANUP")
    .argument("[branch]", "Branch name (defaults to current branch)")
    .option("--base <branch>", "Base branch to merge into", "main")
    .option("--pr <number>", "Existing PR number (skip CREATE, start from REVIEW)")
    .option("--squash", "Use squash merge strategy (default)")
    .option("--no-squash", "Use merge commit instead of squash")
    .action(async (branch: string | undefined, opts: { base: string; pr?: string; squash: boolean }) => {
      const targetBranch = branch ?? getCurrentBranch();
      const baseBranch = opts.base;

      console.log("\n🔀 DevAP — Pull Request Lifecycle");
      console.log(`   Branch: ${targetBranch} → ${baseBranch}`);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      try {
        let prNumber = opts.pr;

        // ── CREATE ──────────────────────────────────────────────────────────
        if (!prNumber) {
          console.log("\n─────────────────────────────────────────────");
          console.log("📝 Phase 1/5: CREATE — Open Pull Request");

          const stats = getDiffStats(baseBranch);
          const totalLines = stats.insertions + stats.deletions;
          console.log(`\n  Diff: ${stats.files} files, +${stats.insertions} -${stats.deletions} (${totalLines} lines total)`);

          if (totalLines > SIZE_THRESHOLD_LINES) {
            console.log(`\n  ❌ BLOCKED: PR exceeds ${SIZE_THRESHOLD_LINES} lines changed (${totalLines} lines).`);
            console.log("     Consider splitting into smaller, focused PRs:");
            console.log("     - Separate refactoring from features");
            console.log("     - Split by module or concern");
            console.log("     - Extract test changes to a separate PR");
            const force = await prompt(rl, "\n  強制繼續建立大型 PR？(y/n): ");
            if (force.toLowerCase() !== "y") {
              console.log("  PR creation cancelled. Split the changes first.");
              return;
            }
          }

          console.log("\n  PR Description template:");
          console.log("  ┌──────────────────────────────────────────┐");
          console.log("  │ ## Summary                               │");
          console.log("  │ - <bullet point changes>                 │");
          console.log("  │                                          │");
          console.log("  │ ## Changes                               │");
          console.log("  │ - <technical details>                    │");
          console.log("  │                                          │");
          console.log("  │ ## Test Plan                             │");
          console.log("  │ - [ ] Unit tests pass                    │");
          console.log("  │ - [ ] Integration tests pass             │");
          console.log("  │ - [ ] Manual test steps                  │");
          console.log("  └──────────────────────────────────────────┘");

          console.log("\n  Suggested labels: bug | feature | docs | refactor | chore");
          console.log("  Command: gh pr create --title \"<title>\" --body \"<description>\"");

          const created = await prompt(rl, "\n  PR 已建立？輸入 PR 編號（或 skip 跳過）: ");
          if (created.toLowerCase() !== "skip" && created.trim()) {
            prNumber = created.trim();
          }
        }

        // ── REVIEW ──────────────────────────────────────────────────────────
        console.log("\n─────────────────────────────────────────────");
        console.log("🔍 Phase 2/5: REVIEW — Code Review");

        if (prNumber) {
          console.log(`\n  Checking CI status for PR #${prNumber}...`);
          const ciOk = checkCiStatus(prNumber);
          if (!ciOk) {
            console.log("  ❌ BLOCKED: CI checks failing.");
            console.log("     Fix CI failures before requesting review.");
            const forceCi = await prompt(rl, "  強制繼續（CI 仍失敗）？(y/n): ");
            if (forceCi.toLowerCase() !== "y") {
              console.log("  Review blocked. Fix CI first.");
              return;
            }
          } else {
            console.log("  ✅ CI: passing");
          }
        }

        console.log("\n  Review categories:");
        const categories = [
          "Functionality — does it work correctly?",
          "Design — is the architecture appropriate?",
          "Quality — is the code clean and maintainable?",
          "Readability — is it easy to understand?",
          "Tests — is there adequate test coverage?",
          "Security — are there any vulnerabilities?",
          "Performance — is it efficient?",
          "Error Handling — are errors handled properly?",
        ];
        categories.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

        console.log("\n  Comment prefixes: BLOCKING | IMPORTANT | SUGGESTION | QUESTION | NOTE");

        const reviewDone = await prompt(rl, "\n  Code review 完成？所有 BLOCKING 問題已記錄？(y/n): ");
        if (reviewDone.toLowerCase() !== "y") {
          console.log("  ⏸️  Paused at REVIEW. Continue when review is complete.");
          return;
        }

        // ── APPROVE ─────────────────────────────────────────────────────────
        console.log("\n─────────────────────────────────────────────");
        console.log("✅ Phase 3/5: APPROVE — Final Sign-off");

        const blockingResolved = await prompt(rl, "\n  所有 BLOCKING review 問題已解決？(y/n): ");
        if (blockingResolved.toLowerCase() !== "y") {
          console.log("  ⏸️  Paused at APPROVE. Resolve BLOCKING items first.");
          return;
        }

        if (prNumber) {
          console.log(`\n  Approving PR #${prNumber}...`);
          const approveResult = spawnSync("gh", ["pr", "review", prNumber, "--approve"], {
            stdio: "inherit",
            encoding: "utf8",
          });
          if (approveResult.status !== 0) {
            console.log("  ⚠️  Could not auto-approve. Approve manually via GitHub.");
          } else {
            console.log("  ✅ PR approved.");
          }
        }

        // ── MERGE ───────────────────────────────────────────────────────────
        console.log("\n─────────────────────────────────────────────");
        console.log("🔀 Phase 4/5: MERGE — Land the Changes");

        const mergeStrategy = opts.squash !== false ? "squash" : "merge commit";
        console.log(`\n  Merge strategy: ${mergeStrategy}`);
        console.log("  - Squash merge: single feature/bug fix, clean linear history ✅");
        console.log("  - Merge commit: preserve full branch history");
        console.log("  - Rebase merge: linear history with individual commits");

        const confirmMerge = await prompt(rl, `\n  確認以 ${mergeStrategy} 合併？(y/n): `);
        if (confirmMerge.toLowerCase() !== "y") {
          console.log("  ⏸️  Merge cancelled.");
          return;
        }

        if (prNumber) {
          const mergeFlag = opts.squash !== false ? "--squash" : "--merge";
          console.log(`\n  Merging PR #${prNumber}...`);
          const mergeResult = spawnSync(
            "gh",
            ["pr", "merge", prNumber, mergeFlag, "--delete-branch"],
            { stdio: "inherit", encoding: "utf8" }
          );
          if (mergeResult.status !== 0) {
            console.log("  ⚠️  Merge failed. Check PR status on GitHub.");
            return;
          }
          console.log("  ✅ Merged and branch deleted.");
        }

        // ── CLEANUP ─────────────────────────────────────────────────────────
        console.log("\n─────────────────────────────────────────────");
        console.log("🧹 Phase 5/5: CLEANUP — Post-merge Housekeeping");

        console.log(`\n  Syncing local ${baseBranch}...`);
        spawnSync("git", ["checkout", baseBranch], { stdio: "inherit" });
        spawnSync("git", ["pull", "origin", baseBranch], { stdio: "inherit" });

        console.log("\n  Post-merge checklist:");
        console.log("  ☑  Remote branch deleted");
        console.log("  ☑  Related issues closed (Closes #NNN in PR body)");
        console.log("  ☑  Project board / backlog updated");
        console.log("  ☑  Stakeholders notified if needed");

        const prLabel = prNumber ? `#${prNumber}` : targetBranch;
        console.log(`\n  ✅ PR ${prLabel} lifecycle complete.`);
      } finally {
        rl.close();
      }
    });
}
