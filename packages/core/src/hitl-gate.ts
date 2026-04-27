/**
 * HITL Gate — Human-in-the-Loop 閘門正式化（XSPEC-091）
 *
 * 功能：
 * - AC-1: 顯示步驟描述 + 預期影響，等待人類確認
 * - AC-2: 人類輸入 y → PASSED，記錄確認者 + 時間戳至稽核記錄
 * - AC-3: 人類輸入 n → REJECTED，workflow 呼叫端應 exit 1
 * - AC-4: 逾時（預設 300s）→ 自動視為 REJECTED，不自動通過
 * - AC-5: 非 TTY 環境（CI/CD）→ 立即失敗，輸出明確錯誤
 * - AC-6: shouldRequireHITL() 根據 always_require 白名單判斷是否強制插入
 */

import { createInterface } from "node:readline";

export type HITLDecision = "confirmed" | "rejected" | "timeout" | "non-tty";

export interface HITLGateOptions {
  stepId: string;
  stepDescription: string;
  expectedImpact?: string;
  /** 等待逾時秒數，預設 300 */
  timeoutSeconds?: number;
}

export interface HITLAuditRecord {
  stepId: string;
  decision: HITLDecision;
  timestamp: string;
  confirmer: string;
  timeoutSeconds: number;
}

export interface HITLGateResult {
  passed: boolean;
  decision: HITLDecision;
  audit: HITLAuditRecord;
}

export interface HITLConfig {
  timeout_seconds?: number;
  always_require?: string[];
}

/**
 * 判斷操作類型是否在 always_require 白名單中，若在白名單則必定觸發 HITL（AC-6）。
 */
export function shouldRequireHITL(
  operationType: string,
  config: HITLConfig
): boolean {
  return config.always_require?.includes(operationType) ?? false;
}

async function promptWithTimeout(
  question: string,
  timeoutMs: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const timer = setTimeout(() => {
      rl.close();
      resolve(null);
    }, timeoutMs);

    rl.question(question, (answer) => {
      clearTimeout(timer);
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * 執行 HITL 閘門：等待人類確認後回傳結果與稽核記錄。
 *
 * 呼叫端負責根據 result.passed 決定是否繼續 workflow（passed=false 時應 exit 1）。
 */
export async function runHITLGate(
  opts: HITLGateOptions
): Promise<HITLGateResult> {
  const {
    stepId,
    stepDescription,
    expectedImpact,
    timeoutSeconds = 300,
  } = opts;

  const confirmer =
    process.env.USER ?? process.env.USERNAME ?? "system-user";
  const requestedAt = new Date().toISOString();

  // AC-5: 非 TTY 環境 → 立即失敗
  if (!process.stdin.isTTY) {
    const audit: HITLAuditRecord = {
      stepId,
      decision: "non-tty",
      timestamp: requestedAt,
      confirmer,
      timeoutSeconds,
    };
    console.error(
      `❌ HITL gate 在非互動模式下不支援（step: ${stepId}）`
    );
    console.error(
      "   請在互動式終端中執行，或重新設計 flow 移除 HITL gate"
    );
    return { passed: false, decision: "non-tty", audit };
  }

  // AC-1: 顯示確認提示
  console.log("\n🔒 HITL 確認閘門");
  console.log("─".repeat(60));
  console.log(`步驟：${stepDescription}`);
  if (expectedImpact) {
    console.log(`影響：${expectedImpact}`);
  }
  console.log(`逾時：${timeoutSeconds}s（逾時自動拒絕）`);
  console.log("─".repeat(60));

  const answer = await promptWithTimeout(
    "確認執行此操作？ [y/N] ",
    timeoutSeconds * 1000
  );

  // AC-4: 逾時 → 自動拒絕
  if (answer === null) {
    const audit: HITLAuditRecord = {
      stepId,
      decision: "timeout",
      timestamp: new Date().toISOString(),
      confirmer,
      timeoutSeconds,
    };
    console.log(`\n⏱️  HITL 逾時（${timeoutSeconds}s），自動拒絕`);
    return { passed: false, decision: "timeout", audit };
  }

  const confirmed = answer.trim().toLowerCase() === "y";

  if (confirmed) {
    // AC-2: 確認 → 稽核記錄
    const audit: HITLAuditRecord = {
      stepId,
      decision: "confirmed",
      timestamp: new Date().toISOString(),
      confirmer,
      timeoutSeconds,
    };
    console.log(`✅ 已確認（${confirmer}，${audit.timestamp}）`);
    return { passed: true, decision: "confirmed", audit };
  }

  // AC-3: 拒絕
  const audit: HITLAuditRecord = {
    stepId,
    decision: "rejected",
    timestamp: new Date().toISOString(),
    confirmer,
    timeoutSeconds,
  };
  console.log("❌ 操作已拒絕");
  return { passed: false, decision: "rejected", audit };
}
