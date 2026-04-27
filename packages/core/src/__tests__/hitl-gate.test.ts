/**
 * XSPEC-091: HITL Gate — unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runHITLGate, shouldRequireHITL } from "../hitl-gate.js";

// Mutable mock answer — set per-test before calling runHITLGate
// null means the readline callback is never invoked (simulates timeout)
let mockAnswer: string | null = "y";

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_prompt: string, cb: (a: string) => void) => {
      if (mockAnswer !== null) cb(mockAnswer);
    }),
    close: vi.fn(),
  })),
}));

describe("shouldRequireHITL (AC-6)", () => {
  it("should_return_true_when_operation_in_always_require_list", () => {
    expect(
      shouldRequireHITL("deploy-prod", {
        always_require: ["deploy-prod", "force-push"],
      })
    ).toBe(true);
  });

  it("should_return_false_when_operation_not_in_always_require_list", () => {
    expect(
      shouldRequireHITL("run-tests", {
        always_require: ["deploy-prod"],
      })
    ).toBe(false);
  });

  it("should_return_false_when_always_require_is_empty", () => {
    expect(shouldRequireHITL("deploy-prod", {})).toBe(false);
  });

  it("should_return_false_when_always_require_is_undefined", () => {
    expect(shouldRequireHITL("deploy-prod", { always_require: undefined })).toBe(
      false
    );
  });
});

describe("runHITLGate", () => {
  let stdinTTY: boolean | undefined;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdinTTY = process.stdin.isTTY;
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAnswer = "y"; // safe default
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: stdinTTY,
      configurable: true,
    });
    consoleLog.mockRestore();
    consoleError.mockRestore();
    vi.clearAllMocks();
  });

  function setTTY(val: boolean | undefined) {
    Object.defineProperty(process.stdin, "isTTY", {
      value: val,
      configurable: true,
    });
  }

  describe("AC-5: 非 TTY 環境立即失敗", () => {
    it("should_fail_immediately_when_stdin_is_not_tty", async () => {
      setTTY(undefined); // 模擬 non-TTY（CI 環境）

      const result = await runHITLGate({
        stepId: "deploy-prod",
        stepDescription: "部署至 production",
      });

      expect(result.passed).toBe(false);
      expect(result.decision).toBe("non-tty");
      expect(result.audit.stepId).toBe("deploy-prod");
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("非互動模式")
      );
    });

    it("should_record_audit_with_non_tty_decision", async () => {
      setTTY(undefined);

      const result = await runHITLGate({
        stepId: "schema-migration",
        stepDescription: "執行 schema migration",
        timeoutSeconds: 60,
      });

      expect(result.audit.decision).toBe("non-tty");
      expect(result.audit.timeoutSeconds).toBe(60);
      expect(result.audit.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("AC-2: 人類確認 → PASSED + 稽核記錄", () => {
    it("should_pass_and_record_audit_when_user_confirms_with_y", async () => {
      setTTY(true);
      mockAnswer = "y";

      const result = await runHITLGate({
        stepId: "deploy-staging",
        stepDescription: "部署至 staging",
        expectedImpact: "staging 環境重新啟動",
      });

      expect(result.passed).toBe(true);
      expect(result.decision).toBe("confirmed");
      expect(result.audit.decision).toBe("confirmed");
      expect(result.audit.stepId).toBe("deploy-staging");
      expect(result.audit.confirmer).toBeTruthy();
    });
  });

  describe("AC-3: 人類拒絕 → REJECTED", () => {
    it("should_reject_when_user_inputs_n", async () => {
      setTTY(true);
      mockAnswer = "n";

      const result = await runHITLGate({
        stepId: "force-push",
        stepDescription: "Force push to main",
      });

      expect(result.passed).toBe(false);
      expect(result.decision).toBe("rejected");
    });

    it("should_reject_when_user_inputs_empty_string", async () => {
      setTTY(true);
      mockAnswer = "";

      const result = await runHITLGate({
        stepId: "drop-table",
        stepDescription: "Drop database table",
      });

      expect(result.passed).toBe(false);
      expect(result.decision).toBe("rejected");
    });
  });

  describe("AC-4: 逾時 → 自動拒絕（不自動通過）", () => {
    it("should_auto_reject_on_timeout_not_auto_pass", async () => {
      setTTY(true);
      mockAnswer = null; // callback never called → simulates timeout

      const result = await runHITLGate({
        stepId: "risky-op",
        stepDescription: "Risky operation",
        timeoutSeconds: 0, // 0ms timeout for test speed
      });

      expect(result.passed).toBe(false);
      expect(result.decision).toBe("timeout");
      expect(result.audit.decision).toBe("timeout");
    });
  });

  describe("shouldRequireHITL integration", () => {
    it("should_correctly_identify_operations_requiring_hitl", () => {
      const config = {
        always_require: ["deploy-prod", "force-push", "schema-migration"],
      };
      expect(shouldRequireHITL("deploy-prod", config)).toBe(true);
      expect(shouldRequireHITL("force-push", config)).toBe(true);
      expect(shouldRequireHITL("schema-migration", config)).toBe(true);
      expect(shouldRequireHITL("run-tests", config)).toBe(false);
      expect(shouldRequireHITL("devap-commit", config)).toBe(false);
    });
  });
});
