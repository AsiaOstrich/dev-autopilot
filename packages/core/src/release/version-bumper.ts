/**
 * VersionBumper — 跨多檔案原子性版本 bump（XSPEC-089 F-003a / AC-A2/A3）
 *
 * 職責：
 * - 從 .devap/release-config.json 讀取版本檔配置
 * - 計算新版本號（semver: major/minor/patch/prerelease）
 * - 原子性寫入：全部成功或全部回復
 *
 * 不負責：git 操作、CHANGELOG（由 ChangelogUpdater 處理）。
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type BumpLevel = "major" | "minor" | "patch" | "prerelease";

/** 單一版本檔的更新規則 */
export interface VersionFileSpec {
  /** 相對於 root 的路徑 */
  path: string;
  /** JSON 欄位路徑（支援點記號，如 "repositories.standards.version"） */
  field?: string;
  /** 多個 JSON 欄位路徑（同一檔案內多個欄位需同步更新） */
  fields?: string[];
  /** 文字檔案的 regex 樣式（含 {version} 佔位符） */
  pattern?: string;
}

/** 完整版本 bump 計畫（apply 前可預覽） */
export interface VersionBumpPlan {
  /** 舊版本號 */
  from: string;
  /** 新版本號 */
  to: string;
  /** 每個檔案的計畫變更 */
  files: Array<{
    path: string;
    /** 變更前完整內容（用於 rollback） */
    oldContent: string;
    /** 變更後完整內容 */
    newContent: string;
  }>;
}

/**
 * 計算下一個版本號（純函式，便於測試）
 *
 * 規則（簡化版 semver）：
 * - patch: 5.3.2 → 5.3.3（清除 prerelease）
 * - minor: 5.3.2 → 5.4.0（清除 prerelease）
 * - major: 5.3.2 → 6.0.0（清除 prerelease）
 * - prerelease：
 *   - 5.3.2 → 5.3.3-0
 *   - 5.4.0-beta.1 → 5.4.0-beta.2（保留 identifier）
 *   - 5.4.0-0 → 5.4.0-1
 */
export function bumpVersion(current: string, level: BumpLevel): string {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    throw new Error(`VersionBumper: 不支援的版本格式 '${current}'（需為 X.Y.Z 或 X.Y.Z-suffix）`);
  }
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = parseInt(match[3], 10);
  const prerelease = match[4];

  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "prerelease": {
      if (!prerelease) {
        // 無 prerelease → bump patch 後加 -0
        return `${major}.${minor}.${patch + 1}-0`;
      }
      // 有 prerelease：找尾端數字並 +1，或追加 .1
      const numMatch = prerelease.match(/^(.*?)(\d+)$/);
      if (numMatch) {
        const prefix = numMatch[1];
        const num = parseInt(numMatch[2], 10);
        return `${major}.${minor}.${patch}-${prefix}${num + 1}`;
      }
      // 無尾端數字 → 追加 .1
      return `${major}.${minor}.${patch}-${prerelease}.1`;
    }
    default:
      throw new Error(`VersionBumper: 未知 bump level '${level as string}'`);
  }
}

