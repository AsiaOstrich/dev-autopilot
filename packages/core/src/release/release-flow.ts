/**
 * ReleaseFlow — 完整 release 流程編排（XSPEC-089 F-003a runner）
 *
 * 串接 VersionBumper + ChangelogUpdater + git ops + Platform Adapter，
 * 實現 `devap release --bump <level>` 命令的核心流程。
 *
 * 失敗策略：
 * - 任一步驟失敗 → 後續步驟不執行
 * - bump/changelog 失敗 → 已寫入的檔案 rollback（VersionBumper.apply 內處理）
 * - push 失敗 → publish 不執行，輸出手動補救指令（AC-A6）
 */

import { VersionBumper, type BumpLevel, type VersionFileSpec } from "./version-bumper.js";
import { ChangelogUpdater } from "./changelog-updater.js";
import type { PlatformAdapter } from "./platform-adapter.js";
import type { ShellExecutor } from "../quality-gate.js";

/** 單一 release 步驟的執行結果 */
export interface ReleaseStep {
  id: string;
  description: string;
  status: "pending" | "completed" | "failed" | "skipped";
  output?: string;
  error?: string;
}

/** Release flow 設定 */
export interface ReleaseFlowOptions {
  /** 專案根目錄 */
  rootDir: string;
  /** 版本檔規格 */
  versionFiles: VersionFileSpec[];
  /** CHANGELOG.md 絕對路徑 */
  changelogPath: string;
  /** Bump level */
  bumpLevel: BumpLevel;
  /** CHANGELOG body（選填，未提供時只插入空白標題） */
  changelogBody?: string;
  /** 發布日期（YYYY-MM-DD），未提供時使用今天 */
  date?: string;
  /** Shell 執行器（測試注入用） */
  shellExecutor?: ShellExecutor;
  /** 發布平台 adapter（未提供時跳過 publish 步驟） */
  platformAdapter?: PlatformAdapter;
  /** 推送的分支（預設 'main'） */
  branch?: string;
  /** Push 前的使用者確認 callback（未提供時等同 true） */
  onPushConfirm?: () => Promise<boolean>;
}

