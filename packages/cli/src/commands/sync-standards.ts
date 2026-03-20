/**
 * `devap sync-standards` 子命令 — 從 UDS upstream 同步最新標準
 *
 * 模式：
 * - 預設：執行同步（透過 npx uds init）
 * - --check：僅檢查版本是否落後（適合 CI），不實際同步
 * - --force：強制覆蓋本地修改
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import type { Command } from "commander";

/** manifest.json 中 upstream 區塊的型別 */
export interface UpstreamInfo {
  repo: string;
  version: string;
  installed: string;
}

/** manifest.json 的最小結構（只解析需要的欄位） */
export interface StandardsManifest {
  version: string;
  upstream: UpstreamInfo;
  skills?: {
    installed: boolean;
    version: string;
  };
}

export interface SyncOptions {
  check?: boolean;
  force?: boolean;
  target?: string;
}

export interface CheckResult {
  current: string;
  latest: string;
  upToDate: boolean;
  repo: string;
  installedAt: string;
  skillsVersion?: string;
  skillsAligned?: boolean;
}

/**
 * 讀取目標專案的 .standards/manifest.json
 */
export function readManifest(targetDir: string): StandardsManifest {
  const manifestPath = resolve(targetDir, ".standards", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `找不到 .standards/manifest.json（路徑：${manifestPath}）\n` +
        "請先執行 `uds init` 安裝 UDS 標準。",
    );
  }
  const content = readFileSync(manifestPath, "utf-8");
  const manifest: StandardsManifest = JSON.parse(content);

  if (!manifest.upstream?.repo || !manifest.upstream?.version) {
    throw new Error(
      "manifest.json 缺少 upstream.repo 或 upstream.version 欄位。\n" +
        "此 manifest 可能不是由 UDS CLI 產生的。",
    );
  }

  return manifest;
}

/**
 * 透過 GitHub API 取得 upstream repo 最新版本號
 *
 * 嘗試順序：
 * 1. GitHub API releases/latest
 * 2. 若無 release，嘗試 tags（取最新 semver tag）
 */
export async function fetchLatestVersion(repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "devap-cli",
      },
    });

    if (response.ok) {
      const data = (await response.json()) as { tag_name: string };
      // tag_name 可能帶 v 前綴，如 "v5.0.0"
      return data.tag_name.replace(/^v/, "");
    }

    // 無 release，嘗試 tags
    if (response.status === 404) {
      return await fetchLatestTag(repo);
    }

    throw new Error(`GitHub API 回傳 ${response.status}: ${response.statusText}`);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        "無法連線 GitHub API。請確認網路連線，或使用 --check 搭配離線比對。",
      );
    }
    throw error;
  }
}

/**
 * 從 GitHub tags API 取得最新版本號（fallback）
 */
