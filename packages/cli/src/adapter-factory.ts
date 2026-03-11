/**
 * Adapter 工廠函式
 *
 * 根據 agent 類型建立對應的 AgentAdapter 實例。
 * 從 index.ts 抽出以便獨立測試。
 */

import type { AgentAdapter } from "@devap/core";
import { ClaudeAdapter } from "@devap/adapter-claude";
import { OpenCodeAdapter } from "@devap/adapter-opencode";
import { CliAdapter } from "@devap/adapter-cli";

/**
 * 根據 agent 類型建立對應的 adapter
 *
 * @param agentType - agent 類型名稱
 * @returns 對應的 AgentAdapter 實例
 * @throws 若 agentType 不支援
 */
export function createAdapter(agentType: string): AgentAdapter {
  switch (agentType) {
    case "claude":
      return new ClaudeAdapter();
    case "opencode":
      return new OpenCodeAdapter();
    case "cli":
      return new CliAdapter();
    default:
      throw new Error(`不支援的 agent 類型：${agentType}`);
  }
}
