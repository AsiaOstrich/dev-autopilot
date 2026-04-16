/**
 * Branch Drift Detection（XSPEC-047）
 *
 * 偵測工作分支是否落後基底分支，避免在過期程式碼上浪費 token。
 * 借鑑：ultraworkers/claw-code ROADMAP Phase 3 Stale Branch Detection（DEC-035）
 */

import { execSync } from "node:child_process";

export type BranchDriftStatus = "up-to-date" | "warning" | "blocked" | "fetch_failed";

export interface BranchDriftResult {
  readonly behindCount: number;    // -1 表示 fetch 失敗
  readonly status: BranchDriftStatus;
  readonly baseBranch: string;
  readonly warning?: string;
}

export interface BranchDriftConfig {
  readonly warningThreshold: number;   // 預設 5
  readonly blockThreshold: number;     // 預設 6
}

const DEFAULT_CONFIG: BranchDriftConfig = {
  warningThreshold: 5,
  blockThreshold: 6,
};

/**
 * 偵測工作分支落後基底分支的 commit 數。
 *
 * @param baseBranch - 基底分支名稱（預設 "main"）
 * @param cwd - 工作目錄
 * @param config - 閾值配置
 */
export async function checkBranchDrift(
  baseBranch: string = "main",
  cwd: string = process.cwd(),
  config: Partial<BranchDriftConfig> = {},
): Promise<BranchDriftResult> {
  const { warningThreshold, blockThreshold } = { ...DEFAULT_CONFIG, ...config };

  // Step 1: fetch 最新基底分支資訊
  try {
    execSync(`git fetch origin ${baseBranch} --quiet`, { cwd, stdio: "pipe" });
  } catch {
    return {
      behindCount: -1,
      status: "fetch_failed",
      baseBranch,
      warning: `無法 fetch origin/${baseBranch}（離線環境或 remote 不存在）`,
    };
  }

  // Step 2: 計算落後 commit 數
  let behindCount: number;
  try {
    const output = execSync(`git rev-list --count HEAD..origin/${baseBranch}`, {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    behindCount = parseInt(output, 10);
    if (isNaN(behindCount)) throw new Error("invalid output");
  } catch {
    return {
      behindCount: -1,
      status: "fetch_failed",
      baseBranch,
      warning: "無法計算分支落後數（detached HEAD 或 shallow clone）",
    };
  }

  // Step 3: 三級回應
  if (behindCount === 0) {
    return { behindCount, status: "up-to-date", baseBranch };
  } else if (behindCount <= warningThreshold) {
    return {
      behindCount,
      status: "warning",
      baseBranch,
      warning: `工作分支落後 origin/${baseBranch} ${behindCount} 個 commit`,
    };
  } else {
    return {
      behindCount,
      status: "blocked",
      baseBranch,
      warning: `工作分支落後 origin/${baseBranch} ${behindCount} 個 commit（>= ${blockThreshold}），需先 rebase`,
    };
  }
}