async function fetchLatestTag(repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${repo}/tags?per_page=10`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "devap-cli",
    },
  });

  if (!response.ok) {
    throw new Error(
      `無法取得 ${repo} 的 tags（HTTP ${response.status}）。\n` +
        "請確認 repo 名稱正確且為公開 repo。",
    );
  }

  const tags = (await response.json()) as Array<{ name: string }>;
  if (tags.length === 0) {
    throw new Error(`${repo} 沒有任何 tag。`);
  }

  // 過濾 semver 格式的 tags，取第一個（GitHub 回傳最新在前）
  const semverTag = tags.find((t) =>
    /^v?\d+\.\d+\.\d+/.test(t.name),
  );

  if (!semverTag) {
    // 沒有 semver tag，回傳第一個
    return tags[0].name.replace(/^v/, "");
  }

  return semverTag.name.replace(/^v/, "");
}

/**
 * 比較兩個 semver 版本字串
 * @returns 負數=current較舊, 0=相同, 正數=current較新
 */
export function compareSemver(current: string, latest: string): number {
  const parseParts = (v: string) =>
    v
      .replace(/^v/, "")
      .split(/[-+]/)[0] // 去掉 pre-release 和 build metadata
      .split(".")
      .map(Number);

  const currentParts = parseParts(current);
  const latestParts = parseParts(latest);

  for (let i = 0; i < 3; i++) {
    const c = currentParts[i] ?? 0;
    const l = latestParts[i] ?? 0;
    if (c !== l) return c - l;
  }

  // 主版本相同，比較 pre-release（有 pre-release 的版本較舊）
  const currentPre = current.includes("-");
  const latestPre = latest.includes("-");
  if (currentPre && !latestPre) return -1;
  if (!currentPre && latestPre) return 1;

  return 0;
}

/**
 * 檢查版本狀態（不執行同步）
 */
export async function checkStandardsVersion(
  targetDir: string,
): Promise<CheckResult> {
  const manifest = readManifest(targetDir);
  const latest = await fetchLatestVersion(manifest.upstream.repo);

  const upToDate = compareSemver(manifest.upstream.version, latest) >= 0;

  const result: CheckResult = {
    current: manifest.upstream.version,
    latest,
    upToDate,
    repo: manifest.upstream.repo,
    installedAt: manifest.upstream.installed,
  };

  // 檢查 skills 版本是否與標準版本對齊
  if (manifest.skills?.version) {
    result.skillsVersion = manifest.skills.version;
    result.skillsAligned = manifest.skills.version === manifest.upstream.version;
  }

  return result;
}

/**
 * 檢查 uds CLI 是否可用
 */
export function isUdsAvailable(): boolean {
  try {
    execSync("npx --yes uds --version", {
      stdio: "pipe",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 執行 UDS 同步（透過 npx uds init）
 */
export function executeUdsSync(targetDir: string, force: boolean): void {
  const forceFlag = force ? " --force" : "";
  const cmd = `npx --yes uds init${forceFlag}`;

  console.log(`\n🔄 執行：${cmd}`);
  console.log(`📁 目標：${targetDir}\n`);

  try {
    execSync(cmd, {
      cwd: targetDir,
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch (error) {
    throw new Error(
      "UDS 同步失敗。請手動執行 `npx uds init` 查看錯誤細節。",
    );
  }
}

/**
 * 執行 sync-standards 命令的核心邏輯
 */
export async function executeSyncStandards(options: SyncOptions): Promise<void> {
  const targetDir = resolve(options.target ?? ".");

  // Step 1: 讀取本地 manifest
  const manifest = readManifest(targetDir);
  console.log(`📋 本地 UDS 版本：${manifest.upstream.version}`);
  console.log(`📦 上游 repo：${manifest.upstream.repo}`);
  console.log(`📅 安裝日期：${manifest.upstream.installed}`);

  // Step 2: 取得最新版本
  console.log("\n🔍 查詢上游最新版本...");
  const latest = await fetchLatestVersion(manifest.upstream.repo);
  console.log(`🏷️  上游最新版本：${latest}`);

  const upToDate = compareSemver(manifest.upstream.version, latest) >= 0;

  // Step 3: Skills 版本對齊檢查
  if (manifest.skills?.version) {
    const aligned = manifest.skills.version === manifest.upstream.version;
    if (aligned) {
      console.log(`✅ Skills 版本（${manifest.skills.version}）與標準對齊`);
    } else {
      console.warn(
        `⚠️  Skills 版本（${manifest.skills.version}）與標準版本（${manifest.upstream.version}）不一致`,
      );
    }
  }

  // Step 4: 版本比對
  if (upToDate) {
    console.log("\n✅ 標準已是最新版本，無需同步。");
    return;
  }

  console.log(
    `\n⬆️  發現新版本：${manifest.upstream.version} → ${latest}`,
  );

  // --check 模式：僅報告，不執行同步
  if (options.check) {
    console.log("\n⚠️  標準版本落後上游（--check 模式，不執行同步）");
    process.exit(1);
  }

  // Step 5: 執行同步
  executeUdsSync(targetDir, options.force ?? false);

  // Step 6: 驗證同步結果
  const updatedManifest = readManifest(targetDir);
  console.log(`\n✅ 同步完成！版本：${updatedManifest.upstream.version}`);
}

/**
 * 註冊 sync-standards 命令到 Commander program
 */
export function registerSyncStandardsCommand(program: Command): void {
  program
    .command("sync-standards")
    .description("從 UDS upstream 同步最新標準到 .standards/")
    .option("--check", "僅檢查版本是否落後（不執行同步，適合 CI）")
    .option("--force", "強制覆蓋本地修改")
    .option("--target <dir>", "指定目標專案路徑", ".")
    .action(async (opts: SyncOptions) => {
      try {
        await executeSyncStandards(opts);
      } catch (error) {
        console.error(
          "❌ 同步失敗：",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      }
    });
}
