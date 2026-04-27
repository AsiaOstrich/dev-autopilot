/**
 * FlowParser — 解析 .devap/flows/*.flow.yaml → FlowDefinition（XSPEC-087）
 *
 * 職責：YAML 反序列化 + 結構驗證，不執行任何副作用。
 */

import yaml from "js-yaml";
import type { FlowDefinition, FlowStep } from "../types.js";

const VALID_STEP_TYPES = new Set(["ai-task", "shell", "gate", "platform-adapter"]);
const VALID_GATE_TYPES = new Set(["HUMAN_CONFIRM", "AUTO_PASS", "POLICY_CHECK"]);

export class FlowParser {
  /**
   * 解析 YAML 字串為 FlowDefinition。
   * @throws Error 若格式不合規格
   */
  static parse(yamlContent: string): FlowDefinition {
    let raw: unknown;
    try {
      raw = yaml.load(yamlContent);
    } catch (e) {
      throw new Error(`FlowParser: YAML 解析失敗 — ${(e as Error).message}`);
    }

    if (!raw || typeof raw !== "object") {
      throw new Error("FlowParser: 頂層結構必須是 YAML 物件");
    }

    const obj = raw as Record<string, unknown>;

    if (typeof obj["name"] !== "string" || obj["name"].trim() === "") {
      throw new Error("FlowParser: 缺少必填欄位 'name'（string）");
    }

    if (!Array.isArray(obj["steps"])) {
      throw new Error("FlowParser: 缺少必填欄位 'steps'（array）");
    }

    const steps: FlowStep[] = (obj["steps"] as unknown[]).map((s, i) => {
      if (!s || typeof s !== "object") {
        throw new Error(`FlowParser: steps[${i}] 必須是物件`);
      }
      const step = s as Record<string, unknown>;

      if (typeof step["id"] !== "string" || step["id"].trim() === "") {
        throw new Error(`FlowParser: steps[${i}] 缺少必填欄位 'id'`);
      }
      if (!VALID_STEP_TYPES.has(step["type"] as string)) {
        throw new Error(
          `FlowParser: steps[${i}].type 無效（收到 '${step["type"]}'，允許：${[...VALID_STEP_TYPES].join(", ")}）`
        );
      }
      if (step["type"] === "gate") {
        if (!VALID_GATE_TYPES.has(step["gate"] as string)) {
          throw new Error(
            `FlowParser: steps[${i}].gate 無效（收到 '${step["gate"]}'，允許：${[...VALID_GATE_TYPES].join(", ")}）`
          );
        }
      }

      return step as unknown as FlowStep;
    });

    return {
      name: obj["name"] as string,
      description: typeof obj["description"] === "string" ? obj["description"] : undefined,
      steps,
    };
  }
}
