/**
 * CLI 遙測初始化（XSPEC-051）
 *
 * 讀取 ASIAOSTRICH_TELEMETRY_KEY 環境變數或 ~/.devap/telemetry.json，
 * 若存在則建立 TelemetryUploader 並回傳為 OrchestrationTelemetryClient。
 * 不存在時回傳 undefined（靜默，不上傳）。
 *
 * 優先順序：env var > ~/.devap/telemetry.json
 *
 * ~/.devap/telemetry.json 格式：
 * ```json
 * {
 *   "apiKey": "sk-ant-...",
 *   "serverUrl": "https://asiaostrich-telemetry-server.asiaostrich-telemetry.workers.dev"
 * }
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { OrchestrationTelemetryClient } from "@devap/core";

/** telemetry-server 預設端點 */
const DEFAULT_TELEMETRY_URL =
  "https://asiaostrich-telemetry-server.asiaostrich-telemetry.workers.dev/api/v1/ingest/events";

/** ~/.devap/telemetry.json 路徑 */
const TELEMETRY_CONFIG_PATH = resolve(homedir(), ".devap", "telemetry.json");

interface TelemetryFileConfig {
  apiKey?: string;
  serverUrl?: string;
}

/**
 * 嘗試從環境變數或 ~/.devap/telemetry.json 建立 OrchestrationTelemetryClient。
 *
 * - 成功：回傳 TelemetryUploader 實例（符合 OrchestrationTelemetryClient 介面）
 * - 失敗/未設定：回傳 undefined，不上傳，不報錯
 *
 * @returns OrchestrationTelemetryClient 或 undefined
 */
export async function createOrchestrationTelemetry(): Promise<OrchestrationTelemetryClient | undefined> {
  // 1. 讀取設定：env var 優先，其次 ~/.devap/telemetry.json
  let apiKey: string | undefined = process.env.ASIAOSTRICH_TELEMETRY_KEY;
  let serverUrl: string = process.env.ASIAOSTRICH_TELEMETRY_URL ?? DEFAULT_TELEMETRY_URL;

  if (!apiKey && existsSync(TELEMETRY_CONFIG_PATH)) {
    try {
      const raw = readFileSync(TELEMETRY_CONFIG_PATH, "utf-8");
      const config: TelemetryFileConfig = JSON.parse(raw);
      apiKey = config.apiKey;
      if (config.serverUrl) serverUrl = config.serverUrl;
    } catch {
      // 設定檔損壞時靜默跳過
    }
  }

  if (!apiKey) return undefined;

  // 2. 動態 import TelemetryUploader（套件未安裝時靜默跳過）
  try {
    const { TelemetryUploader } = await import("asiaostrich-telemetry-client");
    if (typeof TelemetryUploader !== "function") return undefined;
    return new TelemetryUploader({ serverUrl, apiKey });
  } catch {
    return undefined;
  }
}
