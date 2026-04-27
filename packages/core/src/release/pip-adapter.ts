/**
 * PipPlatformAdapter — Python 套件發布實作（XSPEC-089 F-003c / AC-C1）
 *
 * 流程：
 * 1. python -m build  → 產生 wheel + sdist
 * 2. twine upload dist/*  → 上傳至 PyPI
 *
 * 注意：實際使用時需要 PyPI 認證（~/.pypirc 或環境變數）。
 */

import type { PlatformAdapter, PublishOptions, PublishResult } from "./platform-adapter.js";
import { inferDistTag } from "./platform-adapter.js";
import type { ShellExecutor } from "../quality-gate.js";

const DEFAULT_EXECUTOR: ShellExecutor = async () => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
});

export interface PipPublishOptions extends PublishOptions {
  /** 上傳目標倉庫（預設 PyPI；可設為 'testpypi' 用於 staging） */
  repository?: "pypi" | "testpypi";
}

export class PipPlatformAdapter implements PlatformAdapter {
  readonly platform = "pip" as const;

  /**
   * 對 pip：穩定版 = "stable"，prerelease 委派給 inferDistTag 邏輯。
   * 此值僅供顯示／追蹤用，不直接傳給 PyPI。
   */
  getDistTag(version: string): string {
    const inferred = inferDistTag(version);
    return inferred === "latest" ? "stable" : inferred;
  }

  async publish(version: string, options: PipPublishOptions): Promise<PublishResult> {
    const tag = this.getDistTag(version);
    const exec = options.shellExecutor ?? DEFAULT_EXECUTOR;
    const repo = options.repository ?? "pypi";

    if (options.dryRun) {
      return {
        success: true,
        platform: "pip",
        tag,
        output: `[dry-run] python -m build && twine upload --repository ${repo} dist/*`,
      };
    }

    // Step 1: build
    const buildResult = await exec("python -m build", options.cwd);
    if (buildResult.exitCode !== 0) {
      return {
        success: false,
        platform: "pip",
        tag,
        output: buildResult.stdout,
        error: `python -m build 失敗（exit ${buildResult.exitCode}）：${buildResult.stderr}`,
      };
    }

    // Step 2: twine upload
    const uploadCmd =
      repo === "testpypi"
        ? "twine upload --repository testpypi dist/*"
        : "twine upload dist/*";
    const uploadResult = await exec(uploadCmd, options.cwd);
    if (uploadResult.exitCode !== 0) {
      return {
        success: false,
        platform: "pip",
        tag,
        output: `${buildResult.stdout}\n${uploadResult.stdout}`,
        error: `twine upload 失敗（exit ${uploadResult.exitCode}）：${uploadResult.stderr}`,
      };
    }

    return {
      success: true,
      platform: "pip",
      tag,
      output: `${buildResult.stdout}\n${uploadResult.stdout}`,
    };
  }
}
