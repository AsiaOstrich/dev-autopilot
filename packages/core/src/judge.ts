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

import type { JudgePolicy, JudgeReviewStage, Task, TaskResult } from "./types.js";

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
  /**
   * 判決信心度（XSPEC-035 雙階段輸出標準）
   *
   * 從 <summary> 區塊提取，反映 Judge 對判決的把握程度。
   * - high: 證據充分，判決確定
   * - medium: 有一定根據，但存在不確定性
   * - low: 資訊不足，建議人工複查
   */
  confidence?: "high" | "medium" | "low";
  /** 審查階段（借鑑 Superpowers 雙階段審查） */
  review_stage?: JudgeReviewStage;
  /** Judge session ID */
  session_id?: string;
  /** 審查成本 */
  cost_usd?: number;
  /** 各條 acceptance criteria 的逐條審查結果 */
  criteria_results?: CriteriaResult[];
  /** 使用者意圖達成度評估 */
  intent_assessment?: string;
  /** Red Team 發現的攻擊向量（僅 red_team 模式，XSPEC-043） */
  attack_vectors?: string[];
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
  /** 審查階段（借鑑 Superpowers 雙階段審查：spec 先行，再 quality） */
  reviewStage?: JudgeReviewStage;
  /** 是否在 DualStage 後追加 Red Team 第三階段（XSPEC-043） */
  enableRedTeam?: boolean;
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
    const prompt = options.reviewStage === "red_team"
      ? buildRedTeamPrompt(task, taskResult, diff)
      : buildJudgePrompt(task, taskResult, diff, verifyResult, options.reviewStage);

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
 * 執行雙階段 Judge 審查（借鑑 Superpowers subagent-driven-development）
 *
 * 1. Spec Compliance — 比對 task spec 與實作產出，檢查 missing/extra/misunderstood
 * 2. Code Quality — 程式碼品質、測試覆蓋、架構一致性
 * 3. Red Team（可選，XSPEC-043）— 攻方視角，找注入向量、邊界條件缺口、競態條件、授權繞過
 *
 * Spec 通過才進 Quality 階段。任一階段 REJECT 即停止。
 *
 * @param task - 已完成的任務
 * @param taskResult - 任務執行結果
 * @param options - Judge 選項
 * @returns 審查結果（回傳最終階段的 JudgeResult）
 */
export async function runDualStageJudge(
  task: Task,
  taskResult: TaskResult,
  options: JudgeOptions,
): Promise<JudgeResult> {
  // 階段 1: Spec Compliance
  options.onProgress?.(`[${task.id}] 啟動 Judge 審查（Spec Compliance）`);
  const specResult = await runJudge(task, taskResult, {
    ...options,
    reviewStage: "spec",
  });
  specResult.review_stage = "spec";

  if (specResult.verdict === "REJECT") {
    options.onProgress?.(`[${task.id}] Spec Compliance 審查未通過，跳過 Code Quality`);
    return specResult;
  }

  // 階段 2: Code Quality
  options.onProgress?.(`[${task.id}] 啟動 Judge 審查（Code Quality）`);
  const qualityResult = await runJudge(task, taskResult, {
    ...options,
    reviewStage: "quality",
  });
  qualityResult.review_stage = "quality";

  // 合併成本（spec + quality）
  qualityResult.cost_usd = (specResult.cost_usd ?? 0) + (qualityResult.cost_usd ?? 0);

  if (qualityResult.verdict === "REJECT") {
    return qualityResult;
  }

  // 階段 3（可選）: Red Team（XSPEC-043）
  if (options.enableRedTeam) {
    options.onProgress?.(`[${task.id}] 啟動 Judge 審查（Red Team）`);
    const redTeamResult = await runJudge(task, taskResult, {
      ...options,
      reviewStage: "red_team",
    });
    redTeamResult.review_stage = "red_team";

    // 任一階段 REJECT → 整體 REJECT
    if (redTeamResult.verdict === "REJECT") {
      return {
        ...qualityResult,
        verdict: "REJECT",
        reasoning: `Red Team: ${redTeamResult.reasoning}`,
        attack_vectors: redTeamResult.attack_vectors,
        review_stage: "red_team",
        cost_usd: (qualityResult.cost_usd ?? 0) + (redTeamResult.cost_usd ?? 0),
      };
    }

    // Red Team 通過：合併成本並回傳
    return {
      ...redTeamResult,
      cost_usd: (qualityResult.cost_usd ?? 0) + (redTeamResult.cost_usd ?? 0),
    };
  }

  return qualityResult;
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
  reviewStage?: JudgeReviewStage,
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

  // 階段特化指引
  let stageHeader = "你是一個嚴格的 Code Review Judge。請審查以下任務的執行結果。";
  let stageGuidance = "";
  if (reviewStage === "spec") {
    stageHeader = "你是一個 Spec Compliance Reviewer。請嚴格比對任務規格與實際實作。";
    stageGuidance = `
## Spec Compliance 審查重點（借鑑 Superpowers）
- **不信任報告，讀實際程式碼**：agent 聲稱完成不代表真正完成
- 檢查是否有 **missing**（規格要求但未實作）
- 檢查是否有 **extra**（規格未要求但額外實作）
- 檢查是否有 **misunderstood**（實作方向與規格不符）
`;
  } else if (reviewStage === "quality") {
    stageHeader = "你是一個 Code Quality Reviewer。請審查程式碼品質與架構一致性。";
    stageGuidance = `
## Code Quality 審查重點（借鑑 Superpowers）
- 單一職責原則：每個函式/模組是否只做一件事
- 介面清晰度：API 是否直觀、命名是否一致
- 檔案大小：單檔是否過大（超過 300 行需注意）
- 測試覆蓋：關鍵路徑是否有測試
- 錯誤處理：邊界條件是否考慮周全
`;
  }

  return `${stageHeader}

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
${stageGuidance}
## 你的任務

請仔細審查以上資訊，判斷任務是否正確完成。

**重要：你必須使用雙階段輸出格式（XSPEC-035）**

<analysis>
（在此進行你的思考過程 — 此區塊事後會被丟棄，不影響上下文 token 預算）
- 分析 git diff 的變更內容
- 比對規格要求與實際實作
- 評估邊界情況與潛在問題
${hasCriteria ? "- 逐條對照驗收條件（詳見下方）" : ""}
</analysis>

<summary>
verdict: APPROVE 或 REJECT
confidence: high 或 medium 或 low
reasoning: 你的判決理由（一段話）
${hasCriteria ? `criteria_results:\n  - criteria: "條件原文"\n    passed: true 或 false\n    reasoning: "判定理由"` : ""}${hasIntent ? `\nintent_assessment: 使用者意圖達成度評估` : ""}
</summary>

（只輸出上述雙階段 XML 格式，不要在外部加任何 JSON 或額外文字）

判斷標準：
${judgingCriteria.join("\n")}`;
}

