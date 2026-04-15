/**
 * packaging-orchestrator 單元測試（SPEC-015 AC-1, AC-2）
 *
 * 測試策略：
 * - 使用真實臨時目錄模擬 recipes（避免 mock import 複雜度）
 * - dry-run 模式確保不實際執行命令
 * - 多 target 並行執行（AC-2：任一失敗不影響其他）
 * - 單一 target 篩選
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { orchestratePackaging } from "../../packaging/packaging-orchestrator.js";
import type { PackagingConfig } from "../../packaging/types.js";

const NPM_RECIPE_YAML = `
name: npm-cli
steps:
  - run: npm run build
    description: Build
  - run: npm publish
    description: Publish
config:
  registry: https://registry.npmjs.org
  access: public
`.trim();

const DOCKER_RECIPE_YAML = `
name: docker-service
steps:
  - run: docker build -t {registry}/app:latest .
    description: Build image
  - run: docker push {registry}/app:latest
    description: Push image
config:
  registry: ghcr.io
`.trim();

describe("orchestratePackaging", () => {
  let tmpDir: string;
  let recipesDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `devap-orchestrate-test-${Date.now()}`);
    recipesDir = join(tmpDir, "recipes");
    projectDir = join(tmpDir, "project");
    await mkdir(recipesDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    // 寫入測試用 recipes
    await writeFile(join(recipesDir, "npm-cli.yaml"), NPM_RECIPE_YAML);
    await writeFile(join(recipesDir, "docker-service.yaml"), DOCKER_RECIPE_YAML);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("基本功能（AC-1）", () => {
    it("應執行 config 中所有 targets 並回傳結果陣列", async () => {
      const config: PackagingConfig = {
        targets: [
          { recipe: "npm-cli" },
          { recipe: "docker-service" },
        ],
      };

      const results = await orchestratePackaging(config, projectDir, {
        dryRun: true,
        udsRecipesDir: recipesDir,
      });

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.target)).toContain("npm-cli");
      expect(results.map((r) => r.target)).toContain("docker-service");
    });

    it("dry-run 模式下所有 target 應成功", async () => {
      const config: PackagingConfig = {
        targets: [
          { recipe: "npm-cli" },
          { recipe: "docker-service" },
        ],
      };

      const results = await orchestratePackaging(config, projectDir, {
        dryRun: true,
        udsRecipesDir: recipesDir,
      });

      expect(results.every((r) => r.success)).toBe(true);
    });

    it("空 targets 陣列應回傳空結果", async () => {
      const config: PackagingConfig = { targets: [] };

      const results = await orchestratePackaging(config, projectDir, {
        dryRun: true,
        udsRecipesDir: recipesDir,
      });

      expect(results).toHaveLength(0);
    });
  });

  describe("並行執行（AC-2）", () => {
    it("任一 target recipe 不存在時，不影響其他 target 執行", async () => {
      const config: PackagingConfig = {
        targets: [
          { recipe: "npm-cli" },          // 存在
          { recipe: "nonexistent" },       // 不存在
          { recipe: "docker-service" },    // 存在
        ],
      };

      const results = await orchestratePackaging(config, projectDir, {
        dryRun: true,
        udsRecipesDir: recipesDir,
      });

      expect(results).toHaveLength(3);

      // npm-cli 和 docker-service 應成功
      const npmResult = results.find((r) => r.target === "npm-cli");
      const dockerResult = results.find((r) => r.target === "docker-service");
      expect(npmResult?.success).toBe(true);
      expect(dockerResult?.success).toBe(true);

      // nonexistent 應失敗但有錯誤訊息
      const failedResult = results.find((r) => !r.success);
      expect(failedResult).toBeDefined();
      expect(failedResult?.error).toBeDefined();
    });
  });

  describe("單一 target 篩選", () => {
    it("options.target 指定時只執行對應 target", async () => {
      const config: PackagingConfig = {
        targets: [
          { recipe: "npm-cli" },
          { recipe: "docker-service" },
        ],
      };

      const results = await orchestratePackaging(config, projectDir, {
        dryRun: true,
        udsRecipesDir: recipesDir,
        target: "npm-cli",
      });

      expect(results).toHaveLength(1);
      expect(results[0].target).toBe("npm-cli");
    });

    it("指定不存在的 target 名稱時應拋出錯誤", async () => {
      const config: PackagingConfig = {
        targets: [{ recipe: "npm-cli" }],
      };

      await expect(
        orchestratePackaging(config, projectDir, {
          dryRun: true,
          udsRecipesDir: recipesDir,
          target: "windows-installer",
        }),
      ).rejects.toThrow('找不到 target "windows-installer"');
    });
  });

  describe("config 覆蓋（AC-3）", () => {
    it("target config 覆蓋應在結果中生效（dry-run 不驗證命令執行，僅確認不報錯）", async () => {
      const config: PackagingConfig = {
        targets: [
          {
            recipe: "docker-service",
            config: { registry: "private.registry.example.com" },
          },
        ],
      };

      const results = await orchestratePackaging(config, projectDir, {
        dryRun: true,
        udsRecipesDir: recipesDir,
      });

      expect(results[0].success).toBe(true);
    });
  });
});
