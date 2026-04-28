import { Command } from "commander";
import { execSync } from "node:child_process";
import * as readline from "node:readline";

const PHASES = [
  {
    id: "workshop",
    name: "WORKSHOP — Story & Acceptance Criteria",
    description: "PO presents story, Three Amigos discussion, define Given/When/Then AC",
  },
  {
    id: "distillation",
    name: "DISTILLATION — Convert AC to Executable Tests",
    description: "Convert acceptance criteria to Gherkin scenarios, PO sign-off",
  },
  {
    id: "development",
    name: "DEVELOPMENT — Red → Green Cycle",
    description: "Run acceptance tests RED, implement with BDD/TDD, reach GREEN",
  },
  {
    id: "demo",
    name: "DEMO — Stakeholder Showcase",
    description: "Present passing tests to stakeholders, get PO acceptance",
  },
  {
    id: "done",
    name: "DONE — Story Closed",
    description: "AC in CI, living docs updated, story closed in backlog",
  },
];

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function runTests(testCmd: string): Promise<boolean> {
  console.log(`\n  $ ${testCmd}`);
  try {
    execSync(testCmd, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

export function createAtddCommand(): Command {
  return new Command("atdd")
    .description("ATDD lifecycle: WORKSHOP → DISTILLATION → DEVELOPMENT → DEMO → DONE")
    .argument("[feature]", "Feature or story name to drive with ATDD")
    .option("--phase <phase>", "Start from specific phase (workshop|distillation|development|demo|done)")
    .option("--test-cmd <cmd>", "Acceptance test command", "npx cucumber-js")
    .action(async (feature: string | undefined, opts: { phase?: string; testCmd: string }) => {
      const featureName = feature ?? "current feature";

      if (opts.phase) {
        const known = PHASES.map((p) => p.id);
        if (!known.includes(opts.phase)) {
          console.error(`❌ Unknown phase: ${opts.phase}`);
          console.error(`   Valid phases: ${known.join(", ")}`);
          process.exit(1);
        }
      }

      console.log("\n🧪 DevAP — Acceptance Test-Driven Development (ATDD)");
      console.log(`   Feature: ${featureName}`);
      console.log(`   Test command: ${opts.testCmd}`);
      console.log("\n   Lifecycle: WORKSHOP → DISTILLATION → DEVELOPMENT → DEMO → DONE\n");

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const startPhaseId = opts.phase ?? "workshop";
      const startIndex = PHASES.findIndex((p) => p.id === startPhaseId);

      try {
        for (let i = startIndex; i < PHASES.length; i++) {
          const phase = PHASES[i];
          console.log(`\n${"─".repeat(60)}`);
          console.log(`📍 Phase ${i + 1}/${PHASES.length}: ${phase.name}`);
          console.log(`   ${phase.description}`);

          if (phase.id === "workshop") {
            console.log("\n  INVEST Criteria checklist:");
            console.log("  ✦ Independent — can be developed independently?");
            console.log("  ✦ Negotiable — implementation details flexible?");
            console.log("  ✦ Valuable — clear value to end user?");
            console.log("  ✦ Estimable — can be reasonably estimated?");
            console.log("  ✦ Small — fits in one iteration?");
            console.log("  ✦ Testable — has clear pass/fail acceptance criteria?");
            console.log("\n  User Story format:");
            console.log("  As a [role], I want [feature], So that [benefit]");
            console.log("\n  Acceptance Criteria format:");
            console.log("  Given [context], When [action], Then [outcome]");

            const answer = await prompt(rl, "\n  AC 定義完成，繼續 DISTILLATION？(y/n): ");
            if (answer.toLowerCase() !== "y") {
              console.log("  ⏸️  Paused at WORKSHOP. Re-run when AC is ready.");
              break;
            }
          }

          if (phase.id === "distillation") {
            console.log("\n  Convert each AC to Gherkin scenarios:");
            console.log("  Feature: <feature name>");
            console.log("    Scenario: <AC description>");
            console.log("      Given <initial context>");
            console.log("      When  <user action>");
            console.log("      Then  <expected outcome>");
            console.log("\n  Map scenarios to test framework step definitions.");

            const answer = await prompt(rl, "\n  PO sign-off — 測試場景符合業務預期？(y/n): ");
            if (answer.toLowerCase() !== "y") {
              console.log("  ⏸️  Paused at DISTILLATION. Revise scenarios with PO.");
              break;
            }
          }

          if (phase.id === "development") {
            console.log("\n  Step 1: Run acceptance tests — expect RED");
            const red = await runTests(opts.testCmd);
            if (red) {
              console.log("  ⚠️  Tests passed immediately — verify you have the right test command.");
            } else {
              console.log("  🔴 RED confirmed — tests failing as expected.");
            }

            console.log("\n  Step 2: Implement with BDD/TDD inner loop:");
            console.log("  1. Pick ONE failing acceptance test");
            console.log("  2. Write unit tests (TDD RED)");
            console.log("  3. Implement minimal code (TDD GREEN)");
            console.log("  4. Refactor");
            console.log("  5. Check acceptance test — repeat until GREEN");

            const ready = await prompt(rl, "\n  實作完成，執行完整接受測試？(y/n): ");
            if (ready.toLowerCase() === "y") {
              const green = await runTests(opts.testCmd);
              if (!green) {
                console.log("  🔴 Tests still failing. Continue implementation.");
                const continueAnswer = await prompt(rl, "  繼續 DEVELOPMENT 迭代？(y/n): ");
                if (continueAnswer.toLowerCase() !== "y") {
                  console.log("  ⏸️  Paused at DEVELOPMENT.");
                  break;
                }
                i--; // re-run development phase
                continue;
              }
              console.log("  🟢 GREEN — all acceptance tests passing!");
            }

            const demoReady = await prompt(rl, "\n  準備 DEMO 給利害關係人？(y/n): ");
            if (demoReady.toLowerCase() !== "y") {
              console.log("  ⏸️  Paused before DEMO.");
              break;
            }
          }

          if (phase.id === "demo") {
            console.log("\n  Demo script:");
            console.log(`  1. Show user story: ${featureName}`);
            console.log("  2. Walk through passing acceptance tests");
            console.log("  3. Demonstrate edge cases covered");
            console.log("  4. Note any deferred AC or known limitations");

            const accepted = await prompt(rl, "\n  利害關係人 / PO 接受此功能？(y/n): ");
            if (accepted.toLowerCase() !== "y") {
              console.log("  🔄 Stakeholders requested changes — returning to DEVELOPMENT.");
              i = PHASES.findIndex((p) => p.id === "development") - 1;
              continue;
            }
            console.log("  ✅ PO accepted!");
          }

          if (phase.id === "done") {
            console.log("\n  Post-DEMO checklist:");
            console.log("  ☑  Acceptance tests committed to repo (living documentation)");
            console.log("  ☑  CI pipeline includes acceptance test run");
            console.log("  ☑  Story marked DONE in backlog");
            console.log("  ☑  Feature files serve as permanent living docs");
            console.log("\n  ✅ ATDD cycle complete for: " + featureName);
          }
        }
      } finally {
        rl.close();
      }
    });
}
