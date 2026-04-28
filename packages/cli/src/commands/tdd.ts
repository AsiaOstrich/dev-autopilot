/**
 * devap tdd — TDD 循環引導命令（XSPEC-086 Phase 4）
 *
 * 用法：
 *   devap tdd                   # 互動式：提示輸入功能描述
 *   devap tdd "user can login"  # 針對特定功能或函式
 *   devap tdd --test-cmd "pnpm test"  # 指定測試命令
 *
 * 步驟（對應 .devap/flows/tdd.flow.yaml）：
 * 1. understand-requirement：確認功能描述
 * 2. list-test-cases：規劃測試案例清單
 * 3. RED：撰寫失敗測試 → 執行測試確認失敗
 * 4. GREEN：撰寫最少程式碼 → 執行測試確認通過
 * 5. REFACTOR：改善程式碼 → 執行測試確認仍通過
 * 6. 詢問是否繼續下一個測試案例
 */

import { Command } from "commander";
import { exec as execCallback } from "node:child_process";
import { readFileSync } from "node:fs";
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

function detectTestCommand(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, { encoding: "utf-8" })) as {
      scripts?: Record<string, string>;
    };
    if (pkg.scripts?.["test:unit"]) return "npm run test:unit";
    if (pkg.scripts?.["test"]) return "npm test";
  } catch {
    // ignore
  }
  return "npm test";
}

async function runTests(cmd: string, cwd: string): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd });
    return { success: true, output: stdout + (stderr ? `\n${stderr}` : "") };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { success: false, output: e.stderr || e.stdout || e.message || String(err) };
  }
}

