import { describe, expect, it } from "vitest";
import { mapSpecToAgent, ALL_AGENTS } from "./agent-mapper.js";

describe("mapSpecToAgent", () => {
  it("maps 需求 to planner", () => {
    expect(mapSpecToAgent("分析需求文件")).toBe("planner");
  });

  it("maps PRD to planner", () => {
    expect(mapSpecToAgent("撰寫 PRD 文件")).toBe("planner");
  });

  it("maps 架構 to architect", () => {
    expect(mapSpecToAgent("設計系統架構")).toBe("architect");
  });

  it("maps ADR to architect", () => {
    expect(mapSpecToAgent("建立 ADR 記錄")).toBe("architect");
  });

  it("maps 規格 to designer", () => {
    expect(mapSpecToAgent("撰寫 API 規格")).toBe("designer");
  });

  it("maps 設計 to designer", () => {
    expect(mapSpecToAgent("設計資料模型")).toBe("designer");
  });

  it("maps UI to uiux", () => {
    expect(mapSpecToAgent("調整 UI 元件樣式")).toBe("uiux");
  });

  it("maps 視覺 to uiux", () => {
    expect(mapSpecToAgent("更新視覺風格")).toBe("uiux");
  });

  it("maps 實作 to builder", () => {
    expect(mapSpecToAgent("實作用戶模型")).toBe("builder");
  });

  it("maps implement to builder", () => {
    expect(mapSpecToAgent("implement user authentication")).toBe("builder");
  });

  it("maps 審查 to reviewer", () => {
    expect(mapSpecToAgent("審查程式碼品質")).toBe("reviewer");
  });

  it("maps review to reviewer", () => {
    expect(mapSpecToAgent("code review the PR")).toBe("reviewer");
  });

  it("maps 部署 to operator", () => {
    expect(mapSpecToAgent("部署到 staging 環境")).toBe("operator");
  });

  it("maps deploy to operator", () => {
    expect(mapSpecToAgent("deploy to production")).toBe("operator");
  });

  it("maps 評估 to evaluator", () => {
    expect(mapSpecToAgent("評估系統效能")).toBe("evaluator");
  });

  it("maps 度量 to evaluator", () => {
    expect(mapSpecToAgent("收集品質度量")).toBe("evaluator");
  });

  it("defaults to builder for unmatched spec", () => {
    expect(mapSpecToAgent("do something generic")).toBe("builder");
  });

  it("is case insensitive", () => {
    expect(mapSpecToAgent("IMPLEMENT the feature")).toBe("builder");
    expect(mapSpecToAgent("Deploy to prod")).toBe("operator");
  });
});

describe("ALL_AGENTS", () => {
  it("contains all 8 agents", () => {
    expect(ALL_AGENTS).toHaveLength(8);
    expect(ALL_AGENTS).toContain("planner");
    expect(ALL_AGENTS).toContain("architect");
    expect(ALL_AGENTS).toContain("designer");
    expect(ALL_AGENTS).toContain("uiux");
    expect(ALL_AGENTS).toContain("builder");
    expect(ALL_AGENTS).toContain("reviewer");
    expect(ALL_AGENTS).toContain("operator");
    expect(ALL_AGENTS).toContain("evaluator");
  });
});
