import { Command } from "commander";
import { runHITLGate, shouldRequireHITL, type HITLConfig } from "@devap/core";

export function createHitlCommand(): Command {
  return new Command("hitl")
    .description("Human-in-the-Loop 閘門 — 等待人類確認後繼續（exit 0）或中止（exit 1）")
    .requiredOption("--op <operation>", "操作類型名稱（用於 always_require 白名單比對）")
    .option("--desc <description>", "步驟說明（顯示給操作者）", "Human review required")
    .option("--impact <impact>", "預期影響說明")
    .option("--timeout <seconds>", "等待逾時秒數（預設 300）", parseInt)
    .option(
      "--always-require <ops>",
      "逗號分隔的操作類型白名單（在白名單中才觸發 HITL）"
    )
    .option("--skip-if-not-required", "若操作不在 always_require 白名單中，直接通過（exit 0）")
    .action(async (opts: {
      op: string;
      desc: string;
      impact?: string;
      timeout?: number;
      alwaysRequire?: string;
      skipIfNotRequired?: boolean;
    }) => {
      const config: HITLConfig = {
        timeout_seconds: opts.timeout,
        always_require: opts.alwaysRequire
          ? opts.alwaysRequire.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      };

      // --skip-if-not-required: 若沒有白名單或操作不在白名單，直接通過
      if (opts.skipIfNotRequired && config.always_require) {
        const required = shouldRequireHITL(opts.op, config);
        if (!required) {
          console.log(`✅ HITL skipped — '${opts.op}' is not in always_require list.`);
          process.exit(0);
        }
      }

      const result = await runHITLGate({
        stepId: opts.op,
        stepDescription: opts.desc,
        expectedImpact: opts.impact,
        timeoutSeconds: opts.timeout ?? 300,
      });

      if (result.passed) {
        console.log(`✅ HITL confirmed (step: ${opts.op})`);
        process.exit(0);
      } else {
        const reason = result.decision === "timeout"
          ? "逾時未確認"
          : result.decision === "non-tty"
          ? "非互動式環境"
          : "操作者拒絕";
        console.error(`❌ HITL rejected — ${reason} (step: ${opts.op})`);
        process.exit(1);
      }
    });
}
