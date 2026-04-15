/**
 * recipe-loader 單元測試（SPEC-015 AC-5, AC-10）
 *
 * 測試策略：
 * - 使用臨時目錄模擬 recipes 目錄
 * - 測試內建 Recipe、自訂 Recipe、缺少必填欄位時的報錯
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRecipe } from "../../packaging/recipe-loader.js";

// 最小合法 Recipe YAML
const VALID_RECIPE_YAML = `
name: test-recipe
description: Test recipe for unit tests
steps:
  - run: echo hello
    description: Say hello
  - run: echo world
config:
  registry: https://registry.example.com
`.trim();

// 缺少 name 的 Recipe
const MISSING_NAME_YAML = `
steps:
  - run: echo hello
`.trim();

// 缺少 steps 的 Recipe
const MISSING_STEPS_YAML = `
name: no-steps-recipe
`.trim();

// steps 為空陣列
const EMPTY_STEPS_YAML = `
name: empty-steps-recipe
steps: []
`.trim();

// step 缺少 run 的 Recipe
const STEP_MISSING_RUN_YAML = `
name: bad-step-recipe
steps:
  - description: no run field
`.trim();

describe("loadRecipe", () => {
  let tmpDir: string;
  let recipesDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `devap-test-${Date.now()}`);
    recipesDir = join(tmpDir, "recipes");
    projectDir = join(tmpDir, "project");
    await mkdir(recipesDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("內建 Recipe（無 ./ 前綴）", () => {
    it("應成功載入合法的內建 Recipe", async () => {
      await writeFile(join(recipesDir, "npm-cli.yaml"), VALID_RECIPE_YAML);

      const recipe = await loadRecipe("npm-cli", projectDir, recipesDir);

      expect(recipe.name).toBe("test-recipe");
      expect(recipe.steps).toHaveLength(2);
      expect(recipe.steps[0].run).toBe("echo hello");
      expect(recipe.config?.registry).toBe("https://registry.example.com");
    });

    it("應在 Recipe 檔案不存在時拋出友善錯誤", async () => {
      await expect(
        loadRecipe("nonexistent-recipe", projectDir, recipesDir),
      ).rejects.toThrow('無法載入 Recipe "nonexistent-recipe"');
    });
  });

  describe("自訂 Recipe（./ 前綴）", () => {
    it("應從專案目錄載入自訂 Recipe", async () => {
      const customRecipeDir = join(projectDir, ".devap", "recipes");
      await mkdir(customRecipeDir, { recursive: true });
      await writeFile(join(customRecipeDir, "my-installer.yaml"), VALID_RECIPE_YAML);

      const recipe = await loadRecipe(
        "./.devap/recipes/my-installer.yaml",
        projectDir,
        recipesDir,
      );

      expect(recipe.name).toBe("test-recipe");
    });

    it("應在自訂 Recipe 不存在時拋出錯誤", async () => {
      await expect(
        loadRecipe("./recipes/missing.yaml", projectDir, recipesDir),
      ).rejects.toThrow("無法載入 Recipe");
    });
  });

  describe("必填欄位驗證（AC-10）", () => {
    it("缺少 name 時應拋出明確錯誤訊息", async () => {
      await writeFile(join(recipesDir, "bad-recipe.yaml"), MISSING_NAME_YAML);

      await expect(
        loadRecipe("bad-recipe", projectDir, recipesDir),
      ).rejects.toThrow('缺少必填欄位 "name"');
    });

    it("缺少 steps 時應拋出明確錯誤訊息", async () => {
      await writeFile(join(recipesDir, "bad-recipe.yaml"), MISSING_STEPS_YAML);

      await expect(
        loadRecipe("bad-recipe", projectDir, recipesDir),
      ).rejects.toThrow('缺少必填欄位 "steps"');
    });

    it("steps 為空陣列時應拋出錯誤", async () => {
      await writeFile(join(recipesDir, "bad-recipe.yaml"), EMPTY_STEPS_YAML);

      await expect(
        loadRecipe("bad-recipe", projectDir, recipesDir),
      ).rejects.toThrow('缺少必填欄位 "steps"');
    });

    it("step 缺少 run 欄位時應拋出錯誤", async () => {
      await writeFile(join(recipesDir, "bad-recipe.yaml"), STEP_MISSING_RUN_YAML);

      await expect(
        loadRecipe("bad-recipe", projectDir, recipesDir),
      ).rejects.toThrow('缺少必填欄位 "run"');
    });
  });
});
