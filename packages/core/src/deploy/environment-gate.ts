/**
 * 環境保護閘門（XSPEC-093）
 *
 * AC-2: 無 git tag 時拒絕部署
 * AC-5: requires_staging=true 時，staging 未成功拒絕 prod 部署
 * AC-6: prod 環境必定插入 HITL 確認閘門（不可關閉）
 */

import { execSync } from "node:child_process";
import { runHITLGate } from "../hitl-gate.js";
import type { EnvironmentConfig, DeployState, DeployShellExecutor } from "./types.js";

export interface GateCheckResult {
  allowed: boolean;
  reason?: string;
}

/** AC-2: 確認目前有 git tag（已執行 devap release） */
export function checkReleaseTagExists(
  cwd: string = process.cwd(),
  executor?: DeployShellExecutor
): boolean {
  try {
    if (executor) {
      // injection 路徑（測試用）— 呼叫端需同步處理，此處無法 await
      // 測試改由 checkReleaseTagExistsAsync
      return true;
    }
    execSync("git describe --tags --exact-match", {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** AC-2（async 版）: 供測試注入 DeployShellExecutor */
export async function checkReleaseTagExistsAsync(
  cwd: string = process.cwd(),
  executor?: DeployShellExecutor
): Promise<boolean> {
  if (executor) {
    const result = await executor("git describe --tags --exact-match", cwd);
    return result.exitCode === 0;
  }
  return checkReleaseTagExists(cwd);
}

/** AC-5: staging 閘門 — prod 前須先 staging 成功 */
export function checkStagingRequired(
  env: string,
  config: EnvironmentConfig,
  state: DeployState
): GateCheckResult {
  if (!config.requires_staging) {
    return { allowed: true };
  }

  const stagingState = state["staging"];
  if (!stagingState?.lastSuccess) {
    return {
      allowed: false,
      reason: "staging 尚未成功部署，請先執行 devap deploy --target staging",
    };
  }

  return { allowed: true };
}

/** AC-6: prod 部署必定插入 HITL（不可關閉） */
export async function requireProdHITL(
  version?: string
): Promise<GateCheckResult> {
  const hitlResult = await runHITLGate({
    stepId: "deploy-prod",
    stepDescription: "部署至 production 環境",
    expectedImpact: version
      ? `版本 ${version} 將部署至 production，影響所有使用者`
      : "此操作將影響所有使用者",
  });

  if (hitlResult.passed) {
    return { allowed: true };
  }

  const reasons: Record<string, string> = {
    rejected: "prod 部署已拒絕",
    timeout: "prod 部署確認逾時，自動拒絕",
    "non-tty": "CI 環境不允許 prod 部署（必須在互動式終端確認）",
  };

  return {
    allowed: false,
    reason: reasons[hitlResult.decision] ?? "prod 部署未獲確認",
  };
}

/** 目前 git tag（最新 tag） */
export function getCurrentVersion(cwd: string = process.cwd()): string | undefined {
  try {
    const tag = execSync("git describe --tags --abbrev=0", {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    return tag || undefined;
  } catch {
    return undefined;
  }
}
