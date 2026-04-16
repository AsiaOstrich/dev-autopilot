/**
 * Judge Agent 測試
 *
 * 測試 Judge 的 prompt 構建與結果解析邏輯。
 * 實際的 claude -p 呼叫在整合測試中驗證。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task, TaskResult } from "./types.js";

// 因為 judge.ts 中使用了 child_process，且核心邏輯（prompt 構建、輸出解析）
// 是 private function，我們主要測試 runJudge 的整合行為。
// 此處使用 mock 來避免實際啟動 claude 子進程。

// Mock child_process
vi.mock("node:child_process", () => {
  const mockSpawn = vi.fn(() => {
    const handlers: Record<string, Function> = {};
    const child = {
      stdout: {
        on: vi.fn((event: string, handler: Function) => {
          handlers[`stdout_${event}`] = handler;
        }),
      },
      stderr: {
        on: vi.fn((event: string, handler: Function) => {
          handlers[`stderr_${event}`] = handler;
        }),
      },
      stdin: {
        write: vi.fn(),
        end: vi.fn(() => {
          // 模擬 claude -p 的 JSON 輸出
          const output = JSON.stringify({
            type: "result",
            subtype: "success",
            session_id: "judge-session-001",
            cost_usd: 0.1,
            result: JSON.stringify({
              verdict: "APPROVE",
              reasoning: "任務完成，程式碼變更符合規格",
            }),
          });
          // 觸發 stdout data
          handlers["stdout_data"]?.(Buffer.from(output));
          // 觸發 close
          setTimeout(() => handlers["close"]?.(0), 0);
        }),
      },
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
    };
    return child;
  });

  return {
    spawn: mockSpawn,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
      if (typeof _opts === "function") {
        cb = _opts;
      }
      if (cb) {
        cb(null, { stdout: "mock diff output\n", stderr: "" });
      }
    }),
  };
});

describe("shouldRunJudge", () => {
  // shouldRunJudge 是純函式，不需要 mock
  // 直接 import 即可（judge.ts 頂層 import 不影響）
  it("always → 回傳 true", async () => {
    const { shouldRunJudge } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "X", spec: "x" };
    expect(shouldRunJudge("always", task, true)).toBe(true);
    expect(shouldRunJudge("always", task, false)).toBe(true);
  });

  it("on_change + hasChanges=true → true", async () => {
    const { shouldRunJudge } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "X", spec: "x" };
    expect(shouldRunJudge("on_change", task, true)).toBe(true);
  });

  it("on_change + hasChanges=false → false", async () => {
    const { shouldRunJudge } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "X", spec: "x" };
    expect(shouldRunJudge("on_change", task, false)).toBe(false);
  });

  it("never + task.judge 未設 → false", async () => {
    const { shouldRunJudge } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "X", spec: "x" };
    expect(shouldRunJudge("never", task, true)).toBe(false);
  });

  it("never + task.judge=true → true（task 層級覆寫）", async () => {
    const { shouldRunJudge } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "X", spec: "x", judge: true };
    expect(shouldRunJudge("never", task, true)).toBe(true);
  });

  it("always + task.judge=false → false（task 層級關閉）", async () => {
    const { shouldRunJudge } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "X", spec: "x", judge: false };
    expect(shouldRunJudge("always", task, true)).toBe(false);
  });
});

describe("buildJudgePrompt", () => {
  it("無 criteria/intent 時使用基本格式", async () => {
    const { buildJudgePrompt } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "基本任務", spec: "做某件事" };
    const result: TaskResult = { task_id: "T-001", status: "success", duration_ms: 1000 };
    const prompt = buildJudgePrompt(task, result, "diff", "");
    expect(prompt).toContain("基本任務");
    expect(prompt).not.toContain("驗收條件");
    expect(prompt).not.toContain("使用者意圖");
    expect(prompt).not.toContain("criteria_results");
  });

  it("reviewStage=spec 時使用 Spec Compliance 指引", async () => {
    const { buildJudgePrompt } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "Spec 任務", spec: "實作 API" };
    const result: TaskResult = { task_id: "T-001", status: "success", duration_ms: 1000 };
    const prompt = buildJudgePrompt(task, result, "diff", "", "spec");
    expect(prompt).toContain("Spec Compliance Reviewer");
    expect(prompt).toContain("missing");
    expect(prompt).toContain("extra");
    expect(prompt).toContain("misunderstood");
  });

  it("reviewStage=quality 時使用 Code Quality 指引", async () => {
    const { buildJudgePrompt } = await import("./judge.js");
    const task: Task = { id: "T-001", title: "Quality 任務", spec: "重構模組" };
    const result: TaskResult = { task_id: "T-001", status: "success", duration_ms: 1000 };
    const prompt = buildJudgePrompt(task, result, "diff", "", "quality");
    expect(prompt).toContain("Code Quality Reviewer");
    expect(prompt).toContain("單一職責");
    expect(prompt).toContain("介面清晰度");
  });

  it("有 acceptance_criteria 時注入到 prompt 並要求逐條判定", async () => {
    const { buildJudgePrompt } = await import("./judge.js");
    const task: Task = {
      id: "T-001",
      title: "含 criteria 的任務",
      spec: "實作 API",
      acceptance_criteria: ["回應 200 狀態碼", "含 JSON body"],
    };
    const result: TaskResult = { task_id: "T-001", status: "success", duration_ms: 1000 };
    const prompt = buildJudgePrompt(task, result, "diff", "");
    expect(prompt).toContain("驗收條件");
    expect(prompt).toContain("1. 回應 200 狀態碼");
    expect(prompt).toContain("2. 含 JSON body");
    expect(prompt).toContain("criteria_results");
    expect(prompt).toContain("逐條判定");
  });

  it("有 user_intent 時注入到 prompt", async () => {
    const { buildJudgePrompt } = await import("./judge.js");
    const task: Task = {
      id: "T-001",
      title: "含 intent 的任務",
      spec: "實作搜尋功能",
      user_intent: "使用者希望快速找到商品",
    };
    const result: TaskResult = { task_id: "T-001", status: "success", duration_ms: 1000 };
    const prompt = buildJudgePrompt(task, result, "diff", "");
    expect(prompt).toContain("使用者意圖");
    expect(prompt).toContain("使用者希望快速找到商品");
    expect(prompt).toContain("intent_assessment");
  });

  it("同時有 criteria 和 intent 時兩者都注入", async () => {
    const { buildJudgePrompt } = await import("./judge.js");
    const task: Task = {
      id: "T-001",
      title: "完整任務",
      spec: "實作搜尋",
      acceptance_criteria: ["支援關鍵字搜尋"],
      user_intent: "快速找到商品",
    };
    const result: TaskResult = { task_id: "T-001", status: "success", duration_ms: 1000 };
    const prompt = buildJudgePrompt(task, result, "diff", "");
    expect(prompt).toContain("驗收條件");
    expect(prompt).toContain("使用者意圖");
    expect(prompt).toContain("criteria_results");
    expect(prompt).toContain("intent_assessment");
  });
});

describe("parseJudgeOutput", () => {
  it("應解析含 criteria_results 的 Judge 輸出", async () => {
    const { parseJudgeOutput } = await import("./judge.js");
    const output = JSON.stringify({
      session_id: "s-001",
      cost_usd: 0.1,
      result: JSON.stringify({
        verdict: "APPROVE",
        reasoning: "全部通過",
        criteria_results: [
          { criteria: "回應 200", passed: true, reasoning: "API 正確回傳" },
          { criteria: "含 JSON", passed: true, reasoning: "Content-Type 正確" },
        ],
        intent_assessment: "完全達成使用者意圖",
      }),
    });
    const result = parseJudgeOutput(output);
    expect(result.verdict).toBe("APPROVE");
    expect(result.criteria_results).toHaveLength(2);
    expect(result.criteria_results![0].passed).toBe(true);
    expect(result.criteria_results![1].criteria).toBe("含 JSON");
    expect(result.intent_assessment).toBe("完全達成使用者意圖");
  });

  it("無 criteria_results 時不包含此欄位", async () => {
    const { parseJudgeOutput } = await import("./judge.js");
    const output = JSON.stringify({
      session_id: "s-002",
      cost_usd: 0.05,
      result: JSON.stringify({
        verdict: "APPROVE",
        reasoning: "OK",
      }),
    });
    const result = parseJudgeOutput(output);
    expect(result.verdict).toBe("APPROVE");
    expect(result.criteria_results).toBeUndefined();
    expect(result.intent_assessment).toBeUndefined();
  });

  it("criteria_results 解析失敗時降級為無 criteria", async () => {
    const { parseJudgeOutput } = await import("./judge.js");
    const output = JSON.stringify({
      session_id: "s-003",
      cost_usd: 0.05,
      result: '{"verdict": "REJECT", "reasoning": "不符合要求"}',
    });
    const result = parseJudgeOutput(output);
    expect(result.verdict).toBe("REJECT");
    expect(result.reasoning).toBe("不符合要求");
    expect(result.criteria_results).toBeUndefined();
  });
});

describe("runDualStageJudge（Superpowers 雙階段審查）", () => {
  it("應能匯入 runDualStageJudge 函式", async () => {
    const { runDualStageJudge } = await import("./judge.js");
    expect(runDualStageJudge).toBeDefined();
    expect(typeof runDualStageJudge).toBe("function");
  });

  it("應執行雙階段審查並回傳結果", async () => {
    const { runDualStageJudge } = await import("./judge.js");
    const task: Task = {
      id: "T-001",
      title: "測試雙階段",
      spec: "實作功能",
    };
    const taskResult: TaskResult = {
      task_id: "T-001",
      status: "success",
      cost_usd: 0.5,
      duration_ms: 5000,
    };

    const result = await runDualStageJudge(task, taskResult, {
      cwd: "/tmp/test",
    });

    // mock 預設回傳 APPROVE，所以兩階段都通過
    expect(result.verdict).toBe("APPROVE");
    expect(result.review_stage).toBe("quality");
    // 成本應合併
    expect(result.cost_usd).toBeGreaterThan(0);
  });
});

describe("Judge Agent", () => {
  it("應能匯入 runJudge 函式", async () => {
    const { runJudge } = await import("./judge.js");
    expect(runJudge).toBeDefined();
    expect(typeof runJudge).toBe("function");
  });

  it("runJudge 應回傳 JudgeResult 結構", async () => {
    const { runJudge } = await import("./judge.js");

    const task: Task = {
      id: "T-001",
      title: "測試任務",
      spec: "實作一個 hello world 函式",
      verify_command: "pnpm test",
    };

    const taskResult: TaskResult = {
      task_id: "T-001",
      status: "success",
      cost_usd: 0.5,
      duration_ms: 5000,
    };

    const result = await runJudge(task, taskResult, {
      cwd: "/tmp/test",
    });

    expect(result).toBeDefined();
    expect(result.verdict).toBe("APPROVE");
    expect(result.reasoning).toBeDefined();
    expect(typeof result.reasoning).toBe("string");
  });
});

describe("XSPEC-043: Judge Red Team Mode", () => {
  const baseTask: Task = {
    id: "T-043",
    title: "Red Team 測試任務",
    spec: "實作使用者認證 API",
  };
  const baseTaskResult: TaskResult = {
    task_id: "T-043",
    status: "success",
    cost_usd: 0.5,
    duration_ms: 3000,
  };

  it("buildRedTeamPrompt 包含攻方視角關鍵指令", async () => {
    const { buildRedTeamPrompt } = await import("./judge.js");
    const prompt = buildRedTeamPrompt(baseTask, baseTaskResult, "diff content");
    // 驗證攻方視角的關鍵詞都存在（對應 prompt 中實際的文字）
    expect(prompt).toContain("Injection");   // 輸入驗證（SQL/Command/Path Injection）
    expect(prompt).toContain("邊界條件");    // 邊界條件
    expect(prompt).toContain("競態條件");    // 競態條件
    expect(prompt).toContain("授權繞過");    // 授權繞過
    expect(prompt).toContain("attack_vectors");
    expect(prompt).toContain("滲透測試員");
    expect(prompt).toContain("APPROVE 或 REJECT");
  });

  it("parseJudgeOutput 正確解析 attack_vectors 陣列（雙階段 YAML 格式）", async () => {
    const { parseJudgeOutput } = await import("./judge.js");
    const summaryContent = `verdict: REJECT
confidence: high
reasoning: 發現 SQL Injection 漏洞
attack_vectors:
  - "SQL Injection via user input in line 42"
  - "Path Traversal in file upload handler"
`;
    const output = JSON.stringify({
      session_id: "rt-session-001",
      cost_usd: 0.15,
      result: `<analysis>
嘗試 SQL Injection...
</analysis>

<summary>
${summaryContent}
</summary>`,
    });
    const result = parseJudgeOutput(output);
    expect(result.verdict).toBe("REJECT");
    expect(result.attack_vectors).toBeDefined();
    expect(result.attack_vectors).toHaveLength(2);
    expect(result.attack_vectors![0]).toContain("SQL Injection");
    expect(result.attack_vectors![1]).toContain("Path Traversal");
  });

  it("parseJudgeOutput 在非 red_team 模式時 attack_vectors 為 undefined", async () => {
    const { parseJudgeOutput } = await import("./judge.js");
    const output = JSON.stringify({
      session_id: "s-002",
      cost_usd: 0.1,
      result: `<summary>
verdict: APPROVE
confidence: high
reasoning: 程式碼符合規格
</summary>`,
    });
    const result = parseJudgeOutput(output);
    expect(result.verdict).toBe("APPROVE");
    expect(result.attack_vectors).toBeUndefined();
  });

  it("runDualStageJudge 在 enableRedTeam=false 時 spawn 只被呼叫 2 次", async () => {
    // 取得 mock spawn 並清除計數
    const childProcess = await import("node:child_process");
    const mockSpawn = vi.mocked(childProcess.spawn);
    mockSpawn.mockClear();

    const { runDualStageJudge } = await import("./judge.js");
    await runDualStageJudge(baseTask, baseTaskResult, {
      cwd: "/tmp/test",
      enableRedTeam: false,
    });

    // spec + quality 兩階段 = spawn 被呼叫 2 次
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it("runDualStageJudge 在 enableRedTeam=true 時 spawn 被呼叫 3 次", async () => {
    const childProcess = await import("node:child_process");
    const mockSpawn = vi.mocked(childProcess.spawn);
    mockSpawn.mockClear();

    const { runDualStageJudge } = await import("./judge.js");
    await runDualStageJudge(baseTask, baseTaskResult, {
      cwd: "/tmp/test",
      enableRedTeam: true,
    });

    // spec + quality + red_team 三階段 = spawn 被呼叫 3 次
    expect(mockSpawn).toHaveBeenCalledTimes(3);
  });

  it("Red Team REJECT 時整體結果 REJECT 且含 attack_vectors", async () => {
    const childProcess = await import("node:child_process");
    const mockSpawn = vi.mocked(childProcess.spawn);
    mockSpawn.mockClear();

    // 讓第三次呼叫（Red Team）回傳 REJECT + attack_vectors
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      const handlers: Record<string, Function> = {};
      const isRedTeamCall = callCount === 3;
      const child = {
        stdout: {
          on: vi.fn((event: string, handler: Function) => {
            handlers[`stdout_${event}`] = handler;
          }),
        },
        stderr: {
          on: vi.fn((event: string, handler: Function) => {
            handlers[`stderr_${event}`] = handler;
          }),
        },
        stdin: {
          write: vi.fn(),
          end: vi.fn(() => {
            const resultText = isRedTeamCall
              ? `<analysis>找到 SQL Injection...</analysis>
<summary>
verdict: REJECT
confidence: high
reasoning: 發現可利用的 SQL Injection 漏洞
attack_vectors:
  - "SQL Injection via userId parameter"
</summary>`
              : JSON.stringify({ verdict: "APPROVE", reasoning: "通過" });
            const output = JSON.stringify({
              type: "result",
              subtype: "success",
              session_id: `session-${callCount}`,
              cost_usd: 0.1,
              result: resultText,
            });
            handlers["stdout_data"]?.(Buffer.from(output));
            setTimeout(() => handlers["close"]?.(0), 0);
          }),
        },
        on: vi.fn((event: string, handler: Function) => {
          handlers[event] = handler;
        }),
      };
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });

    const { runDualStageJudge } = await import("./judge.js");
    const result = await runDualStageJudge(baseTask, baseTaskResult, {
      cwd: "/tmp/test",
      enableRedTeam: true,
    });

    expect(result.verdict).toBe("REJECT");
    expect(result.review_stage).toBe("red_team");
    expect(result.attack_vectors).toBeDefined();
    expect(result.attack_vectors![0]).toContain("SQL Injection");
    expect(result.reasoning).toContain("Red Team:");

    // 還原 mock 到預設行為
    mockSpawn.mockImplementation(() => {
      const handlers: Record<string, Function> = {};
      const child = {
        stdout: { on: vi.fn((event: string, handler: Function) => { handlers[`stdout_${event}`] = handler; }) },
        stderr: { on: vi.fn((event: string, handler: Function) => { handlers[`stderr_${event}`] = handler; }) },
        stdin: {
          write: vi.fn(),
          end: vi.fn(() => {
            const output = JSON.stringify({
              type: "result", subtype: "success",
              session_id: "judge-session-001", cost_usd: 0.1,
              result: JSON.stringify({ verdict: "APPROVE", reasoning: "任務完成，程式碼變更符合規格" }),
            });
            handlers["stdout_data"]?.(Buffer.from(output));
            setTimeout(() => handlers["close"]?.(0), 0);
          }),
        },
        on: vi.fn((event: string, handler: Function) => { handlers[event] = handler; }),
      };
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
  });
});
