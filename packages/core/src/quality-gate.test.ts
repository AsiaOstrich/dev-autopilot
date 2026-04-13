import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runQualityGate, checkAgentsMdSync, checkFrontendDesignCompliance, type ShellExecutor } from "./quality-gate.js";
import type { QualityConfig, Task } from "./types.js";

const baseTask: Task = {
  id: "T-001",
  title: "Test task",
  spec: "Do something",
  verify_command: "pnpm test",
};

const baseQuality: QualityConfig = {
  verify: true,
  judge_policy: "never",
  max_retries: 0,
  max_retry_budget_usd: 0,
};

/** 建立 mock shell executor */
function mockShell(results: Record<string, number>): ShellExecutor {
  return vi.fn(async (command: string) => {
    const exitCode = results[command] ?? 0;
    return {
      exitCode,
      stdout: exitCode === 0 ? "ok" : "",
      stderr: exitCode !== 0 ? `Error running: ${command}` : "",
    };
  });
}

describe("runQualityGate", () => {
  it("verify_command 通過 → passed", async () => {
    const shell = mockShell({ "pnpm test": 0 });
    const result = await runQualityGate(baseTask, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("verify");
    expect(result.steps[0].passed).toBe(true);
  });

  it("verify_command 失敗 → failed + feedback", async () => {
    const shell = mockShell({ "pnpm test": 1 });
    const result = await runQualityGate(baseTask, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.feedback).toContain("verify");
    expect(result.feedback).toContain("pnpm test");
  });

  it("verify 通過但 lint 失敗 → 只執行到 lint", async () => {
    const shell = mockShell({ "pnpm test": 0, "eslint .": 1 });
    const qc: QualityConfig = { ...baseQuality, lint_command: "eslint ." };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].passed).toBe(true);
    expect(result.steps[1].name).toBe("lint");
    expect(result.steps[1].passed).toBe(false);
  });

  it("三個步驟全部通過", async () => {
    const shell = mockShell({ "pnpm test": 0, "eslint .": 0, "tsc --noEmit": 0 });
    const qc: QualityConfig = {
      ...baseQuality,
      lint_command: "eslint .",
      type_check_command: "tsc --noEmit",
    };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.passed)).toBe(true);
  });

  it("verify=false → 跳過 verify_command", async () => {
    const shell = mockShell({});
    const qc: QualityConfig = { ...baseQuality, verify: false };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(0);
    expect(shell).not.toHaveBeenCalled();
  });

  it("task 無 verify_command 但 verify=true → 跳過 verify 步驟", async () => {
    const shell = mockShell({});
    const taskNoVerify: Task = { id: "T-001", title: "X", spec: "x" };
    const result = await runQualityGate(taskNoVerify, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(0);
  });

  it("shell executor 拋出例外 → 步驟 failed", async () => {
    const shell: ShellExecutor = vi.fn(async () => {
      throw new Error("network timeout");
    });
    const result = await runQualityGate(baseTask, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.steps[0].passed).toBe(false);
    expect(result.steps[0].output).toContain("network timeout");
  });
});

