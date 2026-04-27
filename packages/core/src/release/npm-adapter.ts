/**
 * NpmPlatformAdapter — npm 發布實作（XSPEC-089 F-003b）
 *
 * 採用 GitHub Release 觸發 GitHub Actions publish.yml 的模式：
 * - 不直接執行 `npm publish`（避免本機需要 NPM_TOKEN）
 * - 改為呼叫 `gh release create vX.Y.Z`，由 GitHub Actions 接手 publish
 *
 * 這個模式對應 UDS 自身的 release 流程（feedback memory: uds_npm_publish_via_github）。
 */

import type { PlatformAdapter, PublishOptions, PublishResult } from "./platform-adapter.js";
import { inferDistTag } from "./platform-adapter.js";
import type { ShellExecutor } from "../quality-gate.js";

const DEFAULT_EXECUTOR: ShellExecutor = async () => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
});

export class NpmPlatformAdapter implements PlatformAdapter {
  readonly platform = "npm" as const;

  getDistTag(version: string): string {
    return inferDistTag(version);
  }

  async publish(version: string, options: PublishOptions): Promise<PublishResult> {
    const tag = this.getDistTag(version);
    const exec = options.shellExecutor ?? DEFAULT_EXECUTOR;
    const tagName = `v${version}`;

    if (options.dryRun) {
      return {
        success: true,
        platform: "npm",
        tag,
        output: `[dry-run] gh release create ${tagName} (dist-tag: ${tag})`,
      };
    }

    // gh release create vX.Y.Z --title "..." → 觸發 GitHub Actions publish.yml
    const title = `${tagName} — release`;
    const cmd = `gh release create ${tagName} --title ${JSON.stringify(title)} --notes ${JSON.stringify(`Released ${tagName} (dist-tag: ${tag})`)}`;

    const result = await exec(cmd, options.cwd);

    if (result.exitCode !== 0) {
      return {
        success: false,
        platform: "npm",
        tag,
        output: result.stdout,
        error: `gh release create 失敗（exit ${result.exitCode}）：${result.stderr}`,
      };
    }

    return {
      success: true,
      platform: "npm",
      tag,
      output: result.stdout || `gh release create ${tagName} 成功（dist-tag: ${tag}）`,
    };
  }
}
