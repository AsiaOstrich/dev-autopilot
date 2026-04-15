/**
 * config-resolver 單元測試（SPEC-015 AC-3）
 *
 * 測試策略：
 * - 使用者覆蓋優先於 Recipe 預設值
 * - 兩者皆無時回傳空物件
 */

import { describe, it, expect } from "vitest";
import { resolveConfig } from "../../packaging/config-resolver.js";
import type { Recipe } from "../../packaging/types.js";

const baseRecipe: Recipe = {
  name: "test-recipe",
  steps: [{ run: "echo hello" }],
  config: {
    registry: "https://registry.npmjs.org",
    access: "public",
    tag: "latest",
  },
};

describe("resolveConfig", () => {
  it("無使用者覆蓋時，應回傳 Recipe 預設 config", () => {
    const result = resolveConfig(baseRecipe);

    expect(result).toEqual({
      registry: "https://registry.npmjs.org",
      access: "public",
      tag: "latest",
    });
  });

  it("使用者覆蓋應優先於 Recipe 預設值（AC-3）", () => {
    const result = resolveConfig(baseRecipe, {
      registry: "https://private.registry.example.com",
      access: "restricted",
    });

    expect(result.registry).toBe("https://private.registry.example.com");
    expect(result.access).toBe("restricted");
    // 未覆蓋的欄位保持 Recipe 預設
    expect(result.tag).toBe("latest");
  });

  it("使用者可新增 Recipe 中沒有的 config key", () => {
    const result = resolveConfig(baseRecipe, {
      customKey: "custom-value",
    });

    expect(result.customKey).toBe("custom-value");
    expect(result.registry).toBe("https://registry.npmjs.org");
  });

  it("Recipe 無 config 時，應回傳使用者覆蓋的 config", () => {
    const recipeWithoutConfig: Recipe = {
      name: "minimal-recipe",
      steps: [{ run: "echo hello" }],
    };

    const result = resolveConfig(recipeWithoutConfig, { key: "value" });

    expect(result).toEqual({ key: "value" });
  });

  it("兩者皆無 config 時，應回傳空物件", () => {
    const recipeWithoutConfig: Recipe = {
      name: "minimal-recipe",
      steps: [{ run: "echo hello" }],
    };

    const result = resolveConfig(recipeWithoutConfig);

    expect(result).toEqual({});
  });

  it("使用者可用空字串覆蓋 Recipe 預設值", () => {
    const result = resolveConfig(baseRecipe, { tag: "" });

    expect(result.tag).toBe("");
  });
});