/**
 * 構建 Red Team Judge prompt（XSPEC-043）
 *
 * 以攻擊者視角審查實作，找出注入向量、邊界條件缺口、競態條件、授權繞過等安全問題。
 */
export function buildRedTeamPrompt(
  task: Task,
  _taskResult: TaskResult,
  diff: string,
): string {
  return `你是一位滲透測試員。你的任務是**主動嘗試破壞**以下實作，而非確認它是否正確。

## 原始任務規格
### ${task.id}: ${task.title}
${task.spec}

## Git Diff（實作內容）
\`\`\`diff
${diff.slice(0, 10000)}
\`\`\`

## 你的任務

以攻擊者身份，依序審查以下攻擊面：

1. **輸入驗證** — SQL/Command/Path Injection？XSS？不可信輸入直接使用？
2. **邊界條件** — null/undefined、空陣列、整數溢位、極值能否導致崩潰或繞過邏輯？
3. **競態條件** — 並行執行時是否有 TOCTOU 或共享狀態問題？
4. **授權繞過** — 假設呼叫方可信而跳過驗證？可透過構造輸入提升權限？
5. **資訊洩漏** — Error message 是否暴露敏感資訊、stack trace、內部路徑？

## 輸出格式（必須使用雙階段格式）

<analysis>
[你的攻擊思考過程，逐項列出你嘗試的攻擊向量]
</analysis>

<summary>
verdict: APPROVE 或 REJECT
confidence: high 或 medium 或 low
reasoning: 整體判決理由
attack_vectors:
  - "SQL Injection via user input in line X"   ← 若有發現，每個向量一行
</summary>

如果找到任何可利用的漏洞 → verdict: REJECT
如果完全找不到（說明嘗試了什麼） → verdict: APPROVE`;
}

/**
 * 啟動 Judge claude -p 子進程
 */
async function spawnJudge(
  prompt: string,
  options: JudgeOptions,
): Promise<JudgeResult> {
  // Judge 使用 default 權限模式（唯讀審查），不需要 acceptEdits。
  // 這是刻意的設計選擇：Judge 只讀取 diff 和 verify output，不修改檔案。
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
 * 從雙階段輸出中提取 <summary> 區塊內容（XSPEC-035）
 *
 * 策略：
 * 1. 提取 <summary>...</summary> 區塊（丟棄 <analysis> 區塊）
 * 2. 若無 <summary> 標籤，回傳原始文字（降級相容）並記錄警告
 */
function extractSummaryBlock(text: string): { content: string; hasDualPhase: boolean } {
  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) {
    return { content: summaryMatch[1].trim(), hasDualPhase: true };
  }
  // 降級：無 <summary> 標籤時，使用完整回應
  console.warn("[WARN] dual-phase format missing in Judge output, fallback to full response (DPO-001)");
  return { content: text, hasDualPhase: false };
}

