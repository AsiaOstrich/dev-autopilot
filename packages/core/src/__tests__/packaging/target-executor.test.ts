/**
 * target-executor 單元測試（SPEC-015 AC-4）
 *
 * 測試策略：
 * - dry-run 模式：只印出命令，不實際執行（mock child_process.exec）
 * - placeholder 替換邏輯
 * - hooks 執行順序
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeTarget, interpolateCommand } from "../../packaging/target-executor.js";
import type { PackagingTarget, Recipe } from "../../packaging/types.js";

// Mock child_process exec
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

import { exec } from "node:child_process";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExec = exec as unknown as ReturnType<typeof vi.fn>;

const baseRecipe: Recipe = {
  name: "test-recipe",
  steps: [
    { run: "echo build", description: "Build step" },
    { run: "echo publish", description: "Publish step" },
  ],
  config: {
    registry: "https://registry.example.com",
    access: "public",
  },
};

const baseTarget: PackagingTarget = {
  recipe: "test-recipe",
};

describe("interpolateCommand", () => {
  it("應替換 {key} 佔位符", () => {
    const result = interpolateCommand(
      "docker push {registry}/{name}:{version}",
      { registry: "ghcr.io", name: "myapp", version: "1.0.0" },
    );
    expect(result).toBe("docker push ghcr.io/myapp:1.0.0");
  });

  it("config 中不存在的 key 應保持原樣", () => {
    const result = interpolateCommand(
      "echo {known} and {unknown}",
      { known: "hello" },
    );
    expect(result).toBe("echo hello and {unknown}");
  });

  it("無佔位符的命令應原樣返回", () => {
    const result = interpolateCommand("npm run build", {});
    expect(result).toBe("npm run build");
  });

  it("同一 key 出現多次時應全部替換", () => {
    const result = interpolateCommand(
      "{name}:{version} and again {name}",
      { name: "app", version: "2.0" },
    );
    expect(result).toBe("app:2.0 and again app");
  });
});

describe("executeTarget", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("dry-run 模式", () => {
    it("dry-run 時不應呼叫 exec", async () => {
      const result = await executeTarget(baseTarget, baseRecipe, "/tmp/project", true);

      expect(mockExec).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("dry-run 時應印出將執行的命令", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await executeTarget(baseTarget, baseRecipe, "/tmp/project", true);

      const allLogs = logSpy.mock.calls.flat().join(" ");
      expect(allLogs).toContain("[dry-run]");
      expect(allLogs).toContain("echo build");
      expect(allLogs).toContain("echo publish");

      logSpy.mockRestore();
    });

    it("dry-run 時 preBuild hook 也應被印出但不執行", async () => {
      const targetWithHook: PackagingTarget = {
        recipe: "test-recipe",
        hooks: { preBuild: "npm run generate-types" },
      };

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await executeTarget(targetWithHook, baseRecipe, "/tmp/project", true);

      const allLogs = logSpy.mock.calls.flat().join(" ");
      expect(allLogs).toContain("npm run generate-types");
      expect(allLogs).toContain("[dry-run]");

      logSpy.mockRestore();
    });
  });

  describe("佔位符替換", () => {
    it("步驟命令中的 {key} 應被 config 值替換", async () => {
      const recipeWithPlaceholder: Recipe = {
        name: "docker-recipe",
        steps: [{ run: "docker push {registry}/app:latest" }],
        config: { registry: "ghcr.io" },
      };

      await executeTarget(baseTarget, recipeWithPlaceholder, "/tmp", true);

      // dry-run 模式下應印出替換後的命令
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await executeTarget(baseTarget, recipeWithPlaceholder, "/tmp", true);
      const allLogs = logSpy.mock.calls.flat().join(" ");
      expect(allLogs).toContain("docker push ghcr.io/app:latest");
      logSpy.mockRestore();
    });

    it("使用者 config 覆蓋應在命令替換中生效", async () => {
      const recipeWithPlaceholder: Recipe = {
        name: "npm-recipe",
        steps: [{ run: "npm publish --registry {registry}" }],
        config: { registry: "https://registry.npmjs.org" },
      };

      const targetWithOverride: PackagingTarget = {
        recipe: "npm-recipe",
        config: { registry: "https://private.example.com" },
      };

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await executeTarget(targetWithOverride, recipeWithPlaceholder, "/tmp", true);

      const allLogs = logSpy.mock.calls.flat().join(" ");
      expect(allLogs).toContain("https://private.example.com");
      expect(allLogs).not.toContain("https://registry.npmjs.org");
      logSpy.mockRestore();
    });
  });

  describe("hooks 執行順序（AC-4）", () => {
    it("應在 recipe steps 前執行 preBuild hook（dry-run 驗證順序）", async () => {
      const recipeWithHook: Recipe = {
        name: "hook-recipe",
        steps: [{ run: "step-command" }],
        hooks: { preBuild: "recipe-pre-build-hook" },
      };

      const targetWithHook: PackagingTarget = {
        recipe: "hook-recipe",
        hooks: { preBuild: "user-pre-build-hook" },
      };

      const executedCommands: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
        if (msg.includes("[dry-run]")) {
          executedCommands.push(msg);
        }
      });

      await executeTarget(targetWithHook, recipeWithHook, "/tmp", true);

      // target.hooks.preBuild 應優先於 recipe.hooks.preBuild
      expect(executedCommands[0]).toContain("user-pre-build-hook");
      expect(executedCommands[1]).toContain("step-command");
      logSpy.mockRestore();
    });
  });

  describe("回傳值", () => {
    it("dry-run 成功時應回傳 success: true", async () => {
      const result = await executeTarget(baseTarget, baseRecipe, "/tmp", true);

      expect(result.success).toBe(true);
      expect(result.target).toBe("test-recipe");
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });
  });
});
