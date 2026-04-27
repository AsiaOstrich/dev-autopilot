/**
 * GateHandler — 處理 FlowStep gate 行為（XSPEC-087 AC-5）
 *
 * 支援閘門類型：
 * - HUMAN_CONFIRM：暫停等待使用者輸入 y/n
 * - AUTO_PASS：自動通過（CI/測試用）
 * - POLICY_CHECK：政策檢查（未來擴充）
 */

import type { FlowStep, GateResult } from "../types.js";

export class GateHandler {
  /**
   * 處理閘門步驟。
   *
   * @param step - 閘門步驟定義（type 必須為 'gate'）
   * @param userInput - 使用者輸入（undefined 表示尚未輸入 → 回傳 SUSPENDED）
   * @returns GateResult
   */
  static async handle(step: FlowStep, userInput?: string): Promise<GateResult> {
    if (step.type !== "gate") {
      throw new Error(`GateHandler: 步驟 '${step.id}' 不是 gate 類型`);
    }

    switch (step.gate) {
      case "HUMAN_CONFIRM":
        return GateHandler.handleHumanConfirm(step, userInput);

      case "AUTO_PASS":
        return { status: "PASSED", suspended: false, promptDisplayed: false };

      case "POLICY_CHECK":
        throw new Error("GateHandler: POLICY_CHECK 尚未實作");

      default:
        throw new Error(`GateHandler: 未知閘門類型 '${step.gate}'`);
    }
  }

  private static handleHumanConfirm(step: FlowStep, userInput?: string): GateResult {
    // 尚未收到使用者輸入 → 暫停並顯示提示
    if (userInput === undefined) {
      return {
        status: "SUSPENDED",
        suspended: true,
        promptDisplayed: true,
      };
    }

    const confirmed = userInput.trim().toLowerCase() === "y";

    if (confirmed) {
      return {
        status: "PASSED",
        suspended: false,
        promptDisplayed: true,
      };
    }

    // 使用者拒絕 → 跳轉至 on_reject 步驟（若有設定）
    return {
      status: "REJECTED",
      suspended: false,
      nextStepId: step.on_reject,
      promptDisplayed: true,
    };
  }
}
