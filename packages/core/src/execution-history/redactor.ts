/**
 * Sensitive Data Redactor（SPEC-008 REQ-005）
 *
 * 所有 artifacts 在寫入前，自動掃描並 redact 敏感資訊。
 * 支援內建 pattern 和自訂 extra_sensitive_patterns。
 */

import type { SensitivePattern } from "./types.js";

/** 內建的敏感資料 pattern */
const BUILTIN_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  // API Key（sk-proj-..., sk-ant-...）
  { regex: /sk-(?:proj|ant)-[A-Za-z0-9_-]{10,}/g, label: "API_KEY" },
  // GitHub Token（ghp_, gho_, ghs_, ghr_）
  { regex: /gh[posru]_[A-Za-z0-9]{10,}/g, label: "GITHUB_TOKEN" },
  // AWS Access Key ID（AKIA 開頭，20 字元）
  { regex: /AKIA[0-9A-Z]{16}/g, label: "AWS_KEY" },
  // Password（password: xxx, pwd=xxx, password="xxx"）
  { regex: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{3,}['"]?/gi, label: "PASSWORD" },
  // Private Key PEM blocks
  { regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, label: "PRIVATE_KEY" },
];

/**
 * 敏感資料清除器
 */
export class SensitiveDataRedactor {
  private readonly patterns: Array<{ regex: RegExp; label: string }>;

  constructor(extraPatterns?: SensitivePattern[]) {
    this.patterns = [...BUILTIN_PATTERNS];
    if (extraPatterns) {
      for (const p of extraPatterns) {
        try {
          this.patterns.push({ regex: new RegExp(p.pattern, "g"), label: p.label });
        } catch {
          // 無效 regex 靜默忽略
        }
      }
    }
  }

  /**
   * 清除文字中的敏感資訊
   */
  redact(text: string): string {
    if (!text) return text;
    let result = text;
    for (const { regex, label } of this.patterns) {
      // 重置 regex lastIndex（因為帶 g flag）
      regex.lastIndex = 0;
      result = result.replace(regex, `[REDACTED:${label}]`);
    }
    return result;
  }
}
