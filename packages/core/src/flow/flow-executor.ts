/**
 * FlowExecutor — 依照 FlowDefinition 依序執行步驟（XSPEC-087 AC-2）
 *
 * 職責：
 * - 依 requires 依賴順序執行步驟
 * - 遇到 gate 步驟時呼叫 GateHandler
 * - dryRun 模式只列出步驟，不執行
 * - gate SUSPENDED 時停止後續步驟
 */

import type { FlowDefinition, FlowExecutionContext, FlowStepResult } from "../types.js";
import { GateHandler } from "./gate-handler.js";

/** 步驟處理函式 map：stepId → 執行函式（回傳輸出文字） */
export type StepHandlerMap = Map<string, () => Promise<string>>;

export class FlowExecutor {
  constructor(private readonly flow: FlowDefinition) {}

  /**
   * 執行流程，回傳每個步驟的結果。
   *
   * @param context - 執行情境（變數 + dryRun 模式）
   * @param stepHandlers - 各步驟的執行函式（不需涵蓋所有步驟）
   * @returns FlowStepResult[]（按步驟宣告順序）
   */
  async execute(context: FlowExecutionContext, stepHandlers: StepHandlerMap): Promise<FlowStepResult[]> {
    const results: FlowStepResult[] = [];
    const completedIds = new Set<string>();

    for (const step of this.flow.steps) {
      // 依賴檢查：requires 中有任一步驟未完成 → 跳過
      if (step.requires && step.requires.length > 0) {
        const unmet = step.requires.filter((id) => !completedIds.has(id));
        if (unmet.length > 0) {
          results.push({
            stepId: step.id,
            status: "skipped",
            error: `依賴步驟未完成：${unmet.join(", ")}`,
          });
          continue;
        }
      }

      // dryRun 模式：不執行，僅標記 skipped
      if (context.dryRun) {
        results.push({ stepId: step.id, status: "skipped" });
        completedIds.add(step.id);
        continue;
      }

      // gate 步驟：交由 GateHandler 處理
      if (step.type === "gate") {
        const gateResult = await GateHandler.handle(step);

        if (gateResult.suspended) {
          results.push({ stepId: step.id, status: "suspended" });
          break; // gate 暫停 → 停止後續步驟
        }

        results.push({ stepId: step.id, status: "completed" });
        completedIds.add(step.id);
        continue;
      }

      // 一般步驟：呼叫對應 handler（若有）
      const handler = stepHandlers.get(step.id);
      if (handler) {
        try {
          const output = await handler();
          results.push({ stepId: step.id, status: "completed", output });
        } catch (e) {
          results.push({
            stepId: step.id,
            status: "failed",
            error: (e as Error).message,
          });
          break; // 步驟失敗 → 停止後續步驟
        }
      } else {
        results.push({ stepId: step.id, status: "completed" });
      }
      completedIds.add(step.id);
    }

    return results;
  }
}
