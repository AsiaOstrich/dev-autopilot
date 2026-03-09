/**
 * Safety Hook — 危險操作攔截 + 祕密掃描
 *
 * Pre-execution hook，檢查 task spec 和 verify_command 是否包含危險指令。
 * 攔截清單：rm -rf, DROP DATABASE, git push --force, chmod 777, curl|sh, wget|bash
 *
 * 祕密掃描：偵測硬編碼的 AWS key、API token、密碼等敏感資訊。
 */

import type { Task, SafetyHook } from "./types.js";

/**
 * 危險指令模式清單
 *
 * 使用字串模式（簡單包含檢查）和 regex 模式（pipe 指令等複雜情境）。
 */
const DANGEROUS_STRING_PATTERNS: ReadonlyArray<{ pattern: string; description: string }> = [
  { pattern: "rm -rf", description: "遞迴強制刪除" },
  { pattern: "drop database", description: "刪除資料庫" },
  { pattern: "git push --force", description: "強制推送" },
  { pattern: "git push -f", description: "強制推送" },
  { pattern: "chmod 777", description: "開放所有權限" },
  { pattern: "mkfs.", description: "格式化磁碟" },
  { pattern: "> /dev/sda", description: "覆寫磁碟" },
  { pattern: "dd if=", description: "低階磁碟操作" },
];

/**
 * 危險 pipe 模式（regex）
 *
 * 匹配 curl/wget 透過 pipe 執行 sh/bash 的模式。
 */
const DANGEROUS_REGEX_PATTERNS: ReadonlyArray<{ regex: RegExp; description: string }> = [
  { regex: /curl\s.*\|\s*sh/i, description: "下載並執行腳本（curl|sh）" },
  { regex: /curl\s.*\|\s*bash/i, description: "下載並執行腳本（curl|bash）" },
  { regex: /wget\s.*\|\s*sh/i, description: "下載並執行腳本（wget|sh）" },
  { regex: /wget\s.*\|\s*bash/i, description: "下載並執行腳本（wget|bash）" },
];

/**
 * 檢查文字中是否包含危險指令
 *
 * @param text - 要檢查的文字
 * @returns 匹配到的危險指令描述，未匹配回傳 null
 */
export function detectDangerousCommand(text: string): string | null {
  const lowerText = text.toLowerCase();

  // 字串模式匹配
  for (const { pattern, description } of DANGEROUS_STRING_PATTERNS) {
    if (lowerText.includes(pattern)) {
      return `偵測到危險操作「${pattern}」：${description}`;
    }
  }

  // Regex 模式匹配
  for (const { regex, description } of DANGEROUS_REGEX_PATTERNS) {
    if (regex.test(text)) {
      return `偵測到危險操作：${description}`;
    }
  }

  return null;
}

/**
 * 硬編碼祕密模式清單
 *
 * 偵測常見的 API key、token、密碼等硬編碼模式。
 */
const SECRET_PATTERNS: ReadonlyArray<{ regex: RegExp; description: string }> = [
  // AWS Access Key ID (AKIA 開頭，20 字元大寫英數)
  { regex: /AKIA[0-9A-Z]{16}/, description: "AWS Access Key ID" },
  // AWS Secret Access Key (40 字元 base64-like)
  { regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/, description: "AWS Secret Access Key" },
  // Generic API Key patterns
  { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/i, description: "API Key" },
  // Generic Secret/Token patterns
  { regex: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i, description: "硬編碼密碼或 token" },
  // GitHub Personal Access Token (ghp_ 開頭)
  { regex: /ghp_[A-Za-z0-9]{36}/, description: "GitHub Personal Access Token" },
  // Slack Token
  { regex: /xox[bprs]-[A-Za-z0-9\-]+/, description: "Slack Token" },
  // Private Key
  { regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, description: "私鑰" },
];

/**
 * 檢查文字中是否包含硬編碼祕密
 *
 * @param text - 要檢查的文字
 * @returns 匹配到的祕密描述列表（空陣列表示未偵測到）
 */
export function detectHardcodedSecrets(text: string): string[] {
  const findings: string[] = [];

  for (const { regex, description } of SECRET_PATTERNS) {
    if (regex.test(text)) {
      findings.push(`偵測到疑似硬編碼祕密：${description}`);
    }
  }

  return findings;
}

/**
 * 建立預設的 safety hook
 *
 * 檢查 task 的 spec 和 verify_command 是否包含危險指令。
 * 回傳 true 表示安全，false 表示被攔截。
 *
 * @returns SafetyHook 函式
 */
export function createDefaultSafetyHook(): SafetyHook {
  return (task: Task): boolean => {
    // 檢查 spec
    const specDanger = detectDangerousCommand(task.spec);
    if (specDanger) {
      return false;
    }

    // 檢查 verify_command
    if (task.verify_command) {
      const verifyDanger = detectDangerousCommand(task.verify_command);
      if (verifyDanger) {
        return false;
      }
    }

    return true;
  };
}
