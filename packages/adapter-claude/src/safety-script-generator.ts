/**
 * Safety Script Generator
 *
 * 將 safety-hook.ts 的危險指令模式轉換為可獨立執行的 PreToolUse hook shell 腳本。
 * 腳本從 stdin 讀取 JSON（Claude Code hook input），檢查 Bash 工具的 command 參數。
 *
 * 攔截時回傳 exit code 2（block），安全指令回傳 exit code 0（allow）。
 * 不依賴 DevAP runtime，可直接 `sh -c` 執行。
 */

/** 危險字串模式（與 core/safety-hook.ts 同步） */
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

/** 危險 regex 模式描述（shell 用 grep -iE） */
const DANGEROUS_REGEX_DESCRIPTIONS: ReadonlyArray<{ grepPattern: string; description: string }> = [
  { grepPattern: "curl.*\\|.*sh", description: "下載並執行腳本（curl|sh）" },
  { grepPattern: "curl.*\\|.*bash", description: "下載並執行腳本（curl|bash）" },
  { grepPattern: "wget.*\\|.*sh", description: "下載並執行腳本（wget|sh）" },
  { grepPattern: "wget.*\\|.*bash", description: "下載並執行腳本（wget|bash）" },
];

/**
 * 生成 PreToolUse hook 的 shell 腳本
 *
 * 腳本邏輯：
 * 1. 從 stdin 讀取 JSON
 * 2. 若 tool_name 非 Bash → exit 0（允許）
 * 3. 提取 tool_input.command
 * 4. 依序檢查所有危險模式
 * 5. 匹配 → stderr 輸出 JSON（decision: block）+ exit 2
 * 6. 無匹配 → exit 0
 *
 * @returns 可獨立執行的 shell 腳本字串
 */
export function generatePreToolUseScript(): string {
  const lines: string[] = [];

  lines.push("#!/bin/bash");
  lines.push("# DevAP Safety Hook — PreToolUse");
  lines.push("# 自動生成，請勿手動編輯");
  lines.push("");
  lines.push("INPUT=$(cat)");
  lines.push("");
  lines.push("# 提取 tool_name（jq fallback: grep + sed）");
  lines.push("if command -v jq >/dev/null 2>&1; then");
  lines.push('  TOOL_NAME=$(echo "$INPUT" | jq -r \'.tool_name // empty\')');
  lines.push('  CMD=$(echo "$INPUT" | jq -r \'.tool_input.command // empty\')');
  lines.push("else");
  lines.push('  TOOL_NAME=$(echo "$INPUT" | grep -o \'"tool_name"\\s*:\\s*"[^"]*"\' | head -1 | sed \'s/.*"\\([^"]*\\)"$/\\1/\')');
  lines.push('  CMD=$(echo "$INPUT" | grep -o \'"command"\\s*:\\s*"[^"]*"\' | head -1 | sed \'s/.*"\\([^"]*\\)"$/\\1/\')');
  lines.push("fi");
  lines.push("");
  lines.push("# 僅對 Bash 工具做檢查");
  lines.push('if [ "$TOOL_NAME" != "Bash" ]; then exit 0; fi');
  lines.push("");
  lines.push("# 將 CMD 轉為小寫以便比對");
  lines.push('CMD_LOWER=$(echo "$CMD" | tr "[:upper:]" "[:lower:]")');
  lines.push("");

  // 字串模式檢查
  for (const { pattern, description } of DANGEROUS_STRING_PATTERNS) {
    const escaped = pattern.replace(/'/g, "'\\''");
    lines.push(`# 檢查：${description}`);
    lines.push(`if echo "$CMD_LOWER" | grep -q '${escaped}'; then`);
    lines.push(`  echo '{"decision":"block","reason":"DevAP Safety: 偵測到 ${escaped} (${description})"}' >&2`);
    lines.push("  exit 2");
    lines.push("fi");
  }

  lines.push("");

  // Regex 模式檢查
  for (const { grepPattern, description } of DANGEROUS_REGEX_DESCRIPTIONS) {
    lines.push(`# 檢查：${description}`);
    lines.push(`if echo "$CMD_LOWER" | grep -iEq '${grepPattern}'; then`);
    lines.push(`  echo '{"decision":"block","reason":"DevAP Safety: ${description}"}' >&2`);
    lines.push("  exit 2");
    lines.push("fi");
    lines.push("");
  }

  lines.push("# 所有檢查通過");
  lines.push("exit 0");

  return lines.join("\n");
}
