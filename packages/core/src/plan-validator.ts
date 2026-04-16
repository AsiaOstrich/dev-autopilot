/**
 * Task Plan 驗證器
 *
 * 使用 specs/task-schema.json 驗證 task plan 的格式正確性，
 * 並額外檢查依賴圖的合法性（無循環、參照存在）。
 */

import _Ajv from "ajv";
import type { TaskPlan, ValidationResult } from "./types.js";
import { detectDangerousCommand } from "./safety-hook.js";

// ajv v8 是 CJS，在 ESM + NodeNext 下 default import 為 namespace
const Ajv = _Ajv.default ?? _Ajv;

/** JSON Schema for task plan */
const taskSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DevAutopilot Task Plan",
  type: "object",
  required: ["project", "tasks"],
  properties: {
    project: { type: "string", description: "Project name or path" },
    session_id: { type: "string", description: "Session ID from planning phase (optional)" },
    agent: {
      type: "string",
      enum: ["claude", "opencode", "codex", "cline", "cursor", "cli"],
      description: "Default agent for execution",
    },
    defaults: {
      type: "object",
      properties: {
        max_turns: { type: "integer", default: 30 },
        max_budget_usd: { type: "number", default: 2.0 },
        allowed_tools: { type: "array", items: { type: "string" } },
        verify_command: { type: "string" },
        test_levels: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "command"],
            properties: {
              name: { type: "string", enum: ["unit", "integration", "system", "e2e"] },
              command: { type: "string" },
              timeout_ms: { type: "integer", minimum: 1000, default: 120000 },
            },
          },
        },
      },
    },
    test_policy: {
      type: "object",
      properties: {
        pyramid_ratio: {
          type: "object",
          properties: {
            unit: { type: "number" },
            integration: { type: "number" },
            system: { type: "number" },
            e2e: { type: "number" },
          },
        },
        completion_criteria: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "required"],
            properties: {
              name: { type: "string" },
              command: { type: "string" },
              required: { type: "boolean" },
            },
          },
        },
        static_analysis_command: { type: "string" },
      },
    },
    max_parallel: {
      type: "integer",
      minimum: 1,
      description: "Maximum number of parallel tasks",
    },
    tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "title", "spec"],
        properties: {
          id: { type: "string", pattern: "^T-[0-9]{3}$" },
          title: { type: "string" },
          spec: { type: "string" },
          depends_on: { type: "array", items: { type: "string" }, default: [] },
          agent: {
            type: "string",
            enum: ["claude", "opencode", "codex", "cline", "cursor", "cli"],
          },
          verify_command: { type: "string" },
          max_turns: { type: "integer" },
          max_budget_usd: { type: "number" },
          allowed_tools: { type: "array", items: { type: "string" } },
          fork_session: { type: "boolean", default: true },
          judge: { type: "boolean", description: "Enable Judge Agent review for this task" },
          acceptance_criteria: {
            type: "array",
            items: { type: "string" },
            description: "Acceptance criteria list",
          },
          user_intent: { type: "string", description: "Why this task is needed" },
          test_levels: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "command"],
              properties: {
                name: { type: "string", enum: ["unit", "integration", "system", "e2e"] },
                command: { type: "string" },
                timeout_ms: { type: "integer", minimum: 1000, default: 120000 },
              },
            },
          },
          activationPredicate: {
            type: "object",
            required: ["type", "description"],
            properties: {
              type: { type: "string", enum: ["threshold", "state_flag", "custom"] },
              description: { type: "string", minLength: 1 },
              metric: { type: "string" },
              operator: { type: "string", enum: [">", "<", ">=", "<=", "=="] },
              value: { type: "number" },
              taskId: { type: "string" },
              expectedStatus: {
                type: "string",
                enum: ["success", "failed", "skipped", "timeout", "done_with_concerns", "needs_context", "blocked"],
              },
              command: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(taskSchema);

/**
 * 驗證 task plan 的格式與邏輯正確性
 *
 * 驗證項目：
 * 1. JSON Schema 格式驗證
 * 2. Task ID 唯一性
 * 3. 依賴參照存在性
 * 4. 依賴圖無循環（DAG 驗證）
 *
 * @param plan - 要驗證的 task plan
 * @returns 驗證結果
 */
export function validatePlan(plan: unknown): ValidationResult {
  const errors: string[] = [];

  // 1. JSON Schema 驗證
  const schemaValid = validate(plan);
  if (!schemaValid) {
    for (const err of validate.errors ?? []) {
      errors.push(`Schema: ${err.instancePath} ${err.message}`);
    }
    return { valid: false, errors };
  }

  const taskPlan = plan as TaskPlan;

  // 2. Task ID 唯一性
  const ids = new Set<string>();
  for (const task of taskPlan.tasks) {
    if (ids.has(task.id)) {
      errors.push(`重複的 Task ID: ${task.id}`);
    }
    ids.add(task.id);
  }

  // 3. 依賴參照存在性
  for (const task of taskPlan.tasks) {
    for (const dep of task.depends_on ?? []) {
      if (!ids.has(dep)) {
        errors.push(`Task ${task.id} 依賴不存在的 Task: ${dep}`);
      }
    }
  }

  // 4. DAG 循環檢測
  const cycleError = detectCycle(taskPlan.tasks);
  if (cycleError) {
    errors.push(cycleError);
  }

  // 5. ActivationPredicate 語義驗證（DEC-011）
  for (const task of taskPlan.tasks) {
    if (!task.activationPredicate) continue;
    const pred = task.activationPredicate;

    if (pred.type === "threshold") {
      if (!pred.metric || !pred.operator || pred.value === undefined) {
        errors.push(
          `Task ${task.id}: activationPredicate threshold 類型必須同時提供 metric、operator、value`,
        );
      }
    }

    if (pred.type === "state_flag") {
      if (!pred.taskId) {
        errors.push(
          `Task ${task.id}: activationPredicate state_flag 類型必須提供 taskId`,
        );
      } else if (!ids.has(pred.taskId)) {
        errors.push(
          `Task ${task.id}: activationPredicate 引用不存在的 Task: ${pred.taskId}`,
        );
      }
    }

    if (pred.type === "custom") {
      if (!pred.command) {
        errors.push(
          `Task ${task.id}: activationPredicate custom 類型必須提供 command`,
        );
      } else {
        const danger = detectDangerousCommand(pred.command);
        if (danger) {
          errors.push(
            `Task ${task.id}: activationPredicate ${danger}`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 檢測依賴圖中的循環
 *
 * 使用 DFS（深度優先搜尋）偵測有向圖中的環。
 *
 * @param tasks - 任務列表
 * @returns 循環錯誤訊息，無循環時回傳 null
 */
function detectCycle(tasks: TaskPlan["tasks"]): string | null {
  const adj = new Map<string, ReadonlyArray<string>>();
  for (const task of tasks) {
    adj.set(task.id, task.depends_on ?? []);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): string | null {
    visited.add(nodeId);
    inStack.add(nodeId);

    for (const dep of adj.get(nodeId) ?? []) {
      if (!visited.has(dep)) {
        const result = dfs(dep);
        if (result) return result;
      } else if (inStack.has(dep)) {
        return `依賴圖存在循環：${nodeId} → ${dep}`;
      }
    }

    inStack.delete(nodeId);
    return null;
  }

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      const result = dfs(task.id);
      if (result) return result;
    }
  }

  return null;
}