export function createTddCommand(): Command {
  return new Command("tdd")
    .description("TDD 循環引導：RED → GREEN → REFACTOR（XSPEC-086 Phase 4）")
    .argument("[feature]", "功能描述、函式名稱或用戶故事")
    .option("--test-cmd <cmd>", "覆蓋測試命令（預設自動偵測）")
    .action(async (feature: string | undefined, opts: { testCmd?: string }) => {
      try {
        const cwd = process.cwd();
        const testCmd = opts.testCmd ?? detectTestCommand(cwd);

        console.log("\n🧪 devap tdd — Test-Driven Development 引導");
        console.log("═".repeat(60));

        // ── Step 1: understand-requirement ─────────────────────────
        const target =
          feature ??
          (await promptLine("\n📋 Step 1：輸入功能描述、函式名稱或用戶故事：\n  > ")).trim();
        if (!target) {
          console.error("❌ 功能描述不可為空");
          process.exit(1);
        }

        console.log(`\n目標：${target}`);
        console.log(`測試命令：${testCmd}`);

        // ── Step 2: list-test-cases ────────────────────────────────
        console.log("\n📝 Step 2：規劃測試案例");
        console.log("建議考慮：");
        console.log("  ✅ Happy path（正常流程）");
        console.log("  ✅ Edge cases（邊界情況：空值、極端值、無效格式）");
        console.log("  ✅ Error cases（錯誤情況：失敗、例外、拒絕）");

        // TDD 循環
        let continueLoop = true;
        let cycleCount = 0;

        while (continueLoop) {
          cycleCount++;
          console.log(`\n${"─".repeat(60)}`);
          console.log(`🔄 TDD 循環 #${cycleCount}`);

          // ── RED 階段 ─────────────────────────────────────────────
          console.log("\n🔴 RED 階段：撰寫失敗測試");
          console.log("──────────────────────────");
          console.log("測試撰寫準則（AAA 格式）：");
          console.log("  Arrange：準備測試資料與依賴");
          console.log("  Act：    執行目標行為（一個行為）");
          console.log("  Assert： 驗證預期結果（一個斷言群組）");

          const redReady = await promptYesNo("\n✏️  測試已撰寫完成，執行測試確認失敗？");
          if (!redReady) {
            console.log("已取消 TDD 循環。");
            return;
          }

          console.log(`\n▶ 執行：${testCmd}`);
          const redResult = await runTests(testCmd, cwd);

          if (redResult.success) {
            console.log("\n⚠️  測試通過了！TDD 要求新測試先失敗（RED）。");
            console.log("請確認：");
            console.log("  1. 測試是否針對尚未存在的行為？");
            console.log("  2. 被測程式碼是否尚未實作？");
            const forceRed = await promptYesNo("\n確認測試確實應該先失敗，繼續？");
            if (!forceRed) continue;
          } else {
            const shortOutput = redResult.output.slice(0, 500);
            console.log(`\n測試輸出（截斷）：\n${shortOutput}`);
            const redConfirmed = await promptYesNo(
              "\n✅ 測試如預期失敗且失敗原因正確（非語法錯誤），進入 GREEN 階段？"
            );
            if (!redConfirmed) {
              console.log("返回 RED 階段，繼續修改測試。");
              continue;
            }
          }

          // ── GREEN 階段 ────────────────────────────────────────────
          console.log("\n🟢 GREEN 階段：撰寫最少程式碼");
          console.log("──────────────────────────────");
          console.log("撰寫原則：");
          console.log("  - 最少程式碼即可（hardcoding 在此階段可接受）");
          console.log("  - 不新增測試未要求的功能");
          console.log("  - 不做效能優化");

          const greenReady = await promptYesNo("\n✏️  最少程式碼已撰寫，執行測試確認通過？");
          if (!greenReady) {
            console.log("已取消。");
            return;
          }

          let greenPassed = false;
          while (!greenPassed) {
            console.log(`\n▶ 執行：${testCmd}`);
            const greenResult = await runTests(testCmd, cwd);

            if (greenResult.success) {
              console.log("✅ 所有測試通過（綠燈）！");
              greenPassed = true;
            } else {
              const shortOutput = greenResult.output.slice(0, 500);
              console.log(`\n❌ 仍有測試失敗：\n${shortOutput}`);
              const retry = await promptYesNo("\n繼續修改程式碼後再次執行？");
              if (!retry) {
                console.log("已取消。");
                return;
              }
            }
          }

          const proceedRefactor = await promptYesNo("\n🟢 GREEN 完成，進入 REFACTOR 階段？");
          if (!proceedRefactor) {
            continueLoop = await promptYesNo("繼續下一個測試案例？");
            continue;
          }

          // ── REFACTOR 階段 ─────────────────────────────────────────
          console.log("\n🔵 REFACTOR 階段：改善程式碼品質");
          console.log("────────────────────────────────");
          console.log("重構安全規則：");
          console.log("  1. 每次只做一個改動");
          console.log("  2. 每次改動後立即執行測試");
          console.log("  3. 測試失敗 → 立即還原");
          console.log("  4. 不新增功能，只清理現有程式碼");

          const refactorReady = await promptYesNo(
            "\n✏️  重構已完成（或本循環無需重構），執行測試確認？"
          );
          if (refactorReady) {
            console.log(`\n▶ 執行：${testCmd}`);
            const refactorResult = await runTests(testCmd, cwd);

            if (refactorResult.success) {
              console.log("✅ 重構後所有測試仍然通過！");
            } else {
              const shortOutput = refactorResult.output.slice(0, 500);
              console.log(`\n❌ 重構後測試失敗：\n${shortOutput}`);
              console.log("請還原最後一次變更，再重新重構。");
            }
          }

          // ── 下一循環 ──────────────────────────────────────────────
          continueLoop = await promptYesNo("\n🔄 繼續下一個測試案例？");
        }

        // 完成摘要
        console.log("\n" + "═".repeat(60));
        console.log(`✅ TDD 完成（共 ${cycleCount} 個循環）`);
        console.log("\n📋 建議下一步：");
        console.log("  devap commit   — 提交完成的程式碼");
        console.log("  /checkin       — 通過品質關卡");
        console.log("  /coverage      — 確認測試覆蓋率");
      } catch (e) {
        console.error("❌ devap tdd 執行失敗：", (e as Error).message);
        process.exit(1);
      }
    });
}