describe("runQualityGate — 多層級測試", () => {
  it("test_levels 全部通過", async () => {
    const shell = mockShell({
      "pnpm test:unit": 0,
      "pnpm test:integration": 0,
      "pnpm test:e2e": 0,
    });

    const task: Task = {
      id: "T-001",
      title: "Multi-level test",
      spec: "test",
      test_levels: [
        { name: "unit", command: "pnpm test:unit" },
        { name: "integration", command: "pnpm test:integration" },
        { name: "e2e", command: "pnpm test:e2e" },
      ],
    };

    const result = await runQualityGate(task, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].name).toBe("unit");
    expect(result.steps[1].name).toBe("integration");
    expect(result.steps[2].name).toBe("e2e");
    expect(result.steps.every((s) => s.passed)).toBe(true);
  });

  it("test_levels 第二個失敗 → 短路停止", async () => {
    const shell = mockShell({
      "pnpm test:unit": 0,
      "pnpm test:integration": 1,
      "pnpm test:e2e": 0,
    });

    const task: Task = {
      id: "T-001",
      title: "Multi-level test",
      spec: "test",
      test_levels: [
        { name: "unit", command: "pnpm test:unit" },
        { name: "integration", command: "pnpm test:integration" },
        { name: "e2e", command: "pnpm test:e2e" },
      ],
    };

    const result = await runQualityGate(task, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(2); // unit 通過 + integration 失敗，e2e 不執行
    expect(result.steps[0].passed).toBe(true);
    expect(result.steps[1].passed).toBe(false);
    expect(result.feedback).toContain("integration");
    // e2e 不應被呼叫
    expect(shell).toHaveBeenCalledTimes(2);
  });

  it("test_levels 優先於 verify_command", async () => {
    const shell = mockShell({
      "pnpm test:unit": 0,
      "pnpm test": 1, // verify_command 設為失敗，但不應被執行
    });

    const task: Task = {
      id: "T-001",
      title: "Priority test",
      spec: "test",
      verify_command: "pnpm test",
      test_levels: [{ name: "unit", command: "pnpm test:unit" }],
    };

    const result = await runQualityGate(task, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("unit");
    // verify_command 不應被執行
    expect(shell).toHaveBeenCalledTimes(1);
    expect(shell).toHaveBeenCalledWith("pnpm test:unit", "/tmp");
  });

  it("test_levels 為空陣列 → 回退到 verify_command", async () => {
    const shell = mockShell({ "pnpm test": 0 });

    const task: Task = {
      id: "T-001",
      title: "Empty levels",
      spec: "test",
      verify_command: "pnpm test",
      test_levels: [],
    };

    const result = await runQualityGate(task, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("verify");
  });

  it("test_levels 通過後繼續執行 lint_command", async () => {
    const shell = mockShell({
      "pnpm test:unit": 0,
      "eslint .": 1,
    });

    const task: Task = {
      id: "T-001",
      title: "Levels + lint",
      spec: "test",
      test_levels: [{ name: "unit", command: "pnpm test:unit" }],
    };

    const qc: QualityConfig = { ...baseQuality, lint_command: "eslint ." };

    const result = await runQualityGate(task, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].name).toBe("unit");
    expect(result.steps[0].passed).toBe(true);
    expect(result.steps[1].name).toBe("lint");
    expect(result.steps[1].passed).toBe(false);
  });

  it("只有 unit level → 步驟數為 1", async () => {
    const shell = mockShell({ "npm run test:unit": 0 });

    const task: Task = {
      id: "T-002",
      title: "Unit only",
      spec: "test",
      test_levels: [{ name: "unit", command: "npm run test:unit" }],
    };

    const result = await runQualityGate(task, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("unit");
  });

  it("system level 測試通過", async () => {
    const shell = mockShell({
      "pnpm test:unit": 0,
      "pnpm test:system": 0,
    });

    const task: Task = {
      id: "T-001",
      title: "With system test",
      spec: "test",
      test_levels: [
        { name: "unit", command: "pnpm test:unit" },
        { name: "system", command: "pnpm test:system" },
      ],
    };

    const result = await runQualityGate(task, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].name).toBe("unit");
    expect(result.steps[1].name).toBe("system");
  });
});

describe("runQualityGate — static_analysis", () => {
  it("static_analysis_command 通過", async () => {
    const shell = mockShell({ "pnpm test": 0, "semgrep --config auto .": 0 });
    const qc: QualityConfig = {
      ...baseQuality,
      static_analysis_command: "semgrep --config auto .",
    };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].name).toBe("static_analysis");
  });

  it("static_analysis_command 失敗即停", async () => {
    const shell = mockShell({ "pnpm test": 0, "semgrep --config auto .": 1 });
    const qc: QualityConfig = {
      ...baseQuality,
      static_analysis_command: "semgrep --config auto .",
    };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.feedback).toContain("static_analysis");
  });
});

