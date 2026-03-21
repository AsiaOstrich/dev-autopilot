/**
 * @devap/adapter-vibeops — VibeOps 7+1 Agent Adapter
 *
 * 透過 HTTP API 整合 VibeOps，讓 DevAP 編排 VibeOps Pipeline。
 * 維持 MIT 授權，不引入 AGPL 依賴。
 */

export { VibeOpsAdapter } from "./vibeops-adapter.js";
export { mapSpecToAgent, ALL_AGENTS } from "./agent-mapper.js";
export type {
  VibeOpsAdapterConfig,
  VibeOpsAgentName,
  VibeOpsPipelineOptions,
  VibeOpsHealthResponse,
  VibeOpsTaskRequest,
  VibeOpsTaskResponse,
} from "./types.js";
