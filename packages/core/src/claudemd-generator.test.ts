import { describe, it, expect } from "vitest";
import { generateClaudeMd } from "./claudemd-generator.js";
import type { Task } from "./types.js";

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
});
