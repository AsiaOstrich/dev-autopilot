/**
 * Token 預算管理（XSPEC-092）
 *
 * AC-1: 記錄每個 Agent 步驟的 input/output token 消耗
 * AC-2: 累計超過 perWorkflow 閾值時觸發 HITL 閘門
 * AC-3: 達到 80%（warnThreshold）時顯示警告，不中斷執行
 * AC-4: CI 非互動模式超過預算 → 自動失敗並輸出摘要
 * AC-5: formatCostReport() 提供費用報告字串（供 devap status --cost 使用）
 */

import { runHITLGate } from "./hitl-gate.js";

export interface TokenRecord {
  stepId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface TokenBudgetConfig {
  /** 單一 workflow 的 token 上限（input + output 合計） */
  perWorkflow?: number;
  /** 觸發警告的比例，預設 0.8（80%） */
  warnThreshold?: number;
  /** 各模型定價（USD / 1M tokens），可覆蓋預設值 */
  pricing?: Record<string, ModelPricing>;
}

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7":   { inputPerMillion: 15.0,  outputPerMillion: 75.0  },
  "claude-sonnet-4-6": { inputPerMillion: 3.0,   outputPerMillion: 15.0  },
  "claude-haiku-4-5":  { inputPerMillion: 0.25,  outputPerMillion: 1.25  },
  "gpt-4o":            { inputPerMillion: 2.5,   outputPerMillion: 10.0  },
  "gpt-4o-mini":       { inputPerMillion: 0.15,  outputPerMillion: 0.6   },
  "default":           { inputPerMillion: 3.0,   outputPerMillion: 15.0  },
};

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class TokenBudgetTracker {
  private records: TokenRecord[] = [];

  /** AC-1: 記錄一個步驟的 token 消耗 */
  addUsage(record: TokenRecord): void {
    this.records.push({ ...record });
  }

  getTotal(): TokenTotals {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const r of this.records) {
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
    }
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  }

  getByModel(): Record<string, { inputTokens: number; outputTokens: number }> {
    const result: Record<string, { inputTokens: number; outputTokens: number }> = {};
    for (const r of this.records) {
      if (!result[r.model]) result[r.model] = { inputTokens: 0, outputTokens: 0 };
      result[r.model].inputTokens += r.inputTokens;
      result[r.model].outputTokens += r.outputTokens;
    }
    return result;
  }

  getThresholdStatus(config: TokenBudgetConfig): "ok" | "warn" | "exceeded" {
    if (!config.perWorkflow) return "ok";
    const { totalTokens } = this.getTotal();
    const warnAt = config.perWorkflow * (config.warnThreshold ?? 0.8);
    if (totalTokens >= config.perWorkflow) return "exceeded";
    if (totalTokens >= warnAt) return "warn";
    return "ok";
  }

  estimateCostUsd(config: TokenBudgetConfig): number {
    const pricing = { ...DEFAULT_PRICING, ...config.pricing };
    let total = 0;
    for (const r of this.records) {
      const p = pricing[r.model] ?? pricing["default"];
      total += (r.inputTokens / 1_000_000) * p.inputPerMillion;
      total += (r.outputTokens / 1_000_000) * p.outputPerMillion;
    }
    return Math.round(total * 10_000) / 10_000;
  }

  /** AC-5: 人類可讀費用報告 */
  formatCostReport(config: TokenBudgetConfig): string {
    const { inputTokens, outputTokens, totalTokens } = this.getTotal();
    const costUsd = this.estimateCostUsd(config);
    const byModel = this.getByModel();
    const sep = "─".repeat(60);

    const lines: string[] = [
      sep,
      "Token 消耗報告",
      sep,
      `總計：${totalTokens.toLocaleString()} tokens（input: ${inputTokens.toLocaleString()}, output: ${outputTokens.toLocaleString()}）`,
      `估算費用：$${costUsd.toFixed(4)} USD`,
    ];

    const models = Object.keys(byModel);
    if (models.length > 1) {
      lines.push("各模型分布：");
      for (const model of models) {
        const u = byModel[model];
        const t = u.inputTokens + u.outputTokens;
        lines.push(`  ${model}: ${t.toLocaleString()} tokens`);
      }
    }

    if (config.perWorkflow) {
      const pct = Math.round((totalTokens / config.perWorkflow) * 100);
      lines.push(
        `預算使用率：${pct}%（${totalTokens.toLocaleString()} / ${config.perWorkflow.toLocaleString()}）`
      );
    }

    lines.push(sep);
    return lines.join("\n");
  }

  reset(): void {
    this.records = [];
  }

  getRecords(): readonly TokenRecord[] {
    return this.records;
  }
}

export type TokenBudgetCheckStatus =
  | "ok"
  | "warn"
  | "exceeded-confirmed"
  | "exceeded-blocked";

export interface TokenBudgetCheckResult {
  status: TokenBudgetCheckStatus;
  totalTokens: number;
  estimatedCostUsd: number;
  message?: string;
}

/**
 * AC-2/AC-3/AC-4: 根據目前累計消耗判斷是否觸發 HITL 或警告。
 *
 * 呼叫端在每個 Agent 步驟完成後呼叫。
 * status === "exceeded-blocked" 時，呼叫端應終止 workflow 並 exit 1。
 */
export async function checkTokenBudget(
  tracker: TokenBudgetTracker,
  config: TokenBudgetConfig,
  stepId: string
): Promise<TokenBudgetCheckResult> {
  const { totalTokens } = tracker.getTotal();
  const estimatedCostUsd = tracker.estimateCostUsd(config);
  const thresholdStatus = tracker.getThresholdStatus(config);

  if (thresholdStatus === "warn") {
    const budget = config.perWorkflow ?? 0;
    const warnPct = Math.round((config.warnThreshold ?? 0.8) * 100);
    console.log(
      `[WARN] Token 消耗已達預算 ${warnPct}%（${totalTokens.toLocaleString()} / ${budget.toLocaleString()}）`
    );
    return { status: "warn", totalTokens, estimatedCostUsd };
  }

  if (thresholdStatus === "exceeded") {
    const budget = config.perWorkflow ?? 0;
    const hitlResult = await runHITLGate({
      stepId: `token-budget:${stepId}`,
      stepDescription: "Token 預算超限，是否繼續執行？",
      expectedImpact: `已消耗 ${totalTokens.toLocaleString()} tokens（估算 $${estimatedCostUsd.toFixed(4)} USD），超過預算 ${budget.toLocaleString()}。繼續將增加成本。`,
    });

    if (hitlResult.passed) {
      return { status: "exceeded-confirmed", totalTokens, estimatedCostUsd };
    }

    // AC-4: non-TTY（CI）或人類拒絕 → blocked，輸出費用摘要
    console.error(tracker.formatCostReport(config));
    const message =
      hitlResult.decision === "non-tty"
        ? "CI 環境超過 Token 預算，自動失敗"
        : "Token 預算超限，操作已拒絕";
    return { status: "exceeded-blocked", totalTokens, estimatedCostUsd, message };
  }

  return { status: "ok", totalTokens, estimatedCostUsd };
}
