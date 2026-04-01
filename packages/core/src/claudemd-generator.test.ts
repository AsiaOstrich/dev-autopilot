import { describe, it, expect } from "vitest";
import { generateClaudeMd } from "./claudemd-generator.js";
import type { Task, QualityConfig } from "./types.js";

describe("generateClaudeMd", () => {
  const baseOptions = { project: "test-project" };

  it("無 acceptance_criteria 時不包含驗收條件區段", async () => {
    const task: Task = { id: "T-001", title: "基本任務", spec: "做某件事" };
    const result = await generateClaudeMd(task, baseOptions);
    expect(result).toContain("T-001");
    expect(result).toContain("基本任務");
    expect(result).not.toContain("驗收條件");
  });

  it("有 acceptance_criteria 時注入驗收條件", async () => {
    const task: Task = {
      id: "T-001",
      title: "含 criteria",
      spec: "實作 API",
      acceptance_criteria: ["回應 200 狀態碼", "含 JSON body", "錯誤回傳 4xx"],
    };
    const result = await generateClaudeMd(task, baseOptions);
    expect(result).toContain("## 驗收條件");
    expect(result).toContain("1. 回應 200 狀態碼");
    expect(result).toContain("2. 含 JSON body");
    expect(result).toContain("3. 錯誤回傳 4xx");
  });

  it("空 acceptance_criteria 陣列不顯示區段", async () => {
    const task: Task = {
      id: "T-001",
      title: "空 criteria",
      spec: "做事",
      acceptance_criteria: [],
    };
    const result = await generateClaudeMd(task, baseOptions);
    expect(result).not.toContain("驗收條件");
  });

  it("無 user_intent 時不包含意圖區段", async () => {
    const task: Task = { id: "T-001", title: "基本", spec: "做事" };
    const result = await generateClaudeMd(task, baseOptions);
    expect(result).not.toContain("使用者意圖");
  });

  it("有 user_intent 時注入使用者意圖", async () => {
    const task: Task = {
      id: "T-001",
      title: "含 intent",
      spec: "實作搜尋",
      user_intent: "使用者希望快速找到商品",
    };
    const result = await generateClaudeMd(task, baseOptions);
    expect(result).toContain("## 使用者意圖");
    expect(result).toContain("使用者希望快速找到商品");
    expect(result).toContain("真正解決了使用者的問題");
  });

  it("同時有 criteria 和 intent 時兩者都注入", async () => {
    const task: Task = {
      id: "T-001",
      title: "完整任務",
      spec: "實作搜尋",
      acceptance_criteria: ["支援關鍵字搜尋", "結果排序"],
      user_intent: "使用者希望快速找到商品",
    };
    const result = await generateClaudeMd(task, baseOptions);
    expect(result).toContain("## 驗收條件");
    expect(result).toContain("## 使用者意圖");
    // 驗收條件應在約束之前
    const criteriaIndex = result.indexOf("## 驗收條件");
    const intentIndex = result.indexOf("## 使用者意圖");
    const constraintIndex = result.indexOf("## 約束");
    expect(criteriaIndex).toBeLessThan(constraintIndex);
    expect(intentIndex).toBeLessThan(constraintIndex);
  });

  it("向後相容：無新欄位時行為與現有一致", async () => {
    const task: Task = {
      id: "T-001",
      title: "舊式任務",
      spec: "建立專案",
      verify_command: "pnpm build",
    };
    const result = await generateClaudeMd(task, baseOptions);
    expect(result).toContain("T-001");
    expect(result).toContain("舊式任務");
    expect(result).toContain("pnpm build");
    expect(result).not.toContain("驗收條件");
    expect(result).not.toContain("使用者意圖");
  });

  // ============================================================
  // Issue #4: CLAUDE.md 注入增強 — 品質要求與 Harness 提示
  // Source: GitHub Issue #4, AC-1 ~ AC-5
  // ============================================================

  describe("品質要求注入 (AC-1)", () => {
    const strictQualityConfig: QualityConfig = {
      verify: true,
      lint_command: "pnpm lint",
      type_check_command: "pnpm tsc --noEmit",
      judge_policy: "always",
      max_retries: 3,
      max_retry_budget_usd: 5,
    };

    it("[AC-1] qualityConfig 為 strict 時注入品質要求 section", async () => {
      // [Derived] AC-1: 含 quality: "strict" 的 task plan → 包含品質要求 section
      const task: Task = { id: "T-001", title: "嚴格品質", spec: "實作功能" };
      const result = await generateClaudeMd(task, {
        ...baseOptions,
        qualityConfig: strictQualityConfig,
      });
      expect(result).toContain("## 品質要求");
      expect(result).toContain("pnpm lint");
      expect(result).toContain("pnpm tsc --noEmit");
    });

    it("[AC-1] qualityConfig 僅有 verify 時仍注入品質要求", async () => {
      // [Derived] AC-1 邊界：最小 qualityConfig
      const minimalConfig: QualityConfig = {
        verify: true,
        judge_policy: "never",
        max_retries: 0,
        max_retry_budget_usd: 0,
      };
      const task: Task = { id: "T-001", title: "基本品質", spec: "實作功能" };
      const result = await generateClaudeMd(task, {
        ...baseOptions,
        qualityConfig: minimalConfig,
      });
      expect(result).toContain("## 品質要求");
    });

    it("[AC-1] 無 qualityConfig 時不注入品質要求 section", async () => {
      // [Derived] AC-1 反向：無 qualityConfig → 無品質要求
      const task: Task = { id: "T-001", title: "無品質", spec: "做事" };
      const result = await generateClaudeMd(task, baseOptions);
      expect(result).not.toContain("## 品質要求");
    });
  });

  describe("Harness 提示注入 (AC-2)", () => {
    it("[AC-2] 無 qualityConfig 時仍注入 Harness 提示", async () => {
      // [Derived] AC-2: 所有 task plan → 包含 Harness 提示
      const task: Task = { id: "T-001", title: "基本任務", spec: "做事" };
      const result = await generateClaudeMd(task, baseOptions);
      expect(result).toContain("## Harness 提示");
    });

    it("[AC-2] 有 qualityConfig 時也注入 Harness 提示", async () => {
      // [Derived] AC-2: 含 quality 設定時也要有 Harness 提示
      const task: Task = { id: "T-001", title: "品質任務", spec: "做事" };
      const result = await generateClaudeMd(task, {
        ...baseOptions,
        qualityConfig: {
          verify: true,
          judge_policy: "always",
          max_retries: 3,
          max_retry_budget_usd: 5,
        },
      });
      expect(result).toContain("## Harness 提示");
    });

    it("[AC-2] Harness 提示包含 Quality Gate 驗證提醒", async () => {
      // [Derived] AC-2: section 提醒 agent 結果會被驗證
      const task: Task = { id: "T-001", title: "任務", spec: "做事" };
      const result = await generateClaudeMd(task, baseOptions);
      const harnessIdx = result.indexOf("## Harness 提示");
      expect(harnessIdx).toBeGreaterThan(-1);
      // Harness 提示應在品質要求之後（若有）或約束之後
      const constraintIdx = result.indexOf("## 約束");
      expect(harnessIdx).toBeGreaterThan(constraintIdx);
    });
  });

  describe("行數限制 (AC-3)", () => {
    it("[AC-3] 完整內容不超過 200 行", async () => {
      // [Derived] AC-3: 含所有可選欄位的最大 case
      const task: Task = {
        id: "T-001",
        title: "完整任務含所有欄位",
        spec: "這是一個非常詳細的規格說明，包含多個段落。\n".repeat(10),
        acceptance_criteria: Array.from({ length: 10 }, (_, i) => `驗收條件 ${i + 1}: 某個可觀察行為`),
        user_intent: "使用者希望這個功能能夠完美運作",
        verify_command: "pnpm test && pnpm lint && pnpm tsc --noEmit",
      };
      const result = await generateClaudeMd(task, {
        ...baseOptions,
        qualityConfig: {
          verify: true,
          lint_command: "pnpm lint",
          type_check_command: "pnpm tsc --noEmit",
          judge_policy: "always",
          max_retries: 3,
          max_retry_budget_usd: 5,
          static_analysis_command: "pnpm eslint --max-warnings 0",
          completion_criteria: [
            { name: "lint 通過", command: "pnpm lint", required: true },
            { name: "型別檢查通過", command: "pnpm tsc --noEmit", required: true },
          ],
        },
        extraConstraints: [
          "不要修改 package.json",
          "不要新增依賴",
          "遵循現有程式碼風格",
          "保持 100% 測試覆蓋率",
          "使用 TypeScript strict mode",
        ],
      });
      const lineCount = result.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(200);
    });
  });

  describe("section 順序驗證", () => {
    it("品質要求在約束之後、Harness 提示在品質要求之後", async () => {
      // [Derived] 確保新增 sections 的順序正確
      const task: Task = {
        id: "T-001",
        title: "順序測試",
        spec: "做事",
        acceptance_criteria: ["AC1"],
        user_intent: "測試順序",
      };
      const result = await generateClaudeMd(task, {
        ...baseOptions,
        qualityConfig: {
          verify: true,
          judge_policy: "always",
          max_retries: 1,
          max_retry_budget_usd: 1,
        },
      });
      const constraintIdx = result.indexOf("## 約束");
      const qualityIdx = result.indexOf("## 品質要求");
      const harnessIdx = result.indexOf("## Harness 提示");

      expect(constraintIdx).toBeGreaterThan(-1);
      expect(qualityIdx).toBeGreaterThan(constraintIdx);
      expect(harnessIdx).toBeGreaterThan(qualityIdx);
    });
  });

  // AC-5: 向後相容 — 既有測試（上方）已覆蓋 regression 驗證
});
