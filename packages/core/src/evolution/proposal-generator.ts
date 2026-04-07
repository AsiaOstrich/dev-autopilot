/**
 * Proposal Generator（XSPEC-004 Phase 4.1）
 *
 * 根據 TokenCostAnalyzer 的分析結果產生 Markdown 提案，
 * 存入 .evolution/proposals/ 目錄。
 */

import type { StorageBackend } from "../execution-history/types.js";
import type {
  AnalysisResult,
  Outlier,
  Proposal,
  ProposalImpact,
  ProposalMeta,
  AnalysisLogEntry,
} from "./types.js";

/**
 * 產生提案 ID：PROP-YYYY-NNNN
 *
 * YYYY = 當前年份，NNNN = 從現有提案數遞增
 */
function generateProposalId(year: number, seq: number): string {
  return `PROP-${year}-${String(seq).padStart(4, "0")}`;
}

/** 根據節省百分比判定 impact 等級 */
function assessImpact(savingPct: number): ProposalImpact {
  if (savingPct >= 40) return "high";
  if (savingPct >= 20) return "medium";
  return "low";
}

/** 格式化 tags 為可讀字串 */
function formatTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(", ") : "(no tags)";
}

/** 產生單一提案的 Markdown body */
function buildProposalBody(outlier: Outlier, analysisTimestamp: string): string {
  const lines: string[] = [
    `## 問題描述`,
    ``,
    `任務 \`${outlier.task_id}\` 的平均 token 消耗（${outlier.actual_tokens.toLocaleString()} tokens）`,
    `顯著高於同組平均值（${Math.round(outlier.group_avg).toLocaleString()} tokens），`,
    `為平均值的 ${outlier.ratio.toFixed(1)} 倍。`,
    ``,
    `## 分組資訊`,
    ``,
    `- **Tags**: ${formatTags(outlier.group_key.tags)}`,
    `- **Quality**: ${outlier.group_key.quality}`,
    ``,
    `## 預期效果`,
    ``,
    `若將此任務的 token 消耗降至同組平均水準，預估可節省約 **${outlier.estimated_saving_pct}%** 的 token 消耗。`,
    ``,
    `## 支持證據`,
    ``,
    `| 指標 | 值 |`,
    `|------|------|`,
    `| 實際平均 tokens | ${outlier.actual_tokens.toLocaleString()} |`,
    `| 同組平均 tokens | ${Math.round(outlier.group_avg).toLocaleString()} |`,
    `| 倍率 | ${outlier.ratio.toFixed(2)}x |`,
    `| 預估節省 | ${outlier.estimated_saving_pct}% |`,
    ``,
    `## 建議行動`,
    ``,
    `1. 檢視任務 \`${outlier.task_id}\` 的 spec 與 acceptance criteria 是否過於寬泛`,
    `2. 確認是否有不必要的重試導致 token 浪費`,
    `3. 考慮拆分為更小的子任務以降低單次執行的 token 消耗`,
    ``,
    `## 風險評估`,
    ``,
    `- 修改 spec 可能影響任務的完成品質，需驗證變更後的通過率`,
    `- 拆分子任務會增加 DAG 複雜度，需評估編排成本`,
    ``,
    `---`,
    `*分析時間: ${analysisTimestamp}*`,
  ];
  return lines.join("\n");
}

/** 序列化提案為 Markdown（含 YAML frontmatter） */
export function serializeProposal(proposal: Proposal): string {
  const m = proposal.meta;
  const lines = [
    `---`,
    `id: "${m.id}"`,
    `status: "${m.status}"`,
    `confidence: ${m.confidence}`,
    `impact: "${m.impact}"`,
    `target:`,
    `  project: "${m.target.project}"`,
    ...(m.target.file ? [`  file: "${m.target.file}"`] : []),
    ...(m.target.field ? [`  field: "${m.target.field}"`] : []),
    `created: "${m.created}"`,
    `updated: "${m.updated}"`,
    `analysis_ref: "${m.analysis_ref}"`,
    ...(m.reject_reason ? [`reject_reason: "${m.reject_reason}"`] : []),
    `---`,
    ``,
    `# ${m.id}: Token 成本異常 — ${m.target.file ?? "unknown"}`,
    ``,
    proposal.body,
  ];
  return lines.join("\n");
}