/** 依點記號路徑取得 JSON 物件中的值 */
function getJsonField(obj: unknown, fieldPath: string): unknown {
  const parts = fieldPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 依點記號路徑設定 JSON 物件中的值（mutates obj） */
function setJsonField(obj: unknown, fieldPath: string, value: unknown): void {
  const parts = fieldPath.split(".");
  let current = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = current[parts[i]];
    if (typeof next !== "object" || next === null) {
      throw new Error(`VersionBumper: 路徑 '${fieldPath}' 在 '${parts[i]}' 處中斷`);
    }
    current = next as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export class VersionBumper {
  constructor(
    private readonly rootDir: string,
    private readonly versionFiles: VersionFileSpec[]
  ) {
    if (versionFiles.length === 0) {
      throw new Error("VersionBumper: versionFiles 不可為空");
    }
  }

  /**
   * 讀取目前版本號（從第一個版本檔的第一個 field/fields 取得）
   */
  async readCurrentVersion(): Promise<string> {
    const first = this.versionFiles[0];
    const filePath = path.join(this.rootDir, first.path);
    const content = await fs.readFile(filePath, "utf-8");

    if (first.field) {
      const json = JSON.parse(content) as unknown;
      const v = getJsonField(json, first.field);
      if (typeof v !== "string") {
        throw new Error(`VersionBumper: ${first.path}.${first.field} 不是字串`);
      }
      return v;
    }

    if (first.fields && first.fields.length > 0) {
      const json = JSON.parse(content) as unknown;
      const v = getJsonField(json, first.fields[0]);
      if (typeof v !== "string") {
        throw new Error(`VersionBumper: ${first.path}.${first.fields[0]} 不是字串`);
      }
      return v;
    }

    throw new Error(`VersionBumper: ${first.path} 缺少 field 或 fields 設定，無法讀取版本`);
  }

  /**
   * 產生 bump 計畫（讀取所有檔案、計算變更，但不寫入）
   *
   * 用於 --dry-run 預覽，或 apply() 前的暫存。
   */
  async plan(level: BumpLevel): Promise<VersionBumpPlan> {
    const from = await this.readCurrentVersion();
    const to = bumpVersion(from, level);
    return this.planForVersion(from, to);
  }

  /**
   * 給定明確的 from/to，產生計畫（測試友善）
   */
  async planForVersion(from: string, to: string): Promise<VersionBumpPlan> {
    const files: VersionBumpPlan["files"] = [];

    for (const spec of this.versionFiles) {
      const filePath = path.join(this.rootDir, spec.path);
      const oldContent = await fs.readFile(filePath, "utf-8");
      const newContent = this.applyToContent(oldContent, spec, from, to);
      files.push({ path: filePath, oldContent, newContent });
    }

    return { from, to, files };
  }

  /**
   * 原子性寫入計畫中的所有變更。
   *
   * 若任一寫入失敗，已寫入的檔案會被還原為 oldContent。
   *
   * @throws 第一個寫入失敗的錯誤（rollback 後拋出）
   */
  async apply(plan: VersionBumpPlan): Promise<void> {
    const writtenPaths: string[] = [];
    const oldContents = new Map<string, string>();
    plan.files.forEach((f) => oldContents.set(f.path, f.oldContent));

    try {
      for (const file of plan.files) {
        await fs.writeFile(file.path, file.newContent, "utf-8");
        writtenPaths.push(file.path);
      }
    } catch (e) {
      // Rollback：還原所有已寫入的檔案
      const rollbackErrors: string[] = [];
      for (const writtenPath of writtenPaths) {
        const original = oldContents.get(writtenPath);
        if (original === undefined) continue;
        try {
          await fs.writeFile(writtenPath, original, "utf-8");
        } catch (rollbackErr) {
          rollbackErrors.push(`${writtenPath}: ${(rollbackErr as Error).message}`);
        }
      }
      const baseMsg = `VersionBumper: 寫入失敗並已嘗試 rollback — ${(e as Error).message}`;
      if (rollbackErrors.length > 0) {
        throw new Error(`${baseMsg}（rollback 部分失敗：${rollbackErrors.join("; ")}）`);
      }
      throw new Error(baseMsg);
    }
  }

  /** 對單一檔案內容套用版本變更（純函式） */
  private applyToContent(
    oldContent: string,
    spec: VersionFileSpec,
    from: string,
    to: string
  ): string {
    if (spec.field || spec.fields) {
      const json = JSON.parse(oldContent) as unknown;
      const fields = spec.field ? [spec.field] : spec.fields!;
      for (const fieldPath of fields) {
        const current = getJsonField(json, fieldPath);
        if (current !== from && current !== undefined) {
          // 容忍：警告但不阻斷（實務上各檔可能版本不同步，bump 一律寫成 to）
        }
        setJsonField(json, fieldPath, to);
      }
      // 保留結尾換行（多數編輯器/格式化工具的慣例）
      const trailingNewline = oldContent.endsWith("\n") ? "\n" : "";
      return JSON.stringify(json, null, 2) + trailingNewline;
    }

    if (spec.pattern) {
      // Literal 字串替換語意：pattern 中的 {version} 為唯一佔位符。
      // 不使用 regex —— 較直觀，避免使用者需要 regex-escape 特殊字元（**、.、 等）。
      const fromString = spec.pattern.replace("{version}", from);
      const toString = spec.pattern.replace("{version}", to);
      if (!oldContent.includes(fromString)) {
        throw new Error(
          `VersionBumper: ${spec.path} 找不到符合樣式的版本字串（pattern: '${spec.pattern}', from: '${from}'）`
        );
      }
      return oldContent.split(fromString).join(toString);
    }

    throw new Error(`VersionBumper: ${spec.path} 缺少 field/fields/pattern`);
  }
}
