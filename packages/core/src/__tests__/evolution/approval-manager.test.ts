import { describe, it, expect, vi } from "vitest";
import type { StorageBackend } from "../../execution-history/types.js";
import { ApprovalManager } from "../../evolution/approval-manager.js";
import { serializeProposal } from "../../evolution/proposal-generator.js";
import type { Proposal, ProposalMeta } from "../../evolution/types.js";

// ─── Helpers ────────────────────────────────────────────

function createMockBackend(overrides?: Partial<StorageBackend>): StorageBackend {
  return {
    readFile: vi.fn(async () => null),
    writeFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    deleteDir: vi.fn(async () => {}),
    listDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    ...overrides,
  };
}

function writes(b: StorageBackend): Array<[string, string]> {
  return (b.writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string]>;
}

function makeMeta(overrides?: Partial<ProposalMeta>): ProposalMeta {
  return {
    id: "PROP-2026-0001",
    status: "pending",
    confidence: 0.75,
    impact: "high",
    target: { project: "test", file: "T-005", field: "token_usage" },
    created: "2026-01-15T10:00:00Z",
    updated: "2026-01-15T10:00:00Z",
    analysis_ref: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeProposal(metaOverrides?: Partial<ProposalMeta>): Proposal {
  return {
    meta: makeMeta(metaOverrides),
    body: "## 問題描述\n\n測試提案內容",
  };
}

function backendWithProposal(proposal: Proposal): StorageBackend {
  const serialized = serializeProposal(proposal);
  return createMockBackend({
    readFile: vi.fn(async (path: string) => {
      if (path === `proposals/${proposal.meta.id}.md`) return serialized;
      return null;
    }),
    listDir: vi.fn(async () => [`${proposal.meta.id}.md`]),
  });
}

// ─── Tests ──────────────────────────────────────────────

describe("ApprovalManager", () => {
  describe("listProposals()", () => {
    it("無提案時應回傳空陣列", async () => {
      const backend = createMockBackend();
      const manager = new ApprovalManager(backend);
      const result = await manager.listProposals();
      expect(result).toHaveLength(0);
    });

    it("應列出所有提案", async () => {
      const proposal = makeProposal();
      const backend = backendWithProposal(proposal);
      const manager = new ApprovalManager(backend);

      const result = await manager.listProposals();
      expect(result).toHaveLength(1);
      expect(result[0]!.meta.id).toBe("PROP-2026-0001");
    });

    it("應依狀態過濾", async () => {
      const proposal = makeProposal({ status: "approved" });
      const backend = backendWithProposal(proposal);
      const manager = new ApprovalManager(backend);

      const pending = await manager.listProposals("pending");
      expect(pending).toHaveLength(0);

      const approved = await manager.listProposals("approved");
      expect(approved).toHaveLength(1);
    });
  });

  describe("getProposal()", () => {
    it("不存在時應回傳 null", async () => {
      const backend = createMockBackend();
      const manager = new ApprovalManager(backend);
      const result = await manager.getProposal("PROP-9999-0001");
      expect(result).toBeNull();
    });

    it("應回傳完整提案", async () => {
      const proposal = makeProposal();
      const backend = backendWithProposal(proposal);
      const manager = new ApprovalManager(backend);

      const result = await manager.getProposal("PROP-2026-0001");
      expect(result).not.toBeNull();
      expect(result!.meta.id).toBe("PROP-2026-0001");
    });
  });

  describe("approve()", () => {
    it("pending 提案應成功核准", async () => {
      const proposal = makeProposal();
      const backend = backendWithProposal(proposal);
      const manager = new ApprovalManager(backend);

      const result = await manager.approve("PROP-2026-0001");

      expect(result.success).toBe(true);
      expect(result.new_status).toBe("approved");

      // 應寫入更新的 .md 和 .diff
      const allWrites = writes(backend);
      const mdWrite = allWrites.find(([p]) => p.endsWith(".md"));
      const diffWrite = allWrites.find(([p]) => p.endsWith(".diff"));
      expect(mdWrite).toBeDefined();
      expect(diffWrite).toBeDefined();
      expect(mdWrite![1]).toContain('status: "approved"');
    });

    it("非 pending 提案不可核准", async () => {
      const proposal = makeProposal({ status: "rejected" });
      const backend = backendWithProposal(proposal);
      const manager = new ApprovalManager(backend);

      const result = await manager.approve("PROP-2026-0001");
      expect(result.success).toBe(false);
      expect(result.message).toContain("rejected");
    });

    it("不存在的提案應回傳失敗", async () => {
      const backend = createMockBackend();
      const manager = new ApprovalManager(backend);

      const result = await manager.approve("PROP-9999-0001");
      expect(result.success).toBe(false);
      expect(result.message).toContain("不存在");
    });
  });

  describe("reject()", () => {
    it("pending 提案應成功拒絕", async () => {
      const proposal = makeProposal();
      const backend = backendWithProposal(proposal);
      const manager = new ApprovalManager(backend);

      const result = await manager.reject("PROP-2026-0001", "不適用於目前架構");

      expect(result.success).toBe(true);
      expect(result.new_status).toBe("rejected");

      const allWrites = writes(backend);
      const mdWrite = allWrites.find(([p]) => p.endsWith(".md"));
      expect(mdWrite).toBeDefined();
      expect(mdWrite![1]).toContain('status: "rejected"');
      expect(mdWrite![1]).toContain("不適用於目前架構");
    });

    it("非 pending 提案不可拒絕", async () => {
      const proposal = makeProposal({ status: "approved" });
      const backend = backendWithProposal(proposal);
      const manager = new ApprovalManager(backend);

      const result = await manager.reject("PROP-2026-0001", "test");
      expect(result.success).toBe(false);
    });
  });

  describe("apply()", () => {
    it("approved 提案確認後應成功套用", async () => {
      const proposal = makeProposal({ status: "approved" });
      const serialized = serializeProposal(proposal);
      const backend = createMockBackend({
        readFile: vi.fn(async (path: string) => {
          if (path === "proposals/PROP-2026-0001.md") return serialized;
          if (path === "proposals/PROP-2026-0001.diff") return "# diff content";
          return null;
        }),
      });

      const confirmFn = vi.fn(async () => true);
      const manager = new ApprovalManager(backend);

      const result = await manager.apply("PROP-2026-0001", confirmFn);

      expect(result.success).toBe(true);
      expect(result.new_status).toBe("applied");
      expect(confirmFn).toHaveBeenCalledWith("PROP-2026-0001", "# diff content");
    });

    it("使用者取消時不應套用", async () => {
      const proposal = makeProposal({ status: "approved" });
      const backend = backendWithProposal(proposal);
      // 重新 mock readFile 以同時支援 .diff
      (backend.readFile as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === "proposals/PROP-2026-0001.md") return serializeProposal(proposal);
        return null;
      });

      const confirmFn = vi.fn(async () => false);
      const manager = new ApprovalManager(backend);

      const result = await manager.apply("PROP-2026-0001", confirmFn);

      expect(result.success).toBe(false);
      expect(result.new_status).toBe("approved");
      expect(result.message).toContain("取消");
    });

    it("非 approved 提案不可套用", async () => {
      const proposal = makeProposal({ status: "pending" });
      const backend = backendWithProposal(proposal);
      const confirmFn = vi.fn(async () => true);
      const manager = new ApprovalManager(backend);

      const result = await manager.apply("PROP-2026-0001", confirmFn);

      expect(result.success).toBe(false);
      expect(confirmFn).not.toHaveBeenCalled();
    });
  });
});