/**
 * 從 summary 文字中解析 verdict、confidence、reasoning
 *
 * 支援兩種格式：
 * 1. 雙階段 YAML 格式（verdict: APPROVE\nconfidence: high\nreasoning: ...）
 * 2. 舊式 JSON 格式（向後相容）
 */
function parseSummaryText(summary: string): {
  verdict: JudgeVerdict;
  confidence?: "high" | "medium" | "low";
  reasoning: string;
  criteria_results?: CriteriaResult[];
  intent_assessment?: string;
  attack_vectors?: string[];
} | null {
  // 嘗試 YAML-like 格式解析（雙階段輸出）
  const verdictMatch = summary.match(/verdict:\s*(APPROVE|REJECT)/i);
  const confidenceMatch = summary.match(/confidence:\s*(high|medium|low)/i);
  const reasoningMatch = summary.match(/reasoning:\s*(.+?)(?=\n\w+:|$)/is);

  if (verdictMatch) {
    const result: ReturnType<typeof parseSummaryText> = {
      verdict: verdictMatch[1].toUpperCase() === "REJECT" ? "REJECT" : "APPROVE",
      reasoning: reasoningMatch?.[1]?.trim() ?? summary,
    };
    if (confidenceMatch) {
      result.confidence = confidenceMatch[1].toLowerCase() as "high" | "medium" | "low";
    }
    // 解析 attack_vectors YAML list（`attack_vectors:` 之後，每行 `  - "..."` 格式）
    const attackVectorsMatch = summary.match(/attack_vectors:\s*\n((?:\s*-\s*.+\n?)*)/i);
    if (attackVectorsMatch) {
      const lines = attackVectorsMatch[1].split("\n");
      const vectors = lines
        .map((line) => line.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, "").trim())
        .filter((line) => line.length > 0);
      if (vectors.length > 0) {
        result.attack_vectors = vectors;
      }
    }
    return result;
  }

  // 嘗試 JSON 格式（向後相容）
  const jsonParsed = tryParseJudgeJson(summary);
  if (jsonParsed) {
    const result: ReturnType<typeof parseSummaryText> = {
      verdict: jsonParsed.verdict === "REJECT" ? "REJECT" : "APPROVE",
      reasoning: String(jsonParsed.reasoning ?? ""),
    };
    if (typeof jsonParsed.confidence === "string") {
      result.confidence = jsonParsed.confidence as "high" | "medium" | "low";
    }
    if (Array.isArray(jsonParsed.criteria_results)) {
      result.criteria_results = jsonParsed.criteria_results.map(
        (cr: { criteria?: string; passed?: boolean; reasoning?: string }) => ({
          criteria: cr.criteria ?? "",
          passed: cr.passed ?? false,
          reasoning: cr.reasoning ?? "",
        }),
      );
    }
    if (typeof jsonParsed.intent_assessment === "string") {
      result.intent_assessment = jsonParsed.intent_assessment;
    }
    if (Array.isArray(jsonParsed.attack_vectors)) {
      result.attack_vectors = jsonParsed.attack_vectors.map(String);
    }
    return result;
  }

  return null;
}

/**
 * 解析 Judge 的 claude -p 輸出
 *
 * 優先提取雙階段 <summary> 區塊（XSPEC-035），丟棄 <analysis>。
 * 若無雙階段格式，降級相容舊式 JSON 判決。
 *
 * 若判決中包含 criteria_results 和 intent_assessment，一併解析。
 */
export function parseJudgeOutput(stdout: string): JudgeResult {
  // 先解析 claude -p 的 JSON 包裝
  const cliOutput = JSON.parse(stdout.trim());
  const resultText: string = cliOutput.result ?? "";
  const sessionId: string = cliOutput.session_id;
  const costUsd: number = cliOutput.cost_usd;

  // 步驟 1：提取 <summary> 區塊（丟棄 <analysis>）
  const { content: summaryContent } = extractSummaryBlock(resultText);

  // 步驟 2：解析 summary 內容
  const parsed = parseSummaryText(summaryContent);
  if (parsed) {
    return {
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      criteria_results: parsed.criteria_results,
      intent_assessment: parsed.intent_assessment,
      attack_vectors: parsed.attack_vectors,
      session_id: sessionId,
      cost_usd: costUsd,
    };
  }

  // 步驟 3：降級 — 根據文字關鍵字判斷
  if (summaryContent.includes("REJECT")) {
    return {
      verdict: "REJECT",
      reasoning: summaryContent,
      session_id: sessionId,
      cost_usd: costUsd,
    };
  }

  return {
    verdict: "APPROVE",
    reasoning: summaryContent || "Judge 未提供明確判決，預設通過",
    session_id: sessionId,
    cost_usd: costUsd,
  };
}