describe("runQualityGate — completion_criteria", () => {
  it("required completion_criteria 通過", async () => {
    const shell = mockShell({ "pnpm test": 0, "check-docs": 0 });
    const qc: QualityConfig = {
      ...baseQuality,
      completion_criteria: [
        { name: "docs_check", command: "check-docs", required: true },
      ],
    };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].name).toBe("completion_check");
  });

  it("required completion_criteria 失敗即停", async () => {
    const shell = mockShell({ "pnpm test": 0, "check-docs": 1 });
    const qc: QualityConfig = {
      ...baseQuality,
      completion_criteria: [
        { name: "docs_check", command: "check-docs", required: true },
      ],
    };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.feedback).toContain("completion_check");
  });

  it("optional completion_criteria 失敗不停止", async () => {
    const shell = mockShell({ "pnpm test": 0, "check-optional": 1, "check-required": 0 });
    const qc: QualityConfig = {
      ...baseQuality,
      completion_criteria: [
        { name: "optional_check", command: "check-optional", required: false },
        { name: "required_check", command: "check-required", required: true },
      ],
    };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(3); // verify + 2 completion checks
    expect(result.steps[1].passed).toBe(false); // optional failed
    expect(result.steps[2].passed).toBe(true); // required passed
  });

  it("無 command 的 completion_criteria 被跳過", async () => {
    const shell = mockShell({ "pnpm test": 0 });
    const qc: QualityConfig = {
      ...baseQuality,
      completion_criteria: [
        { name: "judge_review", required: true }, // 無 command，由 Judge 審查
      ],
    };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1); // 只有 verify
    expect(shell).toHaveBeenCalledTimes(1);
  });
});

describe("runQualityGate — 驗證證據（Superpowers Iron Law）", () => {
  it("通過時應收集所有步驟的驗證證據", async () => {
    const shell = mockShell({ "pnpm test": 0, "eslint .": 0 });
    const qc: QualityConfig = { ...baseQuality, lint_command: "eslint ." };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0].command).toBe("pnpm test");
    expect(result.evidence[0].exit_code).toBe(0);
    expect(result.evidence[0].timestamp).toBeTruthy();
    expect(result.evidence[1].command).toBe("eslint .");
  });

  it("失敗時也應收集已執行步驟的證據", async () => {
    const shell = mockShell({ "pnpm test": 0, "eslint .": 1 });
    const qc: QualityConfig = { ...baseQuality, lint_command: "eslint ." };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(false);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0].exit_code).toBe(0);
    expect(result.evidence[1].exit_code).toBe(1);
  });

  it("無步驟時 evidence 為空陣列", async () => {
    const shell = mockShell({});
    const qc: QualityConfig = { ...baseQuality, verify: false };
    const result = await runQualityGate(baseTask, qc, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.evidence).toHaveLength(0);
  });

  it("evidence 的 output 應被截斷至合理長度", async () => {
    const shell: ShellExecutor = vi.fn(async () => ({
      exitCode: 0,
      stdout: "x".repeat(5000),
      stderr: "",
    }));
    const result = await runQualityGate(baseTask, baseQuality, {
      cwd: "/tmp",
      shellExecutor: shell,
    });

    expect(result.passed).toBe(true);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].output.length).toBeLessThanOrEqual(2000);
  });
});

