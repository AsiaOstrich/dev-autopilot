/**
 * Claude CLI JSON 輸出解析器
 *
 * 解析 `claude -p --output-format json` 的輸出，
 * 提取 session_id、cost、status 等資訊。
 */

/**
 * Claude CLI JSON 輸出結構
 *
 * 對應 `--output-format json` 的回傳格式。
 */
export interface CliJsonOutput {
  /** 執行類型 */
  type: string;
  /** 執行子類型 (success, error_max_turns, error_max_budget_usd 等) */
  subtype: string;
  /** 是否為錯誤狀態 */
  is_error: boolean;
  /** Session ID */
  session_id: string;
  /** 執行耗時（毫秒） */
  duration_ms: number;
  /** API 請求耗時（毫秒） */
  duration_api_ms: number;
  /** 輸入 token 數 */
  num_turns: number;
  /** 最終結果文字 */
  result: string;
  /** 總成本（美元） */
  cost_usd: number;
}

/**
 * 解析 Claude CLI 的 JSON 輸出
 *
 * @param stdout - CLI 的標準輸出（JSON 字串）
 * @returns 解析後的結構化輸出
 * @throws 若 JSON 解析失敗
 */
export function parseCliOutput(stdout: string): CliJsonOutput {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("CLI 輸出為空");
  }

  try {
    const parsed = JSON.parse(trimmed) as CliJsonOutput;

    // 基本欄位檢查
    if (typeof parsed.session_id !== "string") {
      throw new Error("CLI 輸出缺少 session_id");
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`CLI 輸出不是有效的 JSON：${trimmed.slice(0, 200)}`);
    }
    throw error;
  }
}

/**
 * 判斷 CLI 輸出的執行狀態
 *
 * @param output - 解析後的 CLI 輸出
 * @returns "success" | "failed" | "timeout"
 */
export function resolveStatus(output: CliJsonOutput): "success" | "failed" | "timeout" {
  if (!output.is_error && output.subtype === "success") {
    return "success";
  }

  if (output.subtype === "error_max_turns" || output.subtype === "error_max_budget_usd") {
    return "timeout";
  }

  return "failed";
}
