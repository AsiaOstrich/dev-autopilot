/**
 * SensitiveDataRedactor 單元測試（SPEC-008 REQ-005）
 *
 * 17 個測試：內建 pattern、多模式混合、無匹配、自訂 pattern。
 */

import { describe, it, expect } from "vitest";
import { SensitiveDataRedactor } from "../../execution-history/redactor.js";

describe("SensitiveDataRedactor", () => {
  // ============================================================
  // REQ-005: 內建 pattern 偵測
  // ============================================================

  describe("API Key redaction", () => {
    it("應將 sk-proj-... 替換為 [REDACTED:API_KEY]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "key is sk-proj-abc123def456ghi789jkl012";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:API_KEY]");
      expect(result).not.toContain("sk-proj-");
    });

    it("應將 sk-ant-... 替換為 [REDACTED:API_KEY]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "using sk-ant-api03-xxxxxxxxxxxxxxxxxxxx";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:API_KEY]");
      expect(result).not.toContain("sk-ant-");
    });
  });

  describe("GitHub Token redaction", () => {
    it("應將 ghp_... 替換為 [REDACTED:GITHUB_TOKEN]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:GITHUB_TOKEN]");
      expect(result).not.toContain("ghp_");
    });

    it("應將 gho_... 替換為 [REDACTED:GITHUB_TOKEN]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "oauth: gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:GITHUB_TOKEN]");
    });
  });

  describe("Password redaction", () => {
    it("應將 password: xxx 替換為 [REDACTED:PASSWORD]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = 'config password: myS3cretP@ss here';
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:PASSWORD]");
      expect(result).not.toContain("myS3cretP@ss");
    });

    it("應將 pwd=xxx 替換為 [REDACTED:PASSWORD]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "pwd=secret123";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:PASSWORD]");
    });

    it('應將 password="xxx" 替換為 [REDACTED:PASSWORD]', () => {
      const redactor = new SensitiveDataRedactor();
      const text = 'password="hunter2"';
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:PASSWORD]");
    });
  });

  describe("AWS Key redaction", () => {
    it("應將 AKIA... 開頭的 AWS Access Key 替換為 [REDACTED:AWS_KEY]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "aws key: AKIAIOSFODNN7EXAMPLE";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:AWS_KEY]");
      expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
    });
  });

  describe("Private Key redaction", () => {
    it("應將 -----BEGIN PRIVATE KEY----- 區塊替換為 [REDACTED:PRIVATE_KEY]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "cert:\n-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:PRIVATE_KEY]");
      expect(result).not.toContain("BEGIN PRIVATE KEY");
    });

    it("應將 -----BEGIN RSA PRIVATE KEY----- 區塊替換為 [REDACTED:PRIVATE_KEY]", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:PRIVATE_KEY]");
    });
  });

  // ============================================================
  // REQ-005: 多模式混合
  // ============================================================

  describe("多模式混合", () => {
    it("應同時 redact 同一文字中的多種 sensitive pattern", () => {
      const redactor = new SensitiveDataRedactor();
      const text = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij, password: secret123';
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:GITHUB_TOKEN]");
      expect(result).toContain("[REDACTED:PASSWORD]");
    });

    it("應 redact 同一文字中出現多次的同類型 pattern", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "key1: sk-proj-aaaaaaaaaaaa, key2: sk-proj-bbbbbbbbbbbb";
      const result = redactor.redact(text);
      expect(result).not.toContain("sk-proj-");
      const count = (result.match(/\[REDACTED:API_KEY\]/g) ?? []).length;
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // REQ-005: 無匹配時不變更
  // ============================================================

  describe("無匹配", () => {
    it("無敏感資訊的文字應原樣回傳", () => {
      const redactor = new SensitiveDataRedactor();
      const text = "const x = 42; // normal code";
      expect(redactor.redact(text)).toBe(text);
    });

    it("空字串應回傳空字串", () => {
      const redactor = new SensitiveDataRedactor();
      expect(redactor.redact("")).toBe("");
    });
  });

  // ============================================================
  // REQ-005: 自訂 extra_sensitive_patterns
  // ============================================================

  describe("自訂 extra_sensitive_patterns", () => {
    it("應支援額外的自訂 pattern", () => {
      const redactor = new SensitiveDataRedactor([
        { pattern: "INTERNAL-\\w+", label: "INTERNAL_ID" },
      ]);
      const result = redactor.redact("id: INTERNAL-ABC123");
      expect(result).toContain("[REDACTED:INTERNAL_ID]");
    });

    it("自訂 pattern 應與內建 pattern 共同運作", () => {
      const redactor = new SensitiveDataRedactor([
        { pattern: "INTERNAL-\\w+", label: "INTERNAL_ID" },
      ]);
      const text = "id: INTERNAL-ABC123, key: sk-proj-xxxxxxxxxxxx";
      const result = redactor.redact(text);
      expect(result).toContain("[REDACTED:INTERNAL_ID]");
      expect(result).toContain("[REDACTED:API_KEY]");
    });

    it("無效的 regex pattern 不應導致整個 redact 失敗", () => {
      const redactor = new SensitiveDataRedactor([
        { pattern: "[invalid", label: "BAD" },
      ]);
      const text = "safe content";
      expect(() => redactor.redact(text)).not.toThrow();
    });
  });
});