describe("checkAgentsMdSync — AGENTS.md 合規檢查", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "devap-qg-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("無 AGENTS.md 時回傳 null", async () => {
    const result = await checkAgentsMdSync(tmpDir);
    expect(result).toBeNull();
  });

  it("AGENTS.md 無 UDS 標記時 passed=true 並跳過", async () => {
    await writeFile(join(tmpDir, "AGENTS.md"), "# My Project\nSome content");
    const result = await checkAgentsMdSync(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(true);
    expect(result!.step.output).toContain("無 UDS 標記區塊");
  });

  it("AGENTS.md 與 .standards/ 同步時 passed=true", async () => {
    const stdDir = join(tmpDir, ".standards");
    await mkdir(stdDir);
    await writeFile(join(stdDir, "commit-message.ai.yaml"), "standard: {}");
    await writeFile(join(stdDir, "testing.ai.yaml"), "standard: {}");
    await writeFile(join(stdDir, "manifest.json"), "{}");
    await writeFile(join(tmpDir, "AGENTS.md"), [
      "# AGENTS",
      "<!-- UDS:STANDARDS:START -->",
      "- `commit-message.ai.yaml` - 提交訊息",
      "- `testing.ai.yaml` - 測試標準",
      "<!-- UDS:STANDARDS:END -->",
    ].join("\n"));

    const result = await checkAgentsMdSync(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(true);
    expect(result!.step.output).toContain("同步");
  });

  it("新增標準未列入 AGENTS.md 時偵測 drift", async () => {
    const stdDir = join(tmpDir, ".standards");
    await mkdir(stdDir);
    await writeFile(join(stdDir, "commit-message.ai.yaml"), "standard: {}");
    await writeFile(join(stdDir, "testing.ai.yaml"), "standard: {}");
    await writeFile(join(tmpDir, "AGENTS.md"), [
      "<!-- UDS:STANDARDS:START -->",
      "- `commit-message.ai.yaml`",
      "<!-- UDS:STANDARDS:END -->",
    ].join("\n"));

    const result = await checkAgentsMdSync(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(false);
    expect(result!.step.output).toContain("testing.ai.yaml");
    expect(result!.driftedFiles).toContain("testing.ai.yaml");
  });

  it(".standards/ 不存在時 passed=false", async () => {
    await writeFile(join(tmpDir, "AGENTS.md"), [
      "<!-- UDS:STANDARDS:START -->",
      "- `testing.ai.yaml`",
      "<!-- UDS:STANDARDS:END -->",
    ].join("\n"));

    const result = await checkAgentsMdSync(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(false);
    expect(result!.step.output).toContain("不存在");
  });
});

// ─────────────────────────────────────────────────────────────
// checkFrontendDesignCompliance — 前端設計合規性檢查
// AC-3.1：驗證 DESIGN.md 存在性
// AC-3.2：驗證必填欄位完整性，缺失時回報具體欄位名稱
// AC-3.3：失敗時給出清楚的錯誤訊息
// ─────────────────────────────────────────────────────────────
describe("checkFrontendDesignCompliance — 前端設計合規性檢查", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "devap-fd-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // AC-3.1：DESIGN.md 不存在時回傳 null（純後端/CLI 專案不 block）
  it("DESIGN.md 不存在時回傳 null（非前端專案不被 block）", async () => {
    const result = await checkFrontendDesignCompliance(tmpDir);
    expect(result).toBeNull();
  });

  // AC-3.1 + AC-3.2：有效的完整 DESIGN.md → passed=true
  it("DESIGN.md 包含所有必填段落 → passed=true", async () => {
    const validDesignMd = [
      "# DESIGN",
      "",
      "## visual_theme",
      "Light theme.",
      "",
      "## color_palette",
      "background: #ffffff",
      "surface: #f5f5f5",
      "primary_text: #111111",
      "muted_text: #888888",
      "accent: #0070f3",
      "",
      "## typography",
      "font-family: Inter",
      "",
      "## component_styling",
      "border-radius: 4px",
      "",
      "## layout_spacing",
      "base: 8px",
      "",
      "## design_guidelines",
      "",
      "### anti_patterns",
      "- 禁止使用魔術數字",
      "- 禁止內嵌樣式",
      "- 禁止超過 3 層巢狀",
      "- 禁止不語義化的顏色",
      "- 禁止跳過視覺層級",
    ].join("\n");

    await writeFile(join(tmpDir, "DESIGN.md"), validDesignMd);
    const result = await checkFrontendDesignCompliance(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(true);
    expect(result!.step.name).toBe("frontend_design_check");
    expect(result!.missingSections).toBeUndefined();
  });

  // AC-3.2：缺少必填段落時 passed=false，並回報具體缺失欄位名稱
  it("缺少必填段落 → passed=false 且 missingSections 包含具體欄位名稱", async () => {
    const incompleteDesignMd = [
      "# DESIGN",
      "",
      "## visual_theme",
      "Light theme.",
      "",
      "## color_palette",
      "background: #fff",
      // 缺少 typography、component_styling、layout_spacing、design_guidelines
    ].join("\n");

    await writeFile(join(tmpDir, "DESIGN.md"), incompleteDesignMd);
    const result = await checkFrontendDesignCompliance(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(false);
    expect(result!.missingSections).toBeDefined();
    expect(result!.missingSections).toContain("typography");
    expect(result!.missingSections).toContain("component_styling");
    expect(result!.missingSections).toContain("layout_spacing");
    expect(result!.missingSections).toContain("design_guidelines");
  });

  // AC-3.3：錯誤訊息應清楚說明缺失內容
  it("錯誤訊息應包含缺失段落的具體名稱", async () => {
    const partialDesignMd = [
      "# DESIGN",
      "## visual_theme",
      "Dark theme.",
      // 缺少其他所有必填段落
    ].join("\n");

    await writeFile(join(tmpDir, "DESIGN.md"), partialDesignMd);
    const result = await checkFrontendDesignCompliance(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(false);
    // AC-3.3：錯誤訊息必須明確指出缺失內容
    expect(result!.step.output).toContain("缺少必填段落");
    expect(result!.step.output).toContain("color_palette");
    expect(result!.step.output).toContain("typography");
  });

  // 語義色彩 token 缺失 → 警告（passed 仍為 true，因為必填段落完整）
  it("必填段落完整但缺少語義色彩 token → passed=true（警告）且 missingColorTokens 有值", async () => {
    const missingTokenDesign = [
      "# DESIGN",
      "## visual_theme",
      "Light.",
      "## color_palette",
      "background: #fff",
      // 缺少 surface、primary_text、muted_text、accent
      "## typography",
      "font: Inter",
      "## component_styling",
      "border: 4px",
      "## layout_spacing",
      "base: 8",
      "## design_guidelines",
      "### anti_patterns",
      "- 禁止魔術數字",
      "- 禁止內嵌樣式",
      "- 禁止不語義顏色",
      "- 禁止跳過層級",
      "- 禁止過深巢狀",
    ].join("\n");

    await writeFile(join(tmpDir, "DESIGN.md"), missingTokenDesign);
    const result = await checkFrontendDesignCompliance(tmpDir);
    expect(result).not.toBeNull();
    // 必填段落完整 → passed=true（僅 warn）
    expect(result!.step.passed).toBe(true);
    expect(result!.missingColorTokens).toBeDefined();
    expect(result!.missingColorTokens).toContain("surface");
  });

  // anti_patterns 不足 → 警告
  it("anti_patterns 條目不足（< 5）→ passed=true（警告）且 antiPatternCount 正確", async () => {
    const fewAntiPatterns = [
      "# DESIGN",
      "## visual_theme",
      "Light.",
      "## color_palette",
      "background: #fff",
      "surface: #f5f5f5",
      "primary_text: #111",
      "muted_text: #888",
      "accent: #07f",
      "## typography",
      "font: Inter",
      "## component_styling",
      "border: 4px",
      "## layout_spacing",
      "base: 8",
      "## design_guidelines",
      "### anti_patterns",
      "- 禁止魔術數字",
      "- 禁止內嵌樣式",
      // 只有 2 條，不足 5 條
    ].join("\n");

    await writeFile(join(tmpDir, "DESIGN.md"), fewAntiPatterns);
    const result = await checkFrontendDesignCompliance(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(true);
    expect(result!.antiPatternCount).toBeDefined();
    expect(result!.antiPatternCount!).toBeLessThan(5);
    expect(result!.step.output).toContain("anti_patterns");
  });

  // kebab-case 格式也應被識別（如 ## visual-theme）
  it("kebab-case 段落名稱也應被識別為合規", async () => {
    const kebabDesignMd = [
      "# DESIGN",
      "## visual-theme",
      "Light.",
      "## color-palette",
      "background: #fff",
      "surface: #f5f",
      "primary-text: #111",
      "muted-text: #888",
      "accent: #07f",
      "## typography",
      "font: Inter",
      "## component-styling",
      "border: 4px",
      "## layout-spacing",
      "base: 8",
      "## design-guidelines",
      "### anti_patterns",
      "- a",
      "- b",
      "- c",
      "- d",
      "- e",
    ].join("\n");

    await writeFile(join(tmpDir, "DESIGN.md"), kebabDesignMd);
    const result = await checkFrontendDesignCompliance(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.step.passed).toBe(true);
    expect(result!.missingSections).toBeUndefined();
  });

  // runQualityGate 整合：DESIGN.md 存在且有問題時，整體仍 passed（非阻塞）
  it("runQualityGate 整合：DESIGN.md 有問題但不 block 整體 QualityGate", async () => {
    // 寫一個缺少必填段落的 DESIGN.md
    await writeFile(join(tmpDir, "DESIGN.md"), "# DESIGN\n## visual_theme\nLight.");

    const shell = vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }));
    const taskNoVerify: Task = { id: "T-001", title: "X", spec: "x" };
    const qc: QualityConfig = {
      verify: false,
      judge_policy: "never",
      max_retries: 0,
      max_retry_budget_usd: 0,
    };

    const result = await runQualityGate(taskNoVerify, qc, {
      cwd: tmpDir,
      shellExecutor: shell,
    });

    // 整體仍然 passed（frontend_design_check 為非阻塞）
    expect(result.passed).toBe(true);
    // 但 steps 中應有 frontend_design_check 步驟
    const fdStep = result.steps.find(s => s.name === "frontend_design_check");
    expect(fdStep).toBeDefined();
    expect(fdStep!.passed).toBe(false);
    expect(fdStep!.output).toContain("缺少必填段落");
  });
});