const DEFAULT_EXECUTOR: ShellExecutor = async () => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export class ReleaseFlow {
  /**
   * 列出所有將執行的步驟，**不修改任何檔案、不執行任何 git 操作**。
   *
   * 用於 `devap release --dry-run`（AC-A1, AC-A5 dry-run）。
   */
  static async dryRun(options: ReleaseFlowOptions): Promise<ReleaseStep[]> {
    const bumper = new VersionBumper(options.rootDir, options.versionFiles);
    const from = await bumper.readCurrentVersion();
    const plan = await bumper.plan(options.bumpLevel);
    const tagName = `v${plan.to}`;
    const branch = options.branch ?? "main";

    const steps: ReleaseStep[] = [
      {
        id: "version-bump",
        description: `bump ${from} → ${plan.to}（${plan.files.length} 個檔案）`,
        status: "pending",
      },
      {
        id: "changelog-update",
        description: "update CHANGELOG",
        status: "pending",
      },
      {
        id: "git-commit-tag",
        description: `git commit + tag ${tagName}`,
        status: "pending",
      },
      {
        id: "git-push",
        description: `git push origin ${branch} ${tagName}`,
        status: "pending",
      },
    ];

    if (options.platformAdapter) {
      const tag = options.platformAdapter.getDistTag(plan.to);
      steps.push({
        id: "publish",
        description: `publish to ${options.platformAdapter.platform}（dist-tag: ${tag}）`,
        status: "pending",
      });
    }

    return steps;
  }

  /**
   * 執行完整 release 流程。
   *
   * 失敗策略：
   * - 任一步驟失敗 → 回傳的 ReleaseStep[] 中該步驟為 "failed"，後續為 "skipped"
   * - 不拋出例外（除非是程式 bug）
   */
  static async run(options: ReleaseFlowOptions): Promise<ReleaseStep[]> {
    const exec = options.shellExecutor ?? DEFAULT_EXECUTOR;
    const branch = options.branch ?? "main";
    const date = options.date ?? todayIso();

    const steps: ReleaseStep[] = [];

    // Step 1: version bump
    const bumper = new VersionBumper(options.rootDir, options.versionFiles);
    let to: string;
    try {
      const plan = await bumper.plan(options.bumpLevel);
      to = plan.to;
      await bumper.apply(plan);
      steps.push({
        id: "version-bump",
        description: `bump ${plan.from} → ${plan.to}`,
        status: "completed",
      });
    } catch (e) {
      steps.push({
        id: "version-bump",
        description: "bump version",
        status: "failed",
        error: (e as Error).message,
      });
      return ReleaseFlow.markRemainingSkipped(steps, [
        "changelog-update",
        "git-commit-tag",
        "git-push",
        ...(options.platformAdapter ? ["publish"] : []),
      ]);
    }

    const tagName = `v${to}`;

    // Step 2: changelog update
    const updater = new ChangelogUpdater(options.changelogPath);
    try {
      const plan = await updater.plan(to, date, options.changelogBody);
      await updater.apply(plan);
      steps.push({
        id: "changelog-update",
        description: "update CHANGELOG",
        status: "completed",
      });
    } catch (e) {
      steps.push({
        id: "changelog-update",
        description: "update CHANGELOG",
        status: "failed",
        error: (e as Error).message,
      });
      return ReleaseFlow.markRemainingSkipped(steps, [
        "git-commit-tag",
        "git-push",
        ...(options.platformAdapter ? ["publish"] : []),
      ]);
    }

    // Step 3: git commit + tag (AC-A5)
    const commitMsg = `chore(release): ${to}`;
    const commitCmd = `git add -A && git commit -m ${JSON.stringify(commitMsg)} && git tag ${tagName}`;
    const commitResult = await exec(commitCmd, options.rootDir);
    if (commitResult.exitCode !== 0) {
      steps.push({
        id: "git-commit-tag",
        description: `git commit + tag ${tagName}`,
        status: "failed",
        error: `git commit/tag 失敗：${commitResult.stderr || commitResult.stdout}`,
      });
      return ReleaseFlow.markRemainingSkipped(steps, [
        "git-push",
        ...(options.platformAdapter ? ["publish"] : []),
      ]);
    }
    steps.push({
      id: "git-commit-tag",
      description: `git commit + tag ${tagName}`,
      status: "completed",
      output: commitResult.stdout,
    });

    // Step 3.5: HUMAN_CONFIRM (push gate)
    if (options.onPushConfirm) {
      const confirmed = await options.onPushConfirm();
      if (!confirmed) {
        steps.push({
          id: "git-push",
          description: `git push origin ${branch} ${tagName}`,
          status: "skipped",
          output: `使用者取消 push。Tag ${tagName} 已在本地建立，可手動執行：git push origin ${branch} ${tagName}`,
        });
        if (options.platformAdapter) {
          steps.push({
            id: "publish",
            description: `publish to ${options.platformAdapter.platform}`,
            status: "skipped",
          });
        }
        return steps;
      }
    }

    // Step 4: git push (AC-A6 — 失敗時顯示手動補救指令)
    const pushCmd = `git push origin ${branch} ${tagName}`;
    const pushResult = await exec(pushCmd, options.rootDir);
    if (pushResult.exitCode !== 0) {
      steps.push({
        id: "git-push",
        description: pushCmd,
        status: "failed",
        error: `git push 失敗：${pushResult.stderr || pushResult.stdout}\nTag ${tagName} 已在本地建立。請排除網路/權限問題後手動執行：${pushCmd}`,
      });
      // publish 不執行（AC-A6）
      if (options.platformAdapter) {
        steps.push({
          id: "publish",
          description: `publish to ${options.platformAdapter.platform}`,
          status: "skipped",
        });
      }
      return steps;
    }
    steps.push({
      id: "git-push",
      description: pushCmd,
      status: "completed",
      output: pushResult.stdout,
    });

    // Step 5: publish (optional)
    if (options.platformAdapter) {
      const publishResult = await options.platformAdapter.publish(to, {
        cwd: options.rootDir,
        shellExecutor: exec,
      });
      steps.push({
        id: "publish",
        description: `publish to ${options.platformAdapter.platform}（dist-tag: ${publishResult.tag}）`,
        status: publishResult.success ? "completed" : "failed",
        output: publishResult.output,
        error: publishResult.error,
      });
    }

    return steps;
  }

  private static markRemainingSkipped(steps: ReleaseStep[], remaining: string[]): ReleaseStep[] {
    for (const id of remaining) {
      steps.push({
        id,
        description: id,
        status: "skipped",
      });
    }
    return steps;
  }
}
