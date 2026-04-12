/**
 * ArtifactWriter（SPEC-013 REQ-013-001）
 *
 * 將 artifact 字串內容寫入 .execution-history/{taskId}/{runNumber}/ 目錄。
 * 寫入前自動 redact 4 種敏感資料模式：
 *   1. sk-...         → [REDACTED:API_KEY]
 *   2. ghp_...        → [REDACTED:GITHUB_TOKEN]
 *   3. password: ...  → [REDACTED:PASSWORD]
 *   4. BEGIN PRIVATE KEY → [REDACTED:PRIVATE_KEY]
 */

import type { StorageBackend, ArtifactType, SensitivePattern } from "./types.js";

/** artifact 類型 → 副檔名對應表 */
const ARTIFACT_EXTENSIONS: Record<ArtifactType, string> = {
  "task-description": "md",
  "code-diff": "patch",
  "test-results": "json",
  "execution-log": "jsonl",
  "token-usage": "json",
  "final-status": "json",
  "error-analysis": "md",
  "agent-reasoning": "md",
};

/** 內建的 4 種敏感資料 pattern */
const BUILTIN_SENSITIVE: Array<{ regex: RegExp; label: string }> = [
  { regex: /sk-[A-Za-z0-9_-]{10,}/g, label: "API_KEY" },
  { regex: /ghp_[A-Za-z0-9]{10,}/g, label: "GITHUB_TOKEN" },
  { regex: /password\s*:\s*\S+/gi, label: "PASSWORD" },
  {
    regex: /-----BEGIN (?:\w+ )?PRIVATE KEY-----[\s\S]*?-----END (?:\w+ )?PRIVATE KEY-----/g,
    label: "PRIVATE_KEY",
  },
];

/**
 * 執行歷史 artifact 寫入器（SPEC-013）
 *
 * 不依賴 DevAP Task/TaskResult 型別，接受原始字串 content map。
 */
export class ArtifactWriter {
  private readonly patterns: Array<{ regex: RegExp; label: string }>;

  constructor(
    private readonly backend: StorageBackend,
    extraPatterns: SensitivePattern[] = [],
  ) {
    this.patterns = [...BUILTIN_SENSITIVE];
    for (const p of extraPatterns) {
      try {
        this.patterns.push({ regex: new RegExp(p.pattern, "g"), label: p.label });
      } catch {
        // 無效 regex 靜默忽略
      }
    }
  }

  /**
   * 寫入單次 run 的所有 artifacts。
   *
   * @param taskId   task 識別碼（路徑安全：不含 / 或 ..）
   * @param runNumber 三位數字字串，如 "001"
   * @param artifacts artifact 類型 → 原始字串 content map
   * @returns 實際寫入的 artifact 類型列表
   */
  async writeRun(
    taskId: string,
    runNumber: string,
    artifacts: Partial<Record<ArtifactType, string>>,
  ): Promise<string[]> {
    const written: string[] = [];
    const runDir = `${taskId}/${runNumber}`;

    for (const [artifactType, content] of Object.entries(artifacts) as Array<[ArtifactType, string | undefined]>) {
      if (content === undefined) continue;
      const ext = ARTIFACT_EXTENSIONS[artifactType] ?? "txt";
      const fileName = `${artifactType}.${ext}`;
      await this.backend.writeFile(`${runDir}/${fileName}`, this.redact(content));
      written.push(artifactType);
    }

    return written;
  }

  /** 清除文字中的敏感資訊 */
  redact(text: string): string {
    let result = text;
    for (const { regex, label } of this.patterns) {
      regex.lastIndex = 0;
      result = result.replace(regex, `[REDACTED:${label}]`);
    }
    return result;
  }
}
