/**
 * DeployRunner — 執行部署流程（XSPEC-093）
 *
 * AC-1: 讀取 environments config，執行 deploy 命令
 * AC-3: cloudflare-workers → wrangler deploy
 * AC-4: docker-compose → docker compose up -d
 * AC-7: 健康檢查 + rollback
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  checkReleaseTagExistsAsync,
  checkStagingRequired,
  requireProdHITL,
  getCurrentVersion,
} from "./environment-gate.js";
import type {
  DeployConfig,
  DeployState,
  DeployResult,
  HealthCheckResult,
  DeployShellExecutor,
  DeployHttpChecker,
  DeployCommandResult,
} from "./types.js";

const execAsync = promisify(exec);

/** 預設 shell 執行器（生產環境） */
async function defaultDeployShellExecutor(
  command: string,
  cwd?: string
): Promise<DeployCommandResult> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      exitCode: e.code ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

/** 預設 HTTP 健康檢查器 */
async function defaultDeployHttpChecker(url: string): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** 延遲 ms 毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** AC-7: 健康檢查（含 retry） */
async function runHealthCheck(
  url: string,
  maxRetries: number,
  checker: DeployHttpChecker,
  delayMs = 2000
): Promise<HealthCheckResult> {
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { ok, status } = await checker(url);
      lastStatus = status;
      if (ok) {
        return { passed: true, attempts: attempt, statusCode: status };
      }
    } catch (err) {
      lastError = (err as Error).message;
    }

    if (attempt < maxRetries) {
      await sleep(delayMs);
    }
  }

  return {
    passed: false,
    attempts: maxRetries,
    statusCode: lastStatus,
    error: lastError ?? `健康檢查失敗（HTTP ${lastStatus ?? "無回應"}）`,
  };
}

export interface DeployRunnerOptions {
  config: DeployConfig;
  state: DeployState;
  cwd?: string;
  /** 測試用：覆蓋 shell 執行器 */
  shellExecutor?: DeployShellExecutor;
  /** 測試用：覆蓋 HTTP 健康檢查器 */
  httpChecker?: DeployHttpChecker;
  /** 測試用：跳過 git tag 檢查 */
  skipTagCheck?: boolean;
  /** 測試用：提供版本字串（取代 git describe） */
  version?: string;
  /** 健康檢查重試間隔 ms，預設 2000（測試設為 0 加速）*/
  healthCheckDelayMs?: number;
}

export class DeployRunner {
  private readonly executor: DeployShellExecutor;
  private readonly checker: DeployHttpChecker;

  constructor(private readonly opts: DeployRunnerOptions) {
    this.executor = opts.shellExecutor ?? defaultDeployShellExecutor;
    this.checker = opts.httpChecker ?? defaultDeployHttpChecker;
  }

  async deploy(targetEnv: string): Promise<DeployResult> {
    const { config, state, cwd = process.cwd() } = this.opts;

    // AC-1: 環境設定存在
    const envConfig = config.environments[targetEnv];
    if (!envConfig) {
      return {
        success: false,
        environment: targetEnv,
        output: "",
        error: `環境 "${targetEnv}" 未在 devap.config.json 的 environments 中設定`,
      };
    }

    // AC-2: 必須有 git tag（已執行 devap release）
    if (!this.opts.skipTagCheck) {
      const hasTag = await checkReleaseTagExistsAsync(cwd, this.executor);
      if (!hasTag) {
        return {
          success: false,
          environment: targetEnv,
          output: "",
          error: "請先執行 devap release 建立版本標籤，再執行 deploy",
        };
      }
    }

    // AC-5: staging 先行閘門
    const stagingGate = checkStagingRequired(targetEnv, envConfig, state);
    if (!stagingGate.allowed) {
      return {
        success: false,
        environment: targetEnv,
        output: "",
        error: stagingGate.reason,
      };
    }

    // AC-6: prod 必定 HITL
    if (targetEnv === "prod") {
      const version = this.opts.version ?? getCurrentVersion(cwd);
      const hitlGate = await requireProdHITL(version);
      if (!hitlGate.allowed) {
        return {
          success: false,
          environment: targetEnv,
          output: "",
          error: hitlGate.reason,
        };
      }
    }

    // AC-3/AC-4: 執行 deploy 命令
    console.log(`🚀 部署至 ${targetEnv}（${envConfig.type}）...`);
    console.log(`  命令：${envConfig.command}`);

    const cmdResult = await this.executor(envConfig.command, cwd);
    const output = cmdResult.stdout + (cmdResult.stderr ? `\n[stderr] ${cmdResult.stderr}` : "");

    if (cmdResult.exitCode !== 0) {
      return {
        success: false,
        environment: targetEnv,
        output,
        error: `部署命令失敗（exit ${cmdResult.exitCode}）：${cmdResult.stderr}`,
      };
    }

    console.log(`✅ ${targetEnv} 部署命令完成`);

    // AC-7: 健康檢查
    let healthCheck: HealthCheckResult | undefined;
    if (envConfig.health_check) {
      const retries = envConfig.health_check_retries ?? 3;
      console.log(`🔍 健康檢查：${envConfig.health_check}（最多 ${retries} 次）`);
      healthCheck = await runHealthCheck(
        envConfig.health_check,
        retries,
        this.checker,
        this.opts.healthCheckDelayMs ?? 2000
      );

      if (!healthCheck.passed) {
        console.error(
          `❌ 健康檢查失敗（${healthCheck.attempts} 次重試），嘗試 rollback...`
        );

        // AC-7: rollback
        if (envConfig.rollback_command) {
          const rbResult = await this.executor(envConfig.rollback_command, cwd);
          const rolledBack = rbResult.exitCode === 0;
          console.log(rolledBack ? "↩️  Rollback 完成" : "⚠️  Rollback 失敗");

          return {
            success: false,
            environment: targetEnv,
            output,
            error: `健康檢查失敗（${healthCheck.error}）`,
            healthCheck,
            rolledBack,
            rollbackError: rolledBack ? undefined : rbResult.stderr,
          };
        }

        return {
          success: false,
          environment: targetEnv,
          output,
          error: `健康檢查失敗（${healthCheck.error}）`,
          healthCheck,
        };
      }

      console.log(
        `✅ 健康檢查通過（第 ${healthCheck.attempts} 次，HTTP ${healthCheck.statusCode}）`
      );
    }

    return {
      success: true,
      environment: targetEnv,
      output,
      healthCheck,
    };
  }
}
