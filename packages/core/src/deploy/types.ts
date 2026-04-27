/**
 * Deploy 原語型別定義（XSPEC-093）
 */

export type DeployTargetType = "cloudflare-workers" | "docker-compose";

export interface EnvironmentConfig {
  type: DeployTargetType;
  /** 執行部署的 shell 命令 */
  command: string;
  /** 健康檢查 URL（AC-7）*/
  health_check?: string;
  /** 健康檢查最大重試次數，預設 3 */
  health_check_retries?: number;
  /** 健康檢查失敗時的 rollback 命令 */
  rollback_command?: string;
  /** prod 環境專用：deploy 前必須確認 staging 已成功（AC-5）*/
  requires_staging?: boolean;
}

export interface DeployConfig {
  environments: Record<string, EnvironmentConfig>;
}

export interface DeployState {
  [env: string]: {
    lastSuccess: string; // ISO timestamp
    version?: string;   // git tag
  };
}

export interface DeployCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HealthCheckResult {
  passed: boolean;
  attempts: number;
  statusCode?: number;
  error?: string;
}

export interface DeployResult {
  success: boolean;
  environment: string;
  output: string;
  error?: string;
  healthCheck?: HealthCheckResult;
  rolledBack?: boolean;
  rollbackError?: string;
}

/** 可注入的 shell 執行器（用於測試 mock）*/
export type DeployShellExecutor = (
  command: string,
  cwd?: string
) => Promise<DeployCommandResult>;

/** 可注入的 HTTP 健康檢查器（用於測試 mock）*/
export type DeployHttpChecker = (url: string) => Promise<{ ok: boolean; status: number }>;
