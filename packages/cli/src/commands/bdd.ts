/**
 * devap bdd — BDD 循環引導命令（XSPEC-086 Phase 4）
 *
 * 用法：
 *   devap bdd                        # 互動式 BDD 引導
 *   devap bdd "user can login"       # 針對特定功能
 *   devap bdd --bdd-cmd "npx cucumber-js" # 指定 BDD 測試命令
 *
 * 步驟（對應 .devap/flows/bdd.flow.yaml）：
 * 1. discovery    — 探索行為、Three Amigos 視角確認範圍
 * 2. formulation  — 撰寫 Gherkin 場景（Feature + Scenario + Given/When/Then）
 * 3. automation   — 實作步驟定義 + 場景 RED→GREEN
 * 4. living-docs  — 確認場景仍準確，必要時更新
 */

import { Command } from "commander";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const execAsync = promisify(execCallback);

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

async function runBddTests(cmd: string, cwd: string): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd });
    return { success: true, output: stdout + (stderr ? `\n${stderr}` : "") };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { success: false, output: e.stderr || e.stdout || e.message || String(err) };
  }
}

export function createBddCommand(): Command {
  return new Command("bdd")
    .description(
      "BDD 循環引導：Discovery → Formulation → Automation → Living Docs（XSPEC-086 Phase 4）"
    )
    .argument("[feature]", "功能描述或用戶故事")
    .option("--bdd-cmd <cmd>", "BDD 測試命令（預設：npx cucumber-js）", "npx cucumber-js")
    .action(async (feature: string | undefined, opts: { bddCmd: string }) => {
      try {
        const cwd = process.cwd();

        console.log("\n🥒 devap bdd — Behavior-Driven Development 引導");
        console.log("═".repeat(60));

        // ── Step 1: DISCOVERY ─────────────────────────────────────
        const target =
          feature ??
          (await promptLine("\n📋 Step 1 DISCOVERY：輸入功能描述或用戶故事：\n  > ")).trim();
        if (!target) {
          console.error("❌ 功能描述不可為空");
          process.exit(1);
        }

        console.log(`\n目標：${target}`);
        console.log("BDD 循環：DISCOVERY → FORMULATION → AUTOMATION → LIVING DOCS");

        console.log("\n─".repeat(60));
        console.log("🔍 DISCOVERY：探索行為");
        console.log("──────────────────────");
        console.log("Three Amigos 三視角確認範圍：");
        console.log("  🎯 Business（What/Why）：這個功能解決什麼業務問題？");
        console.log("  ⚙️  Development（How）：技術上如何實現？有什麼限制？");
        console.log("  🧪 Testing（What-if）：邊界情況、異常流程、例外情況？");

        const discoveryDone = await promptYesNo(
          "\n✅ Discovery 完成（行為例子、邊界情況已識別），進入 FORMULATION？"
        );
        if (!discoveryDone) {
          console.log("繼續 Discovery 討論，完成後再執行 devap bdd。");
          return;
        }

        // ── Step 2: FORMULATION ────────────────────────────────────
        console.log("\n─".repeat(60));
        console.log("📝 FORMULATION：撰寫 Gherkin 場景");
        console.log("───────────────────────────────");
        console.log("Feature 文件結構：");
        console.log("  Feature: [功能名稱]");
        console.log("    As a [角色]");
        console.log("    I want [目標]");
        console.log("    So that [業務價值]");
        console.log("");
        console.log("    Scenario: [場景名稱]");
        console.log("      Given [初始情境]");
        console.log("      When  [執行動作]");
        console.log("      Then  [預期結果]");
        console.log("");
        console.log("撰寫原則：");
        console.log("  ✅ 宣告式（What），不是命令式（How）");
        console.log("  ✅ 業務語言，避免技術術語");
        console.log("  ✅ 每個場景獨立，不依賴其他場景狀態");
        console.log("  ✅ 每個 AC → 至少一個 Scenario");

        const formulationDone = await promptYesNo(
          "\n✅ Gherkin 場景已撰寫（含邊界情況和 Scenario Outline），進入 AUTOMATION？"
        );
        if (!formulationDone) {
          const back = await promptYesNo("返回 DISCOVERY 重新探索？");
          if (!back) return;
          console.log("請重新執行 devap bdd 開始 Discovery。");
          return;
        }

        // ── Step 3: AUTOMATION ─────────────────────────────────────
        console.log("\n─".repeat(60));
        console.log("⚙️  AUTOMATION：實作步驟定義");
        console.log("──────────────────────────");
        console.log("實作步驟：");
        console.log("  1. 建立步驟定義檔（step definitions）");
        console.log("  2. 每個 Given/When/Then → 對應的程式碼");
        console.log("  3. 執行場景（預期失敗 RED）");
        console.log("  4. 實作功能程式碼（可在內部用 TDD：devap tdd）");
        console.log("  5. 執行場景（預期全部通過 GREEN）");

        const stepsReady = await promptYesNo("\n✏️  步驟定義已實作，執行 BDD 場景確認 RED？");
        if (!stepsReady) {
          console.log("完成步驟定義後再繼續。");
          return;
        }

        // RED 確認
        console.log(`\n▶ 執行（RED）：${opts.bddCmd}`);
        const redResult = await runBddTests(opts.bddCmd, cwd);
        if (redResult.success) {
          console.log("⚠️  場景已通過！BDD 要求先確認場景失敗（RED）。");
        } else {
          const shortOutput = redResult.output.slice(0, 400);
          console.log(`\n場景輸出：\n${shortOutput}`);
          const redOk = await promptYesNo("✅ 場景如預期失敗，進入實作功能程式碼？");
          if (!redOk) {
            console.log("返回修改步驟定義或場景。");
            return;
          }
        }

        // GREEN
        const codeReady = await promptYesNo("\n✏️  功能程式碼已實作，執行 BDD 場景確認 GREEN？");
        if (!codeReady) {
          console.log("完成功能實作後再繼續。");
          return;
        }

        let greenPassed = false;
        while (!greenPassed) {
          console.log(`\n▶ 執行（GREEN）：${opts.bddCmd}`);
          const greenResult = await runBddTests(opts.bddCmd, cwd);
          if (greenResult.success) {
            console.log("✅ 所有 BDD 場景通過！");
            greenPassed = true;
          } else {
            const shortOutput = greenResult.output.slice(0, 400);
            console.log(`\n❌ 仍有場景失敗：\n${shortOutput}`);
            const retry = await promptYesNo("繼續修改程式碼後再次執行？");
            if (!retry) return;
          }
        }

        // ── Step 4: LIVING DOCS ────────────────────────────────────
        console.log("\n─".repeat(60));
        console.log("📚 LIVING DOCS：維護活文件");
        console.log("──────────────────────────");
        console.log("確認事項：");
        console.log("  ✅ 場景準確反映業務規則（與業務確認）");
        console.log("  ✅ 場景名稱有意義，可作為文件閱讀");
        console.log("  ✅ 過時或不準確的場景已更新");

        await promptLine("\n按 Enter 完成 BDD 循環...");

        // 完成
        console.log("\n" + "═".repeat(60));
        console.log(`✅ BDD 循環完成：${target}`);
        console.log("\n📋 建議下一步：");
        console.log("  devap checkin   — 品質關卡驗證");
        console.log("  devap commit    — 提交完成的程式碼");
        console.log("  /tdd            — 補充單元測試（步驟定義內部）");
      } catch (e) {
        console.error("❌ devap bdd 執行失敗：", (e as Error).message);
        process.exit(1);
      }
    });
}
