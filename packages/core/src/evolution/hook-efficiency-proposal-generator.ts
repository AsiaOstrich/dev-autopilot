/**
 * Hook Efficiency Proposal Generator（XSPEC-004 Phase 4.2）
 *
 * 根據 HookEfficiencyAnalyzer 的分析結果產生 Markdown 提案，
 * 存入 .evolution/proposals/ 目錄。類比 ProposalGenerator，
 * 但針對 hook 通過率問題而非 token 成本。
 */

import type { StorageBackend } from "../execution-history/types.js";
import type {
  HookEfficiencyAnalysisResult,
  HookEfficiencyIssue,
  Proposal,
  ProposalImpact,
  ProposalMeta,
  AnalysisLogEntry,
} from "./types.js";
import { serializeProposal, parseProposal } from "./proposal-generator.js";

/** 根據 degradation_pct 判定 impact 等級 */
function assessImpact(degradationPct: number): ProposalImpact {
  if (degradationPct >= 30) return "high";
  if (degradationPct >= 15) return "medium";
  return "low";
}

/** 計算 0-1.0 的信心分數 */
function calculateConfidence(issue: HookEfficiencyIssue): number {
  // 執行次數加成：50+ 次 = 滿分，低於 50 等比降低
  const sampleScore = Math.min(issue.executions / 50, 1.0);
  // 失率嚴重程度加成：fail 率 > 50% = 滿分
  const severityScore = Math.min(issue.fail_count / (issue.executions * 0.5), 1.0);
  const raw = sampleScore * 0.5 + severityScore * 0.5;
  return Math.round(raw * 100) / 100;
}

/** 產生單一提案的 Markdown body */
function buildProposalBody(
  issue: HookEfficiencyIssue,
  analysisTimestamp: string,
  confidence: "low" | "high",
  totalExecutions: number,
): string {
  const passRatePct = Math.round(issue.pass_rate * 1000) / 10;
  const failRatePct = Math.round((1 - issue.pass_rate) * 1000) / 10;
  const thresholdPct = Math.round((1 - (issue.degradation_pct / 100 + issue.pass_rate)) * 1000 + issue.degradation_pct * 100) / 100;

  const lowConfidenceWarning =
    confidence === "low"
      ? [
          `> ⚠️ **[LOW CONFIDENCE]** 此提案基於 ${totalExecutions} 筆總執行樣本（< 50），僅供參考，建議累積更多數據後重新分析。`,
          ``,
        ]
      : [];

  const lines: string[] = [
    ...lowConfidenceWarning,
    `## 問題描述`,
    ``,
    `Hook \`${issue.standard_id}\` 的通過率（${passRatePct}%）顯著低於目標閾值，`,
    `低於預期 **${issue.degradation_pct}%**。`,
    `共 ${issue.executions} 次執行中失敗 ${issue.fail_count} 次（失敗率 ${failRatePct}%）。`,
    ``,
    `## 統計資訊`,
    ``,
    `| 指標 | 值 |`,
    `|------|------|`,
    `| Standard ID | \`${issue.standard_id}\` |`,
    `| 總執行次數 | ${issue.executions} |`,
    `| 通過次數 | ${issue.executions - issue.fail_count} |`,
    `| 失敗次數 | ${issue.fail_count} |`,
    `| 通過率 | ${passRatePct}% |`,
    `| 平均耗時 | ${Math.round(issue.avg_duration_ms)}ms |`,
    `| 低於閾值 | ${issue.degradation_pct}% |`,
    ``,
    `## 可能原因`,
    ``,
    `1. **閾值過嚴**：\`${issue.standard_id}\` 的判斷標準可能對當前專案過於嚴格`,
    `2. **實際品質問題**：程式碼/文件真正存在不符合標準的情況`,
    `3. **環境依賴**：Hook 依賴外部工具或資源，可能因環境不穩定而失敗`,
    `4. **超時設定**：執行耗時（平均 ${Math.round(issue.avg_duration_ms)}ms）可能觸發超時`,
    ``,
    `## 建議行動`,
    ``,
    `1. 檢視 \`.standards/${issue.standard_id}.ai.yaml\` 中的 \`enforcement.severity\` 設定`,
    `2. 若為環境問題，考慮增加 \`enforcement.timeout_ms\``,
    `3. 若通過率持續低落，評估調整 enforcement 閾值或改善對應標準的 pre-conditions`,
    `4. 若判斷為誤報，可暫時降低 severity（\`warn\` 取代 \`error\`）`,
    ``,
    `## 風險評估`,
    ``,
    `- 降低 enforcement 嚴格度可能導致真正的品質問題被忽略`,
    `- 修改前建議先在測試分支上驗證變更效果`,
    ``,
    `---`,
    `*分析時間: ${analysisTimestamp}*`,
  ];

  return lines.join("\n");
}

