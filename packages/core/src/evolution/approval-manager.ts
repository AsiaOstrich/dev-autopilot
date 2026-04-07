/**
 * Approval Manager（XSPEC-004 Phase 4.1）
 *
 * 管理提案的 approve / reject / apply 流程。
 * 所有變更須經人類審批，approval.required 不可關閉。
 */

import type { StorageBackend } from "../execution-history/types.js";
import type { Proposal, ProposalStatus } from "./types.js";
import { parseProposal, serializeProposal } from "./proposal-generator.js";

/** Apply 確認回呼：顯示 diff 給使用者，回傳 true 表示確認套用 */
export type ConfirmApplyFn = (proposalId: string, diff: string) => Promise<boolean>;

/** 操作結果 */
export interface ApprovalResult {
  success: boolean;
  proposal_id: string;
  new_status: ProposalStatus;
  message: string;
}

/**
 * 提案審批管理器
 */
export class ApprovalManager {
  private readonly backend: StorageBackend;

  constructor(backend: StorageBackend) {
    this.backend = backend;
  }

  /**
   * 列出所有提案（可依狀態過濾）
   */
  async listProposals(statusFilter?: ProposalStatus): Promise<Proposal[]> {
    let files: string[];
    try {
      files = await this.backend.listDir("proposals");
    } catch {
      return [];
    }

    const proposals: Proposal[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await this.backend.readFile(`proposals/${file}`);
      if (!content) continue;
      const proposal = parseProposal(content);
      if (!proposal) continue;
      if (statusFilter && proposal.meta.status !== statusFilter) continue;
      proposals.push(proposal);
    }

    return proposals;
  }

  /**
   * 讀取單一提案
   */
  async getProposal(proposalId: string): Promise<Proposal | null> {
    const content = await this.backend.readFile(`proposals/${proposalId}.md`);
    if (!content) return null;
    return parseProposal(content);
  }

  /**
   * 核准提案 → 狀態變為 approved，產出 .diff 檔案
   */
  async approve(proposalId: string): Promise<ApprovalResult> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      return {
        success: false,
        proposal_id: proposalId,
        new_status: "pending",
        message: `提案 ${proposalId} 不存在`,
      };
    }

    if (proposal.meta.status !== "pending") {
      return {
        success: false,
        proposal_id: proposalId,
        new_status: proposal.meta.status,
        message: `提案 ${proposalId} 目前狀態為 ${proposal.meta.status}，僅 pending 可核准`,
      };
    }

    // 更新狀態
    proposal.meta.status = "approved";
    proposal.meta.updated = new Date().toISOString();
    await this.backend.writeFile(
      `proposals/${proposalId}.md`,
      serializeProposal(proposal),
    );

    // 產出 .diff（目前為描述性 diff，Phase 4.2+ 可擴充為真實 patch）
    const diff = this.generateDiff(proposal);
    await this.backend.writeFile(`proposals/${proposalId}.diff`, diff);

    return {
      success: true,
      proposal_id: proposalId,
      new_status: "approved",
      message: `提案 ${proposalId} 已核准，diff 已產出`,
    };
  }

  /**
   * 拒絕提案 → 狀態變為 rejected，記錄原因
   */
  async reject(proposalId: string, reason: string): Promise<ApprovalResult> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      return {
        success: false,
        proposal_id: proposalId,
        new_status: "pending",
        message: `提案 ${proposalId} 不存在`,
      };
    }

    if (proposal.meta.status !== "pending") {
      return {
        success: false,
        proposal_id: proposalId,
        new_status: proposal.meta.status,
        message: `提案 ${proposalId} 目前狀態為 ${proposal.meta.status}，僅 pending 可拒絕`,
      };
    }

    proposal.meta.status = "rejected";
    proposal.meta.updated = new Date().toISOString();
    proposal.meta.reject_reason = reason;
    await this.backend.writeFile(
      `proposals/${proposalId}.md`,
      serializeProposal(proposal),
    );

    return {
      success: true,
      proposal_id: proposalId,
      new_status: "rejected",
      message: `提案 ${proposalId} 已拒絕：${reason}`,
    };
  }

  /**
   * 套用已核准的提案 → 顯示 diff 提示確認，確認後狀態變為 applied
   */
  async apply(
    proposalId: string,
    confirmFn: ConfirmApplyFn,
  ): Promise<ApprovalResult> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      return {
        success: false,
        proposal_id: proposalId,
        new_status: "pending",
        message: `提案 ${proposalId} 不存在`,
      };
    }

    if (proposal.meta.status !== "approved") {
      return {
        success: false,
        proposal_id: proposalId,
        new_status: proposal.meta.status,
        message: `提案 ${proposalId} 目前狀態為 ${proposal.meta.status}，僅 approved 可套用`,
      };
    }

    // 讀取 diff
    const diff =
      (await this.backend.readFile(`proposals/${proposalId}.diff`)) ??
      this.generateDiff(proposal);

    // 透過回呼確認
    const confirmed = await confirmFn(proposalId, diff);
    if (!confirmed) {
      return {
        success: false,
        proposal_id: proposalId,
        new_status: "approved",
        message: `提案 ${proposalId} 套用已取消`,
      };
    }

    // 更新狀態
    proposal.meta.status = "applied";
    proposal.meta.updated = new Date().toISOString();
    await this.backend.writeFile(
      `proposals/${proposalId}.md`,
      serializeProposal(proposal),
    );

    return {
      success: true,
      proposal_id: proposalId,
      new_status: "applied",
      message: `提案 ${proposalId} 已套用`,
    };
  }

  /**
   * 產生描述性 diff（Phase 4.1 為 descriptive diff）
   */
  private generateDiff(proposal: Proposal): string {
    const m = proposal.meta;
    const lines = [
      `# Proposal Diff: ${m.id}`,
      `# Target: ${m.target.project} / ${m.target.file ?? "N/A"} / ${m.target.field ?? "N/A"}`,
      `# Impact: ${m.impact}`,
      `# Confidence: ${m.confidence}`,
      `#`,
      `# This is a descriptive diff for Phase 4.1.`,
      `# Actual file patches will be generated in Phase 4.2+.`,
      `#`,
      `# Suggested changes:`,
      `# - Review task ${m.target.file ?? "unknown"} for token optimization opportunities`,
      `# - Consider splitting large tasks or refining acceptance criteria`,
      `# - Validate changes do not degrade quality metrics`,
    ];
    return lines.join("\n");
  }
}