/** 解析提案 Markdown 的 YAML frontmatter */
export function parseProposal(content: string): Proposal | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const fm = fmMatch[1]!;
  const body = fmMatch[2]!.replace(/^# [^\n]*\n\n/, "");

  // 簡易 YAML 解析（只處理已知欄位，支援縮排）
  const get = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]*)"?`, "m"));
    return m?.[1];
  };
  const getNum = (key: string): number => {
    const v = get(key);
    return v ? Number(v) : 0;
  };

  const id = get("id");
  const status = get("status");
  if (!id || !status) return null;

  const meta: ProposalMeta = {
    id,
    status: status as ProposalMeta["status"],
    confidence: getNum("confidence"),
    impact: (get("impact") ?? "low") as ProposalMeta["impact"],
    target: {
      project: get("project") ?? "",
      file: get("file"),
      field: get("field"),
    },
    created: get("created") ?? "",
    updated: get("updated") ?? "",
    analysis_ref: get("analysis_ref") ?? "",
    reject_reason: get("reject_reason"),
  };

  return { meta, body };
}

/**
 * 提案產生器
 */
export class ProposalGenerator {
  private readonly backend: StorageBackend;
  private readonly projectName: string;

  constructor(backend: StorageBackend, projectName: string) {
    this.backend = backend;
    this.projectName = projectName;
  }

  /**
   * 從分析結果產生提案
   *
   * @returns 產生的提案列表
   */
  async generate(analysis: AnalysisResult): Promise<Proposal[]> {
    // 跳過的分析不產出提案
    if (analysis.skipped || analysis.outliers.length === 0) {
      await this.writeLogEntry(analysis, 0);
      return [];
    }

    // 決定起始序號
    const existingFiles = await this.listExistingProposals();
    let seq = existingFiles.length + 1;
    const year = new Date(analysis.timestamp).getFullYear();

    const proposals: Proposal[] = [];

    for (const outlier of analysis.outliers) {
      const id = generateProposalId(year, seq++);
      const now = new Date().toISOString();
      const confidence = this.calculateConfidence(outlier, analysis);

      const meta: ProposalMeta = {
        id,
        status: "pending",
        confidence,
        impact: assessImpact(outlier.estimated_saving_pct),
        target: {
          project: this.projectName,
          file: outlier.task_id,
          field: "token_usage",
        },
        created: now,
        updated: now,
        analysis_ref: analysis.timestamp,
      };

      const body = buildProposalBody(outlier, analysis.timestamp);
      const proposal: Proposal = { meta, body };

      // 寫入 .evolution/proposals/
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

  /**
   * 計算 confidence（0.0-1.0）
   *
   * 基於：分組樣本數、ratio 顯著性
   */
  private calculateConfidence(outlier: Outlier, analysis: AnalysisResult): number {
    const group = analysis.groups.find(
      (g) =>
        g.group_key.quality === outlier.group_key.quality &&
        [...g.group_key.tags].sort().join(",") ===
          [...outlier.group_key.tags].sort().join(","),
    );

    if (!group) return 0.3;

    // 樣本數加成：20+ 樣本 = 滿分，低於 20 等比降低
    const sampleScore = Math.min(group.sample_count / 20, 1.0);

    // ratio 加成：2.0x+ = 滿分，1.5x = 基礎
    const ratioScore = Math.min((outlier.ratio - 1) / 1, 1.0);

    const raw = sampleScore * 0.5 + ratioScore * 0.5;
    return Math.round(raw * 100) / 100;
  }

  /** 寫入 analysis-log.jsonl */
  private async writeLogEntry(
    analysis: AnalysisResult,
    proposalsGenerated: number,
  ): Promise<void> {
    const entry: AnalysisLogEntry = {
      timestamp: analysis.timestamp,
      analyzer: "token-cost",
      status: analysis.skipped ? "skipped" : "completed",
      skip_reason: analysis.skip_reason,
      total_tasks_scanned: analysis.total_tasks_scanned,
      outliers_found: analysis.outliers.length,
      proposals_generated: proposalsGenerated,
    };

    const logPath = "history/analysis-log.jsonl";
    const existing = (await this.backend.readFile(logPath)) ?? "";
    const newContent = existing
      ? `${existing}\n${JSON.stringify(entry)}`
      : JSON.stringify(entry);
    await this.backend.writeFile(logPath, newContent);
  }
}
