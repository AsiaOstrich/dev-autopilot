/**
 * devap sdd — Spec-Driven Development 生命週期引導（XSPEC-086 Phase 4）
 *
 * 用法：
 *   devap sdd                   # 互動式 SDD 精靈
 *   devap sdd "auth-flow"       # 為特定功能建立 spec
 *   devap sdd --phase review    # 直接進入指定 phase
 *
 * 步驟（對應 .devap/flows/sdd.flow.yaml）：
 * 0. discuss   — 釐清需求範圍
 * 1. create    — 撰寫規格文件
 * 2. review    — 審查完整性
 * 3. approve   — 核准開始實作
 * 4. implement — 依 spec 實作
 * 5. verify    — 驗證 AC 全部滿足
 * 6. archive   — 歸檔完成 spec
 */

import { Command } from "commander";
import { createInterface } from "node:readline";

type Phase = "discuss" | "create" | "review" | "approve" | "implement" | "verify" | "archive";

const PHASES: Array<{ id: Phase; label: string; description: string }> = [
  { id: "discuss", label: "DISCUSS", description: "釐清需求範圍、解決模糊點、建立設計原則" },
  { id: "create", label: "CREATE", description: "撰寫規格文件（Overview + Requirements + AC + Design + Test Plan）" },
  { id: "review", label: "REVIEW", description: "審查規格的完整性、一致性與可行性" },
  { id: "approve", label: "APPROVE", description: "核准規格，開始實作" },
  { id: "implement", label: "IMPLEMENT", description: "依核准規格實作，每個 AC 逐一完成" },
  { id: "verify", label: "VERIFY", description: "確認實作與 spec 一致，所有 AC 滿足" },
  { id: "archive", label: "ARCHIVE", description: "歸檔規格，加入 commit/PR 連結" },
];

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

