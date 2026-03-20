import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readManifest,
  compareSemver,
  checkStandardsVersion,
  type StandardsManifest,
} from "../sync-standards.js";

/** 建立最小 manifest 用於測試 */
function createTestManifest(
  dir: string,
  overrides: Partial<StandardsManifest> = {},
): void {
  const manifestDir = join(dir, ".standards");
  mkdirSync(manifestDir, { recursive: true });

  const manifest: StandardsManifest = {
    version: "3.3.0",
    upstream: {
      repo: "AsiaOstrich/universal-dev-standards",
      version: "5.0.0-rc.4",
      installed: "2026-03-11",
    },
    ...overrides,
  };

  writeFileSync(
    join(manifestDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}

describe("readManifest", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "devap-sync-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("正常讀取 manifest", () => {
    createTestManifest(tempDir);
    const manifest = readManifest(tempDir);

    expect(manifest.upstream.repo).toBe("AsiaOstrich/universal-dev-standards");
    expect(manifest.upstream.version).toBe("5.0.0-rc.4");
    expect(manifest.upstream.installed).toBe("2026-03-11");
  });

  it("manifest 不存在時拋出錯誤", () => {
    expect(() => readManifest(tempDir)).toThrow("找不到 .standards/manifest.json");
  });

  it("manifest 缺少 upstream 欄位時拋出錯誤", () => {
    const manifestDir = join(tempDir, ".standards");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "manifest.json"),
      JSON.stringify({ version: "1.0.0" }),
    );

    expect(() => readManifest(tempDir)).toThrow("缺少 upstream.repo");
  });

  it("讀取含 skills 版本的 manifest", () => {
    createTestManifest(tempDir, {
      skills: { installed: true, version: "5.0.0-rc.4" },
    });
    const manifest = readManifest(tempDir);

    expect(manifest.skills?.version).toBe("5.0.0-rc.4");
  });
});

describe("compareSemver", () => {
  it("相同版本回傳 0", () => {
    expect(compareSemver("5.0.0", "5.0.0")).toBe(0);
  });

  it("current 較舊回傳負數", () => {
    expect(compareSemver("4.9.0", "5.0.0")).toBeLessThan(0);
    expect(compareSemver("5.0.0", "5.0.1")).toBeLessThan(0);
    expect(compareSemver("5.0.0", "5.1.0")).toBeLessThan(0);
  });

  it("current 較新回傳正數", () => {
    expect(compareSemver("5.1.0", "5.0.0")).toBeGreaterThan(0);
    expect(compareSemver("6.0.0", "5.9.9")).toBeGreaterThan(0);
  });

  it("pre-release 版本比正式版舊", () => {
    expect(compareSemver("5.0.0-rc.4", "5.0.0")).toBeLessThan(0);
  });

  it("正式版比 pre-release 新", () => {
    expect(compareSemver("5.0.0", "5.0.0-rc.4")).toBeGreaterThan(0);
  });

  it("兩個 pre-release 視為相同主版本", () => {
    expect(compareSemver("5.0.0-rc.3", "5.0.0-rc.4")).toBe(0);
  });

  it("處理 v 前綴", () => {
    expect(compareSemver("v5.0.0", "5.0.0")).toBe(0);
    expect(compareSemver("5.0.0", "v5.0.0")).toBe(0);
  });
});

describe("checkStandardsVersion", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "devap-check-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("版本落後時回傳 upToDate=false", async () => {
    createTestManifest(tempDir, {
      upstream: {
        repo: "AsiaOstrich/universal-dev-standards",
        version: "4.0.0",
        installed: "2026-01-01",
      },
    });

    // Mock fetch 回傳較新的版本
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v5.0.0" }),
      }),
    );

    const result = await checkStandardsVersion(tempDir);

    expect(result.current).toBe("4.0.0");
    expect(result.latest).toBe("5.0.0");
    expect(result.upToDate).toBe(false);
  });

  it("版本最新時回傳 upToDate=true", async () => {
    createTestManifest(tempDir, {
      upstream: {
        repo: "AsiaOstrich/universal-dev-standards",
        version: "5.0.0",
        installed: "2026-03-11",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v5.0.0" }),
      }),
    );

    const result = await checkStandardsVersion(tempDir);

    expect(result.upToDate).toBe(true);
  });

  it("Skills 版本不對齊時標記 skillsAligned=false", async () => {
    createTestManifest(tempDir, {
      upstream: {
        repo: "AsiaOstrich/universal-dev-standards",
        version: "5.0.0",
        installed: "2026-03-11",
      },
      skills: { installed: true, version: "4.9.0" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v5.0.0" }),
      }),
    );

    const result = await checkStandardsVersion(tempDir);

    expect(result.skillsVersion).toBe("4.9.0");
    expect(result.skillsAligned).toBe(false);
  });

  it("Skills 版本對齊時標記 skillsAligned=true", async () => {
    createTestManifest(tempDir, {
      upstream: {
        repo: "AsiaOstrich/universal-dev-standards",
        version: "5.0.0",
        installed: "2026-03-11",
      },
      skills: { installed: true, version: "5.0.0" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v5.0.0" }),
      }),
    );

    const result = await checkStandardsVersion(tempDir);

    expect(result.skillsAligned).toBe(true);
  });

  it("GitHub API 回傳 404 時 fallback 到 tags", async () => {
    createTestManifest(tempDir, {
      upstream: {
        repo: "AsiaOstrich/universal-dev-standards",
        version: "4.0.0",
        installed: "2026-01-01",
      },
    });

    const mockFetch = vi.fn()
      // 第一次呼叫 releases/latest 回傳 404
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })
      // 第二次呼叫 tags 回傳結果
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { name: "v5.1.0" },
            { name: "v5.0.0" },
          ]),
      });

    vi.stubGlobal("fetch", mockFetch);

    const result = await checkStandardsVersion(tempDir);

    expect(result.latest).toBe("5.1.0");
    expect(result.upToDate).toBe(false);
  });
});
