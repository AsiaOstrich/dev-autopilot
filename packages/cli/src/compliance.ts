/**
 * 合規保護 — Anthropic ToS 合規檢查
 *
 * 提供首次執行合規告知和認證方式偵測。
 * 參照 SPEC-005-tos-compliance.md。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

/** ~/.devap 目錄路徑 */
const DEVAP_HOME = resolve(homedir(), ".devap");

/** 合規告知標記檔路徑 */
const TERMS_MARKER = resolve(DEVAP_HOME, "terms-accepted");

/**
 * 首次執行合規告知
 *
 * 首次執行時顯示 Anthropic API 使用須知，
 * 使用者確認後寫入 ~/.devap/terms-accepted 標記檔。
 *
 * 靜默條件（任一即可）：
 * - ~/.devap/terms-accepted 已存在
 * - 環境變數 DEVAP_ACCEPT_TERMS=1
 * - CLI flag --accept-terms
 *
 * @param acceptTerms - CLI --accept-terms flag
 */
export function checkTermsAccepted(acceptTerms?: boolean): void {
  // 已接受過 → 靜默
  if (existsSync(TERMS_MARKER)) return;

  // CI 靜默
  if (acceptTerms || process.env.DEVAP_ACCEPT_TERMS === "1") {
    writeMarker();
    return;
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  devap — Anthropic API 使用須知                                ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                ║
║  devap 透過 AI Agent 自動執行任務。使用前請確認：              ║
║                                                                ║
║  1. 使用 Anthropic API key 認證（非 OAuth token）              ║
║     → 設定 ANTHROPIC_API_KEY 環境變數                          ║
║                                                                ║
║  2. 已閱讀並同意 Anthropic 使用條款：                          ║
║     → Commercial Terms: anthropic.com/legal/commercial-terms   ║
║     → Usage Policy: anthropic.com/legal/aup                    ║
║                                                                ║
║  3. Pro/Max 方案的 OAuth 認證僅供個人互動使用，                ║
║     不適用於自動化編排場景                                     ║
║                                                                ║
║  繼續執行即表示您已閱讀並同意上述條款。                        ║
║  設定 DEVAP_ACCEPT_TERMS=1 或 --accept-terms 可靜默此提醒。   ║
║                                                                ║
╚══════════════════════════════════════════════════════════════════╝
`);

  writeMarker();
}

/**
 * 認證方式偵測
 *
 * 當 agentType 為 claude 或 cli 時，
 * 檢查 ANTHROPIC_API_KEY 環境變數是否存在。
 * 未設定時印出警告，但不阻擋執行。
 *
 * @param agentType - 使用的 agent 類型
 */
export function warnIfNoApiKey(agentType: string): void {
  if (agentType !== "claude" && agentType !== "cli") return;
  if (process.env.ANTHROPIC_API_KEY) return;

  console.warn(
    "⚠️  未偵測到 ANTHROPIC_API_KEY 環境變數。\n" +
    "   DevAP 自動化編排需使用 API key 認證（Commercial Terms）。\n" +
    "   Pro/Max OAuth token 不適用於自動化場景。\n" +
    "   → 設定方式：export ANTHROPIC_API_KEY=sk-ant-...\n" +
    "   → 詳見：https://www.anthropic.com/legal/commercial-terms\n",
  );
}

/** 建立標記檔 */
function writeMarker(): void {
  mkdirSync(DEVAP_HOME, { recursive: true });
  writeFileSync(TERMS_MARKER, new Date().toISOString());
}