function printPhaseHeader(phase: { id: Phase; label: string; description: string }, current: number, total: number): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📋 Phase ${current}/${total}: ${phase.label}`);
  console.log(`   ${phase.description}`);
}

export function createSddCommand(): Command {
  return new Command("sdd")
    .description("SDD 規格驅動開發週期引導：Discuss → Create → Review → Approve → Implement → Verify → Archive（XSPEC-086 Phase 4）")
    .argument("[feature]", "功能名稱或規格主題")
    .option("--phase <phase>", "直接進入指定 phase（discuss|create|review|approve|implement|verify|archive）")
    .action(async (feature: string | undefined, opts: { phase?: string }) => {
      try {
        console.log("\n📐 devap sdd — Spec-Driven Development 引導");
        console.log("═".repeat(60));

        const target =
          feature ??
          (await promptLine("\n📋 輸入功能名稱或規格主題：\n  > ")).trim();
        if (!target) {
          console.error("❌ 功能名稱不可為空");
          process.exit(1);
        }

        console.log(`\n目標：${target}`);
        console.log("SDD 週期：DISCUSS → CREATE → REVIEW → APPROVE → IMPLEMENT → VERIFY → ARCHIVE");

        const startPhaseId = (opts.phase ?? "discuss") as Phase;
        const startIdx = PHASES.findIndex((p) => p.id === startPhaseId);
        if (startIdx === -1) {
          console.error(`❌ 不支援的 phase: ${opts.phase}`);
          console.error("可用值：" + PHASES.map((p) => p.id).join(", "));
          process.exit(1);
        }

        let currentIdx = startIdx;

        while (currentIdx < PHASES.length) {
          const phase = PHASES[currentIdx]!;
          printPhaseHeader(phase, currentIdx + 1, PHASES.length);

          switch (phase.id) {
            case "discuss": {
              console.log("\n討論重點：");
              console.log("  - 功能目標與使用者需求");
              console.log("  - 範圍邊界（in-scope / out-of-scope）");
              console.log("  - 技術限制與設計原則");
              console.log("  - 利害關係人的期待");
              const proceed = await promptYesNo("\n需求已釐清，繼續撰寫規格？");
              if (!proceed) {
                console.log("已停留在 DISCUSS 階段。");
                return;
              }
              break;
            }

            case "create": {
              console.log("\n規格文件結構：");
              console.log("  # [SPEC-ID] Feature: " + target);
              console.log("  ## Overview");
              console.log("  ## Motivation");
              console.log("  ## Requirements（含 Scenario: Given/When/Then）");
              console.log("  ## Acceptance Criteria（Given/When/Then 格式）");
              console.log("  ## Technical Design");
              console.log("  ## Test Plan");
              console.log("\n請撰寫規格文件（可使用 AI 協助產生草稿）。");
              const proceed = await promptYesNo("\n規格草稿已完成，進入審查？");
              if (!proceed) {
                const back = await promptYesNo("返回 DISCUSS 重新釐清需求？");
                if (back) currentIdx = 0;
                else return;
                continue;
              }
              break;
            }

            case "review": {
              console.log("\n審查清單：");
              console.log("  □ 每個 Requirement 都有至少一個 Scenario");
              console.log("  □ Acceptance Criteria 使用 Given/When/Then 格式");
              console.log("  □ Technical Design 足夠明確可實作");
              console.log("  □ Test Plan 涵蓋 happy path 與 edge cases");
              console.log("  □ Out-of-scope 已明確標示");
              const proceed = await promptYesNo("\n審查完成，進入核准？");
              if (!proceed) {
                const back = await promptYesNo("返回 CREATE 修改規格？");
                if (back) currentIdx = 1;
                else return;
                continue;
              }
              break;
            }

            case "approve": {
              console.log("\n核准規格意味著：");
              console.log("  - 規格狀態從 Review → Approved");
              console.log("  - 實作可以開始");
              console.log("  - 後續變更需要更新規格");
              const proceed = await promptYesNo("\n核准此規格並開始實作？");
              if (!proceed) {
                const back = await promptYesNo("返回 REVIEW 重新審查？");
                if (back) currentIdx = 2;
                else return;
                continue;
              }
              console.log("\n✅ 規格已核准（Approved）");
              break;
            }

            case "implement": {
              console.log("\n實作指引：");
              console.log("  - 每個 AC 逐一實作，完成後標記 ✅");
              console.log("  - commit message 引用 spec ID（e.g. implements SPEC-NNN AC-1）");
              console.log("  - 不超出規格範圍實作額外功能");
              const proceed = await promptYesNo("\n所有 AC 已實作，進入驗證？");
              if (!proceed) {
                console.log("繼續實作中，完成後再執行 devap sdd --phase verify。");
                return;
              }
              break;
            }

            case "verify": {
              console.log("\n驗證清單：");
              console.log("  □ 所有測試通過（devap checkin）");
              console.log("  □ 每個 AC 都有對應的測試");
              console.log("  □ 實作行為符合 spec 描述");
              console.log("  □ edge cases 有測試覆蓋");
              console.log("\n建議執行 devap checkin 確認品質關卡。");
              const proceed = await promptYesNo("\n所有 AC 驗證通過，歸檔此規格？");
              if (!proceed) {
                const back = await promptYesNo("返回 IMPLEMENT 補完實作？");
                if (back) currentIdx = 4;
                else return;
                continue;
              }
              break;
            }

            case "archive": {
              console.log("\n歸檔規格：");
              console.log("  - 規格狀態從 Implemented → Archived");
              console.log("  - 加入實作 commit SHA 或 PR URL");
              console.log("  - 移至 specs/archived/ 目錄（可選）");
              const specId = await promptLine("\n輸入規格 ID（例：SPEC-042），或按 Enter 跳過：\n  > ");
              if (specId.trim()) {
                console.log(`\n📁 ${specId.trim()} 已標記為 Archived`);
              }
              console.log("\n✅ SDD 週期完成！");
              break;
            }
          }

          currentIdx++;
        }

        // 完成摘要
        console.log("\n" + "═".repeat(60));
        console.log(`✅ SDD 完成：${target}`);
        console.log("\n📋 建議下一步：");
        console.log("  devap checkin   — 最終品質關卡確認");
        console.log("  devap commit    — 提交完成的實作");
      } catch (e) {
        console.error("❌ devap sdd 執行失敗：", (e as Error).message);
        process.exit(1);
      }
    });
}
