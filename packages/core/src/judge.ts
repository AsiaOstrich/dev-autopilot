/**
 * Judge Agent — AI 審查 AI
 *
 * 在任務完成後啟動獨立的 `claude -p` 子進程進行審查。
 * Judge 會檢查 task spec、git diff、verify_command 結果，
 * 輸出 APPROVE 或 REJECT + 理由。
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { JudgePolicy, Task, TaskResult } from "./types.js";

const execFileAsync = promisify(execFile);

/** Judge 判決結果 */
export type JudgeVerdict = "APPROVE" | "REJECT";

/**
 * 單條 acceptance criteria 的審查結果
 */
export interface CriteriaResult {
  /** 驗收條件原文 */
  criteria: string;
  /** 是否通過 */
  passed: boolean;
  /** 判定理由 */
  reasoning: string;
}

/** Judge 審查結果 */
export interface JudgeResult {
  /** 判決 */
  verdict: JudgeVerdict;
  /** 理由說明 */
  reasoning: string;
  /** Judge session ID */
  session_id?: string;
  /** 審查成本 */
  cost_usd?: number;
  /** 各條 acceptance criteria 的逐條審查結果 */
  criteria_results?: CriteriaResult[];
  /** 使用者意圖達成度評估 */
  intent_assessment?: string;
}

/**
 * Judge Agent 選項
 */
export interface JudgeOptions {
  /** 工作目錄 */
  cwd: string;
  /** 進度回呼 */
  onProgress?: (message: string) => void;
  /** Judge 的 max_turns 限制（預設 10） */
  maxTurns?: number;
}

/**
 * 判斷是否需要執行 Judge 審查
 *
 * 根據 JudgePolicy 和 task 狀態決定：
 * - always: 永遠審查
 * - on_change: 有 git diff 時才審查（由呼叫者提供 hasChanges）
 * - never: 永不審查
 *
 * @param policy - Judge 策略
 * @param task - 任務定義
 * @param hasChanges - 是否有程式碼變更
 * @returns 是否需要執行 Judge
 */
export function shouldRunJudge(
  policy: JudgePolicy,
  task: Task,
  hasChanges: boolean,
): boolean {
  // task 層級的 judge: false 明確關閉時，尊重它
  if (task.judge === false) {
    return false;
  }

  switch (policy) {
    case "always":
      return true;
    case "on_change":
      return hasChanges;
    case "never":
      // never 模式下，仍允許 task 層級 judge: true 覆寫
      return task.judge === true;
  }
}

/**
 * 執行 Judge 審查
 *
 * 啟動一個獨立的 `claude -p` 子進程，提供：
 * - 原始 task spec
 * - git diff（已完成的變更）
 * - verify_command 結果
 *
 * Judge 需輸出 JSON 格式的判決。
 *
 * @param task - 已完成的任務
 * @param taskResult - 任務執行結果
 * @param options - Judge 選項
 * @returns Judge 審查結果
 */
