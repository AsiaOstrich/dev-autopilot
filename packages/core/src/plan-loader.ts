/**
 * Plan Loader（XSPEC-057）
 *
 * 支援單計劃（TaskPlan）與多計劃（MultiPlanFile）兩種格式。
 * 提供 loadPlan() 統一入口，並根據 planName 選擇正確的計劃。
 */

import { readFile } from "node:fs/promises";
import { load as parseYaml } from "js-yaml";
import type { TaskPlan, PlanFile, MultiPlanFile } from "./types.js";
import { isMultiPlanFile } from "./types.js";

/**
 * 找不到指定計劃時拋出
 */
export class PlanNotFoundError extends Error {
  constructor(
    public readonly requestedPlan: string,
    public readonly availablePlans: string[],
  ) {
    super(
      `Plan "${requestedPlan}" 不存在。可用的計劃：${availablePlans.join(", ")}`,
    );
    this.name = "PlanNotFoundError";
  }
}

/**
 * 多計劃格式但未指定 --plan 且無 default_plan 時拋出
 */
export class MultiPlanFileRequiresPlanFlagError extends Error {
  constructor(public readonly availablePlans: string[]) {
    super(
      `此檔案包含多份計劃但未指定 --plan，請加上 --plan <name>。` +
        `\n可用的計劃：${availablePlans.join(", ")}`,
    );
    this.name = "MultiPlanFileRequiresPlanFlagError";
  }
}

/**
 * 從檔案讀取並解析 PlanFile（支援 JSON 與 YAML）
 */
async function parsePlanFile(filePath: string): Promise<PlanFile> {
  const content = await readFile(filePath, "utf-8");
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return parseYaml(content) as PlanFile;
  }
  return JSON.parse(content) as PlanFile;
}

/**
 * 合併 defaults 與具名計劃（plan 設定優先）
 */
function mergeWithDefaults(
  plan: TaskPlan,
  defaults: Partial<TaskPlan> | undefined,
): TaskPlan {
  if (!defaults) return plan;
  return { ...defaults, ...plan } as TaskPlan;
}

/**
 * 載入 plan 檔案並回傳最終 TaskPlan
 *
 * 流程：
 * 1. 解析檔案（JSON / YAML）
 * 2. 判斷格式：TaskPlan 或 MultiPlanFile
 * 3. 若為 MultiPlanFile，根據 planName 或 default_plan 選擇計劃
 * 4. 合併 defaults 後回傳標準 TaskPlan
 *
 * @param filePath  plan 檔案路徑
 * @param planName  --plan <name>（多計劃格式必填，單計劃格式忽略）
 * @returns `{ plan, planName }` — planName 為 undefined 代表單計劃格式
 */
export async function loadPlan(
  filePath: string,
  planName?: string,
): Promise<{ plan: TaskPlan; planName: string | undefined }> {
  const raw = await parsePlanFile(filePath);

  if (!isMultiPlanFile(raw)) {
    // 單計劃格式：向後相容，直接回傳
    return { plan: raw, planName: undefined };
  }

  const multiPlan = raw as MultiPlanFile;
  const availablePlans = Object.keys(multiPlan.plans);

  // 決定使用哪份計劃
  const selectedName = planName ?? multiPlan.default_plan;

  if (!selectedName) {
    throw new MultiPlanFileRequiresPlanFlagError(availablePlans);
  }

  const selectedPlan = multiPlan.plans[selectedName];
  if (!selectedPlan) {
    throw new PlanNotFoundError(selectedName, availablePlans);
  }

  const merged = mergeWithDefaults(selectedPlan, multiPlan.defaults);
  return { plan: merged, planName: selectedName };
}

/**
 * 讀取 MultiPlanFile 並回傳所有計劃名稱（用於 --list-plans）
 *
 * 若為單計劃格式，回傳 null（表示無具名計劃）。
 */
export async function listPlans(
  filePath: string,
): Promise<Array<{
  name: string;
  isDefault: boolean;
  taskCount: number;
  quality: string | undefined;
}> | null> {
  const raw = await parsePlanFile(filePath);

  if (!isMultiPlanFile(raw)) {
    return null;
  }

  const multiPlan = raw as MultiPlanFile;
  return Object.entries(multiPlan.plans).map(([name, plan]) => ({
    name,
    isDefault: name === multiPlan.default_plan,
    taskCount: plan.tasks?.length ?? 0,
    quality: typeof plan.quality === "string" ? plan.quality : undefined,
  }));
}
