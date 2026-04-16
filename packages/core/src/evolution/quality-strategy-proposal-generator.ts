/**
 * Quality Strategy Proposal Generator（XSPEC-004 Phase 4.3）
 *
 * 根據 QualityStrategyAnalyzer 的分析結果產生 Markdown 提案，
 * 存入 .evolution/proposals/ 目錄。
 *
 * 提案類型：
 * - over_provisioned：建議降低品質等級以節省 token
 * - under_performing：建議提升品質等級或改善任務定義
 */

import type { StorageBackend } from "../execution-history/types.js";
import type {
  QualityStrategyAnalysisResult,
  QualityStrategyIssue,
  Proposal,
  ProposalImpact,
  ProposalMeta,
  AnalysisLogEntry,
} from "./types.js";
import { serializeProposal } from "./proposal-generator.js";

/** 根據 severity_pct 判定 impact 等級 */
function assessImpact(severityPct: number): ProposalImpact {
  if (severityPct >= 30) return "high";
  if (severityPct >= 15) return "medium";
  return "low";
}

/** 計算 0-1.0 的信心分數 */
function calculateConfidence(issue: QualityStrategyIssue): number {
  // 樣本數加成：50+ 任務 = 滿分
  const sampleScore = Math.min(issue.task_count / 50, 1.0);
  // 嚴重程度加成：severity_pct ≥ 50 = 滿分
  const severityScore = Math.min(issue.severity_pct / 50, 1.0);
  const raw = sampleScore * 0.5 + severityScore * 0.5;
  return Math.round(raw * 100) / 100;
}

/** 產生單一提案的 Markdown body */
function buildProposalBody(
  issue: QualityStrategyIssue,
  analysisTimestamp: string,
  confidence: "low" | "high",
  totalTasks: number,
): string {
  const passRatePct = Math.round(issue.avg_pass_rate * 1000) / 10;
  const tagLabel = issue.tag_group.join(", ") || "(no-tags)";

  const lowConfidenceWarning =
    confidence === "low"
      ? [
          `> ⚠️ **[LOW CONFIDENCE]** 此提案基於 ${totalTasks} 筆任務樣本（< 50），僅供參考，建議累積更多數據後重新分析。`,
          ``,
        ]
      : [];

  const signalSection =
    issue.signal === "over_provisioned"
      ? [
          `## 問題描述`,
          ``,
          `Tag 群組 \`${tagLabel}\` 的任務通過率高達 **${passRatePct}%**，`,
          `但平均 token 消耗（${issue.avg_tokens.toLocaleString()}）比全域中位數`,
          `（${issue.global_median_tokens.toLocaleString()}）高出 **${issue.severity_pct}%**。`,
          ``,
          `這可能表示此類任務使用了過高的品質等級（如 \`strict\`），`,
          `導致 Judge 頻繁審查卻幾乎總是通過，造成不必要的 token 浪費。`,
          ``,
          `## 建議行動`,
          ``,
          `1. 評估將此 tag 群組的預設品質等級從 \`strict\` 改為 \`standard\``,
          `2. 或調整對應的 Judge 審查觸發條件（降低審查頻率）`,
          `3. 監控調整後的 pass_rate 變化，確保品質未退化`,
        ]
      : [
          `## 問題描述`,
          ``,
          `Tag 群組 \`${tagLabel}\` 的任務通過率僅 **${passRatePct}%**，`,
          `低於目標 ${Math.round((issue.global_median_tokens > 0 ? 70 : 70))}%（差距 **${issue.severity_pct} 個百分點**）。`,
          ``,
          `此群組長期失敗率偏高，可能原因：品質等級設定不足、任務定義不清，`,
          `或 hook 驗證邏輯需要調整。`,
          ``,
          `## 建議行動`,
          ``,
          `1. 審查此 tag 群組的任務定義與完成標準是否明確`,
          `2. 評估提升品質等級（如從 \`standard\` 升為 \`strict\`）以更早攔截問題`,
          `3. 檢視 fix-loop 執行記錄，確認失敗模式是否有規律`,
          `4. 考慮增加 pre-condition 驗證，減少不必要的迭代`,
        ];

  const lines: string[] = [
    ...lowConfidenceWarning,
    ...signalSection,
    ``,
    `## 統計資訊`,
    ``,
    `| 指標 | 值 |`,
    `|------|------|`,
    `| Tag 群組 | \`${tagLabel}\` |`,
    `| 問題類型 | ${issue.signal === "over_provisioned" ? "過度配置（over_provisioned）" : "效果不足（under_performing）"} |`,
    `| 任務數量 | ${issue.task_count} |`,
    `| 平均通過率 | ${passRatePct}% |`,
    `| 平均 token 消耗 | ${issue.avg_tokens.toLocaleString()} |`,
    `| 全域中位數 token | ${issue.global_median_tokens.toLocaleString()} |`,
    `| 嚴重程度 | ${issue.severity_pct}% |`,
    ``,
    `## 風險評估`,
    ``,
    issue.signal === "over_provisioned"
      ? `- 降低品質等級後，少數任務的品質問題可能被漏出\n- 建議搭配 PostToolUse hook 補充驗證\n- 調整後持續監控 pass_rate，若下降超過 5% 應回退`
      : `- 提升品質等級可能增加 token 消耗\n- 若任務定義本身有問題，提升品質等級無法根治\n- 建議先釐清失敗根因再決定是否調整品質等級`,
    ``,
    `---`,
    `*分析時間: ${analysisTimestamp}*`,
  ];

  return lines.join("\n");
}

/**
 * 品質策略提案產生器
 */
export class QualityStrategyProposalGenerator {
  private readonly backend: StorageBackend;
  private readonly projectName: string;

  constructor(backend: StorageBackend, projectName: string) {
    this.backend = backend;
    this.projectName = projectName;
  }

  /**
   * 從品質策略分析結果產生提案
   *
   * @returns 產生的提案列表
   */
  async generate(analysis: QualityStrategyAnalysisResult): Promise<Proposal[]> {
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
      const tagLabel = issue.tag_group.join(", ") || "(no-tags)";

      const meta: ProposalMeta = {
        id,
        status: "pending",
        confidence: confidenceScore,
        impact: assessImpact(issue.severity_pct),
        target: {
          project: this.projectName,
          file: `.evolution/quality-strategy-${tagLabel.replace(/[,\s]+/g, "-")}.md`,
          field: "quality_profile",
        },
        created: now,
        updated: now,
        analysis_ref: analysis.timestamp,
      };

      const body = buildProposalBody(
        issue,
        analysis.timestamp,
        analysis.confidence ?? "low",
        analysis.total_tasks_scanned,
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
    analysis: QualityStrategyAnalysisResult,
    proposalsGenerated: number,
  ): Promise<void> {
    const entry: AnalysisLogEntry = {
      timestamp: analysis.timestamp,
      analyzer: "quality-strategy",
      status: analysis.skipped ? "skipped" : "completed",
      skip_reason: analysis.skip_reason,
      total_tasks_scanned: analysis.total_tasks_scanned,
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