export async function runJudge(
  task: Task,
  taskResult: TaskResult,
  options: JudgeOptions,
): Promise<JudgeResult> {
  options.onProgress?.(`[${task.id}] 啟動 Judge 審查`);

  try {
    // 取得 git diff
    const diff = await getGitDiff(options.cwd);

    // 如果有 verify_command，取得其結果
    let verifyResult = "";
    if (task.verify_command) {
      verifyResult = await runVerifyCommand(task.verify_command, options.cwd);
    }

    // 構建 Judge prompt
    const prompt = buildJudgePrompt(task, taskResult, diff, verifyResult);

    // 啟動 Judge 子進程
    const result = await spawnJudge(prompt, options);

    options.onProgress?.(`[${task.id}] Judge 判決：${result.verdict}`);
    return result;
  } catch (error) {
    options.onProgress?.(`[${task.id}] Judge 審查失敗：${error instanceof Error ? error.message : error}`);
    // Judge 失敗時預設 APPROVE，避免阻塞流程
    return {
      verdict: "APPROVE",
      reasoning: `Judge 審查過程發生錯誤，預設通過：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 取得工作目錄的 git diff
 */
async function getGitDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "HEAD~1"], { cwd });
    return stdout || "(無差異)";
  } catch {
    return "(無法取得 git diff)";
  }
}

/**
 * 執行驗證指令
 */
async function runVerifyCommand(command: string, cwd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
      cwd,
      timeout: 60_000,
    });
    return `Exit code: 0\nStdout:\n${stdout}\nStderr:\n${stderr}`;
  } catch (error: unknown) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return `Exit code: ${err.code ?? "unknown"}\nStdout:\n${err.stdout ?? ""}\nStderr:\n${err.stderr ?? ""}`;
  }
}

/**
 * 構建 Judge prompt
 *
 * 若 task 含 acceptance_criteria 或 user_intent，注入到 prompt 中，
 * 要求 Judge 逐條判定 criteria 並評估意圖達成度。
 */
export function buildJudgePrompt(
  task: Task,
  taskResult: TaskResult,
  diff: string,
  verifyResult: string,
): string {
  const hasCriteria = task.acceptance_criteria && task.acceptance_criteria.length > 0;
  const hasIntent = !!task.user_intent;

  // 驗收條件區段
  let criteriaSection = "";
  if (hasCriteria) {
    criteriaSection = `\n## 驗收條件\n${task.acceptance_criteria!.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n`;
  }

  // 使用者意圖區段
  let intentSection = "";
  if (hasIntent) {
    intentSection = `\n## 使用者意圖\n${task.user_intent}\n`;
  }

  // JSON 格式要求（依據是否有 criteria/intent 調整）
  let jsonFormat: string;
  if (hasCriteria) {
    jsonFormat = `{
  "verdict": "APPROVE" 或 "REJECT",
  "reasoning": "你的判決理由",
  "criteria_results": [
    { "criteria": "驗收條件原文", "passed": true/false, "reasoning": "判定理由" }
  ]${hasIntent ? ',\n  "intent_assessment": "使用者意圖達成度評估"' : ""}
}`;
  } else {
    jsonFormat = `{
  "verdict": "APPROVE" 或 "REJECT",
  "reasoning": "你的判決理由"${hasIntent ? ',\n  "intent_assessment": "使用者意圖達成度評估"' : ""}
}`;
  }

  // 判斷標準
  const judgingCriteria = [
    "1. 程式碼變更是否符合任務規格的要求？",
    "2. 驗證指令是否通過？",
    "3. 是否有明顯的錯誤或遺漏？",
    "4. 是否有不必要的變更？",
  ];
  if (hasCriteria) {
    judgingCriteria.push("5. 每條驗收條件是否都被滿足？請逐條判定。");
  }
  if (hasIntent) {
    judgingCriteria.push(`${hasCriteria ? "6" : "5"}. 實作是否真正解決了使用者的問題（意圖達成度）？`);
  }

  return `你是一個嚴格的 Code Review Judge。請審查以下任務的執行結果。

## 原始任務規格

### ${task.id}: ${task.title}
${task.spec}

${task.verify_command ? `### 驗證指令\n\`${task.verify_command}\`` : ""}
${criteriaSection}${intentSection}
## 執行結果摘要
- 狀態: ${taskResult.status}
- 耗時: ${taskResult.duration_ms}ms
- 成本: $${taskResult.cost_usd ?? 0}

## Git Diff
\`\`\`diff
${diff.slice(0, 10000)}
\`\`\`

${verifyResult ? `## 驗證指令結果\n\`\`\`\n${verifyResult.slice(0, 5000)}\n\`\`\`` : ""}

## 你的任務

請仔細審查以上資訊，判斷任務是否正確完成。

回覆必須是以下 JSON 格式（且只包含此 JSON，不要其他文字）：
\`\`\`json
${jsonFormat}
\`\`\`

判斷標準：
${judgingCriteria.join("\n")}`;
}

/**
 * 啟動 Judge claude -p 子進程
 */
async function spawnJudge(
  prompt: string,
  options: JudgeOptions,
): Promise<JudgeResult> {
  const args = [
    "-p",
    "--output-format", "json",
    "--permission-mode", "default",
    "--max-turns", String(options.maxTurns ?? 10),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`無法啟動 Judge 子進程：${error.message}`));
    });

    child.on("close", () => {
      try {
        const parsed = parseJudgeOutput(stdout);
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Judge 輸出解析失敗：${error instanceof Error ? error.message : error}`));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * 嘗試從文字中解析 Judge JSON 判決
 *
 * 策略：先嘗試直接 JSON.parse 整段文字，
 * 再嘗試提取 ```json 區塊，最後嘗試找最外層 { } 配對。
 */
function tryParseJudgeJson(text: string): Record<string, unknown> | null {
  // 策略 1：直接解析
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "verdict" in parsed) {
      return parsed;
    }
  } catch { /* 不是純 JSON */ }

  // 策略 2：提取 ```json ... ``` 區塊
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed && typeof parsed === "object" && "verdict" in parsed) {
        return parsed;
      }
    } catch { /* 解析失敗 */ }
  }

  // 策略 3：找最外層 { } 配對（支援巢狀物件/陣列）
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") depth--;
    if (depth === 0) {
      try {
        const parsed = JSON.parse(text.slice(firstBrace, i + 1));
        if (parsed && typeof parsed === "object" && "verdict" in parsed) {
          return parsed;
        }
      } catch { /* 解析失敗 */ }
      return null;
    }
  }
  return null;
}

/**
 * 解析 Judge 的 claude -p 輸出
 *
 * claude -p --output-format json 的 result 欄位包含 Judge 的回覆，
 * 其中應包含 JSON 格式的判決。
 *
 * 若判決中包含 criteria_results 和 intent_assessment，一併解析。
 */
export function parseJudgeOutput(stdout: string): JudgeResult {
  // 先解析 claude -p 的 JSON 包裝
  const cliOutput = JSON.parse(stdout.trim());
  const resultText: string = cliOutput.result ?? "";
  const sessionId: string = cliOutput.session_id;
  const costUsd: number = cliOutput.cost_usd;

  // 嘗試解析 Judge 回傳的 JSON 判決
  const verdict = tryParseJudgeJson(resultText);
  if (verdict) {
    const result: JudgeResult = {
      verdict: verdict.verdict === "REJECT" ? "REJECT" : "APPROVE",
      reasoning: String(verdict.reasoning ?? ""),
      session_id: sessionId,
      cost_usd: costUsd,
    };

    // 解析 criteria_results（若存在）
    if (Array.isArray(verdict.criteria_results)) {
      result.criteria_results = verdict.criteria_results.map(
        (cr: { criteria?: string; passed?: boolean; reasoning?: string }) => ({
          criteria: cr.criteria ?? "",
          passed: cr.passed ?? false,
          reasoning: cr.reasoning ?? "",
        }),
      );
    }

    // 解析 intent_assessment（若存在）
    if (typeof verdict.intent_assessment === "string") {
      result.intent_assessment = verdict.intent_assessment;
    }

    return result;
  }

  // 若無法提取 JSON，根據文字判斷
  if (resultText.includes("REJECT")) {
    return {
      verdict: "REJECT",
      reasoning: resultText,
      session_id: sessionId,
      cost_usd: costUsd,
    };
  }

  return {
    verdict: "APPROVE",
    reasoning: resultText || "Judge 未提供明確判決，預設通過",
    session_id: sessionId,
    cost_usd: costUsd,
  };
}
