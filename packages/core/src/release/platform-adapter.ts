/**
 * Platform Adapter — 發布平台抽象介面（XSPEC-089 F-003b/c）
 *
 * 各平台（npm/pip/cargo）實作此介面，由 ReleaseFlow 在 publish 步驟呼叫。
 */

import type { ShellExecutor } from "../quality-gate.js";

/** 支援的發布平台 */
export type Platform = "npm" | "pip" | "cargo";

/** 發布選項 */
export interface PublishOptions {
  /** 工作目錄 */
  cwd: string;
  /** dry-run 模式：不執行實際發布命令 */
  dryRun?: boolean;
  /** 注入的 shell 執行器（測試用） */
  shellExecutor?: ShellExecutor;
}

/** 發布結果 */
export interface PublishResult {
  /** 是否成功 */
  success: boolean;
  /** 平台 */
  platform: Platform;
  /** 使用的 tag（如 npm 的 dist-tag） */
  tag?: string;
  /** 完整輸出（給使用者檢視） */
  output: string;
  /** 失敗時的錯誤訊息 */
  error?: string;
}

/**
 * 發布平台轉接器介面
 *
 * 各平台實作必須提供：
 * - publish(version, options)：執行平台特定的發布流程
 * - getDistTag(version)：依版本號決定 tag/channel
 */
export interface PlatformAdapter {
  readonly platform: Platform;

  /**
   * 依版本號決定 dist-tag / channel。
   *
   * 規則（XSPEC-089 AC-B1）：
   * - X.Y.Z       → "latest"
   * - X.Y.Z-beta.N  → "beta"
   * - X.Y.Z-alpha.N → "alpha"
   * - X.Y.Z-rc.N    → "rc"
   * - 其他 prerelease → "next"
   */
  getDistTag(version: string): string;

  /**
   * 執行發布流程。
   *
   * @throws 不直接拋錯；錯誤資訊放在 PublishResult.error，回傳 success=false
   */
  publish(version: string, options: PublishOptions): Promise<PublishResult>;
}

/**
 * 從版本號推斷 dist-tag（共用邏輯）
 *
 * 純函式，所有平台 adapter 都可以呼叫此函式取得標準化的 tag 推斷。
 */
export function inferDistTag(version: string): string {
  const match = version.match(/^\d+\.\d+\.\d+(?:-(.+))?$/);
  if (!match) {
    throw new Error(`inferDistTag: 不支援的版本格式 '${version}'`);
  }
  const prerelease = match[1];
  if (!prerelease) {
    return "latest";
  }
  // 抓 prerelease 開頭的英文識別子
  const idMatch = prerelease.match(/^([a-z]+)/i);
  if (!idMatch) {
    return "next";
  }
  const id = idMatch[1].toLowerCase();
  if (["beta", "alpha", "rc"].includes(id)) {
    return id;
  }
  return "next";
}