/**
 * Hook 效率提案產生器
 */
export class HookEfficiencyProposalGenerator {
  private readonly backend: StorageBackend;
  private readonly projectName: string;

  constructor(backend: StorageBackend, projectName: string) {
    this.backend = backend;
    this.projectName = projectName;
  }

  /**
   * 從 hook 效率分析結果產生提案
   *
   * @returns 產生的提案列表
   */
  async generate(analysis: HookEfficiencyAnalysisResult): Promise<Proposal[]> {
    // 跳過的分析 or 無問題時不產出提案
    if (analysis.skipped || analysis.issues.length === 0) {
      await this.writeLogEntry(analysis, 0);
      return [];
    }

    const existingFiles = await this.listExistingProposals();
    let seq = existingFiles.length + 1;
    const year = new Date(analysis.timestamp).getFullYear();

    const proposals: Proposal[] = [];

    for (const issue of analysis.issues) {
      const id = `PROP-${year}-${String(seq++).padStart(4, "0")}`;
      const now = new Date().toISOString();
      const confidenceScore = calculateConfidence(issue);

      const meta: ProposalMeta = {
        id,
        status: "pending",
        confidence: confidenceScore,
        impact: assessImpact(issue.degradation_pct),
        target: {
          project: this.projectName,
          file: `.standards/${issue.standard_id}.ai.yaml`,
          field: "enforcement.severity",
        },
        created: now,
        updated: now,
        analysis_ref: analysis.timestamp,
      };

      const body = buildProposalBody(
        issue,
        analysis.timestamp,
        analysis.confidence ?? "low",
        analysis.total_executions,
      );
      const proposal: Proposal = { meta, body };

      const filePath = `proposals/${id}.md`;
      await this.backend.writeFile(filePath, serializeProposal(proposal));

      proposals.push(proposal);
    }

    await this.writeLogEntry(analysis, proposals.length);
    return proposals;
  }

  /** 列出現有提案檔案 */
  private async listExistingProposals(): Promise<string[]> {
    try {
      const files = await this.backend.listDir("proposals");
      return files.filter((f) => f.startsWith("PROP-") && f.endsWith(".md"));
    } catch {
      return [];
    }
  }

  /** 寫入 analysis-log.jsonl */
  private async writeLogEntry(
    analysis: HookEfficiencyAnalysisResult,
    proposalsGenerated: number,
  ): Promise<void> {
    const entry: AnalysisLogEntry = {
      timestamp: analysis.timestamp,
      analyzer: "hook-efficiency",
      status: analysis.skipped ? "skipped" : "completed",
      skip_reason: analysis.skip_reason,
      total_tasks_scanned: analysis.total_standards_scanned,
      outliers_found: analysis.issues.length,
      proposals_generated: proposalsGenerated,
      confidence: analysis.confidence,
    };

    const logPath = "history/analysis-log.jsonl";
    const existing = (await this.backend.readFile(logPath)) ?? "";
    const newContent = existing
      ? `${existing}\n${JSON.stringify(entry)}`
      : JSON.stringify(entry);
    await this.backend.writeFile(logPath, newContent);
  }
}
