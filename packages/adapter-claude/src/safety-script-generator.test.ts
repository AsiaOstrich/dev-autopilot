/**
 * Safety Script Generator 單元測試
 *
 * Source: SPEC-007, AC-2, AC-6
 * 測試 PreToolUse hook 腳本生成與危險指令攔截邏輯。
 */

import { describe, it, expect } from "vitest";
import { generatePreToolUseScript } from "./safety-script-generator.js";

describe("generatePreToolUseScript", () => {
  // ============================================================
  // AC-2: PreToolUse 攔截所有已知危險指令模式
  // ============================================================

  describe("AC-2: 攔截危險指令", () => {
    it("[AC-2] 應回傳非空的 shell 腳本", () => {
      const script = generatePreToolUseScript();
      expect(script).toBeTruthy();
      expect(typeof script).toBe("string");
    });

    it("[AC-2] 腳本應包含 rm -rf 檢查", () => {
      const script = generatePreToolUseScript();
      expect(script).toContain("rm -rf");
    });

    it("[AC-2] 腳本應包含 drop database 檢查", () => {
      const script = generatePreToolUseScript();
      expect(script.toLowerCase()).toContain("drop database");
    });

    it("[AC-2] 腳本應包含 git push --force 檢查", () => {
      const script = generatePreToolUseScript();
      expect(script).toContain("git push --force");
    });

    it("[AC-2] 腳本應包含 chmod 777 檢查", () => {
      const script = generatePreToolUseScript();
      expect(script).toContain("chmod 777");
    });

    it("[AC-2] 腳本應包含 curl|sh pipe 檢查", () => {
      const script = generatePreToolUseScript();
      expect(script).toMatch(/curl.*sh/i);
    });

    it("[AC-2] 攔截時回傳 exit code 2", () => {
      const script = generatePreToolUseScript();
      expect(script).toContain("exit 2");
    });

    it("[AC-2] 安全指令回傳 exit code 0", () => {
      const script = generatePreToolUseScript();
      expect(script).toContain("exit 0");
    });
  });

  // ============================================================
  // AC-6: 腳本可獨立執行
  // ============================================================

  describe("AC-6: 腳本可獨立執行", () => {
    it("[AC-6] 腳本以 shebang 開頭", () => {
      const script = generatePreToolUseScript();
      expect(script.startsWith("#!/")).toBe(true);
    });

    it("[AC-6] 腳本不依賴 DevAP runtime（不含 import/require）", () => {
      const script = generatePreToolUseScript();
      expect(script).not.toContain("import ");
      expect(script).not.toContain("require(");
    });

    it("[AC-6] 腳本使用 JSON 解析 stdin（jq 或 fallback）", () => {
      const script = generatePreToolUseScript();
      // 應該能解析 tool_name 和 tool_input
      expect(script).toMatch(/tool_name|TOOL_NAME/);
    });

    it("[AC-6] 腳本僅對 Bash 工具做檢查", () => {
      const script = generatePreToolUseScript();
      expect(script).toContain("Bash");
    });
  });
});
