/**
 * ChangelogUpdater — 更新 CHANGELOG.md 加入新版本段落（XSPEC-089 F-003a / AC-A4）
 *
 * 規則：
 * - 在第一個 `## [X.Y.Z]` 段落之前插入新段落
 * - 若無既有版本段落，插入於第一個 `## ` 標題前；若連 `## ` 都沒有，附加到結尾
 * - 既有段落內容完全保留
 *
 * 不負責：i18n 三語版本同步（由呼叫端對每個 locale 各自 invoke）。
 */

import { promises as fs } from "node:fs";

/** CHANGELOG 更新計畫（apply 前可預覽） */
export interface ChangelogUpdatePlan {
  path: string;
  oldContent: string;
  newContent: string;
}

export class ChangelogUpdater {
  constructor(private readonly changelogPath: string) {}

  /**
   * 產生計畫（不寫入）。
   *
   * @param version - 新版本號（不含 `v` 前綴）
   * @param date - YYYY-MM-DD 格式日期
   * @param body - 段落內容（不含標題行；若省略則只有空白段落供之後手動編輯）
   */
  async plan(version: string, date: string, body?: string): Promise<ChangelogUpdatePlan> {
    const oldContent = await fs.readFile(this.changelogPath, "utf-8");
    const newContent = this.computeNewContent(oldContent, version, date, body);
    return { path: this.changelogPath, oldContent, newContent };
  }

  /** 寫入計畫 */
  async apply(plan: ChangelogUpdatePlan): Promise<void> {
    await fs.writeFile(plan.path, plan.newContent, "utf-8");
  }

  /** 純函式：給定舊內容 + 版本 + 日期，回傳新內容 */
  computeNewContent(oldContent: string, version: string, date: string, body?: string): string {
    const newSection = ChangelogUpdater.buildSection(version, date, body);

    // 尋找第一個版本段落 `## [X.Y.Z]` 或 `## [Unreleased]`
    const versionHeaderRegex = /^## \[[^\]]+\]/m;
    const match = oldContent.match(versionHeaderRegex);

    if (match && match.index !== undefined) {
      const before = oldContent.slice(0, match.index);
      const after = oldContent.slice(match.index);
      return `${before}${newSection}\n${after}`;
    }

    // 無既有版本段落：尋找第一個 `## ` 標題
    const anyHeaderMatch = oldContent.match(/^## /m);
    if (anyHeaderMatch && anyHeaderMatch.index !== undefined) {
      const before = oldContent.slice(0, anyHeaderMatch.index);
      const after = oldContent.slice(anyHeaderMatch.index);
      return `${before}${newSection}\n${after}`;
    }

    // 完全沒有 `## ` 標題：附加到結尾
    const sep = oldContent.endsWith("\n") ? "" : "\n";
    return `${oldContent}${sep}\n${newSection}\n`;
  }

  /** 建構單一版本段落（純靜態函式） */
  static buildSection(version: string, date: string, body?: string): string {
    const header = `## [${version}] - ${date}`;
    if (body && body.trim() !== "") {
      return `${header}\n\n${body.trim()}\n`;
    }
    return `${header}\n`;
  }
}
