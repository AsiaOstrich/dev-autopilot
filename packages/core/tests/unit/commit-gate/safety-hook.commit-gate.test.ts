// [Implements XSPEC-088 AC-2/AC-3/AC-4/AC-5] Commit Flow Gate 單元測試
import { describe, it, expect } from "vitest";
import { checkFlowGate, FLOW_GATED_COMMANDS } from "../../../src/safety-hook.js";
import type { FlowState } from "../../../src/safety-hook.js";

// ─────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────

const noStepsCompleted: FlowState = { completedSteps: [] };
const step1Completed: FlowState = { completedSteps: ["generate-message"] };
const bothStepsCompleted: FlowState = { completedSteps: ["generate-message", "user-confirm"] };
const humanContext: FlowState = { completedSteps: [], isHumanContext: true };

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("checkFlowGate — commit gate (XSPEC-088)", () => {
  // [Source: XSPEC-088 AC-2] Step 1 未完成 → 阻止
  it("should_block_git_commit_when_step1_not_completed", () => {
    const result = checkFlowGate("git commit -m 'test'", noStepsCompleted);

    expect(result.blocked).toBe(true);
    expect(result.message).toContain("Step 1");
    expect(result.requiredFlow).toBe("commit");
  });

  // [Source: XSPEC-088 AC-3] Step 1 完成但 Step 2 未確認 → 阻止，顯示 message
  it("should_block_git_commit_when_step2_not_confirmed", () => {
    const result = checkFlowGate("git commit -m 'test'", step1Completed);

    expect(result.blocked).toBe(true);
    expect(result.message).toContain("Step 2");
    expect(result.message).toContain("HUMAN_CONFIRM");
  });

  // [Source: XSPEC-088 AC-1] 所有步驟完成 → 允許
  it("should_allow_git_commit_when_all_steps_completed", () => {
    const result = checkFlowGate("git commit -m 'test'", bothStepsCompleted);

    expect(result.blocked).toBe(false);
  });

  // [Source: XSPEC-088 AC-2 / REQ-5] 人類使用者 → 不攔截
  it("should_not_block_direct_user_terminal_commit", () => {
    const result = checkFlowGate("git commit -m 'manual'", humanContext);

    expect(result.blocked).toBe(false);
  });

  it("should_block_git_commit_with_various_flags", () => {
    const commands = [
      "git commit --amend",
      "git commit -a -m 'all'",
      "GIT COMMIT -m 'caps'",
    ];
    for (const cmd of commands) {
      const result = checkFlowGate(cmd, noStepsCompleted);
      expect(result.blocked).toBe(true);
    }
  });

  it("should_not_block_non_commit_git_commands", () => {
    const commands = ["git push", "git status", "git add -A", "git log"];
    for (const cmd of commands) {
      const result = checkFlowGate(cmd, noStepsCompleted);
      expect(result.blocked).toBe(false);
    }
  });

  it("should_not_block_non_git_commands", () => {
    const result = checkFlowGate("npm run build", noStepsCompleted);
    expect(result.blocked).toBe(false);
  });
});

describe("FLOW_GATED_COMMANDS registry", () => {
  it("should_contain_git_commit_entry", () => {
    expect(FLOW_GATED_COMMANDS.has("git commit")).toBe(true);
    const entry = FLOW_GATED_COMMANDS.get("git commit");
    expect(entry?.flow).toBe("commit");
    expect(entry?.requiredStep).toBe("user-confirm");
  });
});
