/**
 * XSPEC-090: devap start command — unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStartCommand } from "../start.js";

const mockCheckSpecGate = vi.fn();
vi.mock("@devap/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devap/core")>();
  return {
    ...actual,
    checkSpecGate: (...args: unknown[]) => mockCheckSpecGate(...args),
  };
});

describe("createStartCommand (XSPEC-090)", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  const runCommand = async (args: string[]) => {
    const cmd = createStartCommand();
    try {
      await cmd.parseAsync(["node", "devap", ...args]);
    } catch (e) {
      if ((e as Error).message !== "process.exit called") throw e;
    }
  };

  describe("AC-1: strict 模式攔截", () => {
    it("should_exit_1_when_no_approved_xspec_found_in_strict_mode", async () => {
      mockCheckSpecGate.mockResolvedValue({
        passed: false,
        mode: "strict",
        reason: "找不到對應的 Approved XSPEC，請先執行 /xspec 建立規格",
      });

      await runCommand(["implement user auth"]);

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Spec 合規閘門攔截")
      );
    });

    it("should_exit_1_when_draft_xspec_found_in_strict_mode", async () => {
      mockCheckSpecGate.mockResolvedValue({
        passed: false,
        mode: "strict",
        match: { xspecId: "XSPEC-099", status: "Draft", title: "User Auth" },
        reason: "XSPEC-099 仍為 Draft 狀態，需核准後才能開始實作",
      });

      await runCommand(["implement user auth"]);

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("AC-3: Approved XSPEC 通過", () => {
    it("should_proceed_when_approved_xspec_found", async () => {
      mockCheckSpecGate.mockResolvedValue({
        passed: true,
        mode: "strict",
        match: {
          xspecId: "XSPEC-090",
          status: "Approved",
          title: "DevAP Spec Compliance Gate",
          score: 0.8,
        },
        reason: "找到 Approved XSPEC：XSPEC-090 — DevAP Spec Compliance Gate",
      });

      await runCommand(["implement spec compliance gate"]);

      expect(mockExit).not.toHaveBeenCalled();
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("任務已啟動")
      );
    });
  });

  describe("AC-4: warn 模式通過但顯示警告", () => {
    it("should_pass_with_warning_in_warn_mode", async () => {
      mockCheckSpecGate.mockResolvedValue({
        passed: true,
        mode: "warn",
        reason: "[WARN] 找不到對應的 Approved XSPEC，請先執行 /xspec 建立規格",
      });

      await runCommand(["implement something new", "--compliance", "warn"]);

      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("AC-5: --hotfix 旗標跳過 XSPEC 檢查", () => {
    it("should_skip_spec_gate_when_hotfix_flag_is_set", async () => {
      await runCommand(["fix prod crash", "--hotfix"]);

      expect(mockCheckSpecGate).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("hotfix 例外")
      );
    });
  });
});
