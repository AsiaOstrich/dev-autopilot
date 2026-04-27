/**
 * CargoPlatformAdapter — Rust crate 發布實作（XSPEC-089 F-003c / AC-C2）
 *
 * 流程：
 * - cargo publish  → 上傳至 crates.io
 *
 * 注意：實際使用時需要 cargo login（CARGO_REGISTRY_TOKEN 或 ~/.cargo/credentials.toml）。
 */

import type { PlatformAdapter, PublishOptions, PublishResult } from "./platform-adapter.js";
import { inferDistTag } from "./platform-adapter.js";
import type { ShellExecutor } from "../quality-gate.js";

const DEFAULT_EXECUTOR: ShellExecutor = async () => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
});

export interface CargoPublishOptions extends PublishOptions {
  /** 是否帶 --dry-run flag（cargo 原生支援） */
  cargoDryRun?: boolean;
  /** 是否略過所有權檢查 */
  allowDirty?: boolean;
}

export class CargoPlatformAdapter implements PlatformAdapter {
  readonly platform = "cargo" as const;

  /**
   * crates.io 沒有 dist-tag 概念；穩定版回 "stable"，prerelease 沿用 inferDistTag。
   */
  getDistTag(version: string): string {
    const inferred = inferDistTag(version);
    return inferred === "latest" ? "stable" : inferred;
  }

  async publish(version: string, options: CargoPublishOptions): Promise<PublishResult> {
    const tag = this.getDistTag(version);
    const exec = options.shellExecutor ?? DEFAULT_EXECUTOR;

    const flags: string[] = [];
    if (options.cargoDryRun || options.dryRun) flags.push("--dry-run");
    if (options.allowDirty) flags.push("--allow-dirty");
    const cmd = `cargo publish${flags.length > 0 ? " " + flags.join(" ") : ""}`;

    if (options.dryRun && !options.cargoDryRun) {
      // 我們的 dryRun 概念：完全不 spawn，只顯示計畫的指令
      return {
        success: true,
        platform: "cargo",
        tag,
        output: `[dry-run] ${cmd}`,
      };
    }

    const result = await exec(cmd, options.cwd);
    if (result.exitCode !== 0) {
      return {
        success: false,
        platform: "cargo",
        tag,
        output: result.stdout,
        error: `cargo publish 失敗（exit ${result.exitCode}）：${result.stderr}`,
      };
    }

    return {
      success: true,
      platform: "cargo",
      tag,
      output: result.stdout,
    };
  }
}
