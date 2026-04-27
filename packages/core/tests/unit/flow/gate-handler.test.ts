// [Implements XSPEC-087 AC-5] GateHandler 單元測試
import { describe, it, expect } from "vitest";
import { GateHandler } from "../../../src/flow/gate-handler.js";
import type { FlowStep } from "../../../src/types.js";

const humanConfirmStep: FlowStep = {
  id: "user-confirm",
  type: "gate",
  gate: "HUMAN_CONFIRM",
  prompt: "Confirm? [y/n]",
  on_reject: "generate-message",
};

const autoPassStep: FlowStep = {
  id: "auto-gate",
  type: "gate",
  gate: "AUTO_PASS",
};

describe("GateHandler", () => {
  describe("HUMAN_CONFIRM", () => {
    // [Source: XSPEC-087 AC-5] 無輸入 → 暫停
    it("should_suspend_execution_when_reaching_HUMAN_CONFIRM_gate", async () => {
      const result = await GateHandler.handle(humanConfirmStep, undefined);

      expect(result.status).toBe("SUSPENDED");
      expect(result.suspended).toBe(true);
      expect(result.promptDisplayed).toBe(true);
    });

    // [Source: XSPEC-087 AC-5] 使用者輸入 y → 通過
    it("should_pass_gate_when_user_confirms_with_y", async () => {
      const result = await GateHandler.handle(humanConfirmStep, "y");

      expect(result.status).toBe("PASSED");
      expect(result.suspended).toBe(false);
      expect(result.promptDisplayed).toBe(true);
    });

    it("should_pass_gate_when_user_inputs_Y_uppercase", async () => {
      const result = await GateHandler.handle(humanConfirmStep, "Y");
      expect(result.status).toBe("PASSED");
    });

    // [Source: XSPEC-087 AC-5] 使用者輸入 n → 拒絕，跳轉 on_reject
    it("should_redirect_to_on_reject_step_when_user_inputs_n", async () => {
      const result = await GateHandler.handle(humanConfirmStep, "n");

      expect(result.status).toBe("REJECTED");
      expect(result.suspended).toBe(false);
      expect(result.nextStepId).toBe("generate-message");
      expect(result.promptDisplayed).toBe(true);
    });

    it("should_return_undefined_nextStepId_when_on_reject_not_set", async () => {
      const stepWithoutReject: FlowStep = { ...humanConfirmStep, on_reject: undefined };
      const result = await GateHandler.handle(stepWithoutReject, "n");

      expect(result.status).toBe("REJECTED");
      expect(result.nextStepId).toBeUndefined();
    });
  });

  describe("AUTO_PASS", () => {
    it("should_automatically_pass_without_user_input", async () => {
      const result = await GateHandler.handle(autoPassStep);

      expect(result.status).toBe("PASSED");
      expect(result.suspended).toBe(false);
      expect(result.promptDisplayed).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should_throw_when_step_type_is_not_gate", async () => {
      const nonGateStep: FlowStep = { id: "s1", type: "shell", command: "echo" };
      await expect(GateHandler.handle(nonGateStep)).rejects.toThrow(/gate/);
    });

    it("should_throw_for_POLICY_CHECK_as_not_yet_implemented", async () => {
      const policyStep: FlowStep = { id: "pc", type: "gate", gate: "POLICY_CHECK" };
      await expect(GateHandler.handle(policyStep)).rejects.toThrow(/POLICY_CHECK/);
    });
  });
});
