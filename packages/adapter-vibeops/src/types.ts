/**
 * VibeOps Adapter 型別定義
 *
 * 注意：所有型別僅透過 HTTP API 通訊，不 import VibeOps 程式碼，
 * 確保 MIT 授權隔離（VibeOps 為 AGPL-3.0）。
 */

/**
 * VibeOps Adapter 設定
 */
export interface VibeOpsAdapterConfig {
  /** VibeOps API 基礎 URL */
  baseUrl: string;
  /** API Token（若啟用認證） */
  apiToken?: string;
  /** 預設 pipeline 選項 */
  pipelineOptions?: VibeOpsPipelineOptions;
}

/**
 * Pipeline 選項
 */
export interface VibeOpsPipelineOptions {
  /** 跳過 checkpoint 確認 */
  skipCheckpoints?: boolean;
  /** 在指定 agent 後停止 */
  stopAfter?: VibeOpsAgentName;
}

/**
 * VibeOps 7+1 Agent 名稱
 */
export type VibeOpsAgentName =
  | "planner"
  | "architect"
  | "designer"
  | "uiux"
  | "builder"
  | "reviewer"
  | "operator"
  | "evaluator";

/**
 * VibeOps API 健康檢查回應
 */
export interface VibeOpsHealthResponse {
  status: "ok" | "error";
  version?: string;
}

/**
 * VibeOps 任務提交請求
 */
export interface VibeOpsTaskRequest {
  agent: VibeOpsAgentName;
  spec: string;
  taskId: string;
  sessionId?: string;
  pipelineOptions?: VibeOpsPipelineOptions;
}

/**
 * VibeOps 任務結果回應
 */
export interface VibeOpsTaskResponse {
  sessionId: string;
  status: "success" | "failed" | "timeout";
  costUsd: number;
  durationMs: number;
  result?: string;
  reviewerPassed?: boolean;
  guardianIssues?: string[];
}
