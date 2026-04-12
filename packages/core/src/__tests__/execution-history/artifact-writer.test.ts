/**
 * ArtifactWriter 測試（SPEC-013 REQ-013-001）
 *
 * 全部使用 mock StorageBackend，不寫入真實目錄。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactWriter } from "../../execution-history/artifact-writer.js";
import type { StorageBackend } from "../../execution-history/types.js";

function makeMockBackend(): StorageBackend & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    readFile: vi.fn(async () => null),
    writeFile: vi.fn(async (path: string, content: string) => {
      written.set(path, content);
    }),
    deleteFile: vi.fn(async () => {}),
    deleteDir: vi.fn(async () => {}),
    listDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
  };
}

describe("ArtifactWriter（SPEC-013）", () => {
  let backend: ReturnType<typeof makeMockBackend>;
  let writer: ArtifactWriter;

  beforeEach(() => {
    backend = makeMockBackend();
    writer = new ArtifactWriter(backend);
  });

  // ─── Artifact 寫入 ─────────────────────────────────────────────────────────

  it("[AC-1] 寫入 task-description 時副檔名為 .md", async () => {
    await writer.writeRun("task-001", "001", { "task-description": "# Hello" });
    expect(backend.written.has("task-001/001/task-description.md")).toBe(true);
  });

  it("[AC-1] 寫入 code-diff 時副檔名為 .patch", async () => {
    await writer.writeRun("task-001", "001", { "code-diff": "diff --git a/x\n" });
    expect(backend.written.has("task-001/001/code-diff.patch")).toBe(true);
  });

  it("[AC-1] 寫入 test-results 時副檔名為 .json", async () => {
    await writer.writeRun("task-001", "001", { "test-results": "{}" });
    expect(backend.written.has("task-001/001/test-results.json")).toBe(true);
  });

  it("[AC-1] 寫入 execution-log 時副檔名為 .jsonl", async () => {
    await writer.writeRun("task-001", "001", { "execution-log": '{"t":"2026"}' });
    expect(backend.written.has("task-001/001/execution-log.jsonl")).toBe(true);
  });

  it("[AC-1] 寫入 token-usage 時副檔名為 .json", async () => {
    await writer.writeRun("task-001", "001", { "token-usage": "{}" });
    expect(backend.written.has("task-001/001/token-usage.json")).toBe(true);
  });

  it("[AC-1] 寫入 final-status 時副檔名為 .json", async () => {
    await writer.writeRun("task-001", "001", { "final-status": "{}" });
    expect(backend.written.has("task-001/001/final-status.json")).toBe(true);
  });

  it("[AC-1] writeRun 回傳實際寫入的 artifact 類型列表", async () => {
    const written = await writer.writeRun("task-001", "001", {
      "task-description": "# T",
      "final-status": "{}",
    });
    expect(written).toEqual(expect.arrayContaining(["task-description", "final-status"]));
    expect(written).toHaveLength(2);
  });

  // ─── Sensitive Data Redaction ──────────────────────────────────────────────

  it("[AC-2] sk-... API key 被 redact 為 [REDACTED:API_KEY]", async () => {
    await writer.writeRun("task-001", "001", {
      "execution-log": "呼叫 API，key=sk-ant-abc1234567890xyz",
    });
    const content = backend.written.get("task-001/001/execution-log.jsonl")!;
    expect(content).toContain("[REDACTED:API_KEY]");
    expect(content).not.toContain("sk-ant-abc");
  });

  it("[AC-2] ghp_... GitHub token 被 redact 為 [REDACTED:GITHUB_TOKEN]", async () => {
    await writer.writeRun("task-001", "001", {
      "task-description": "token=ghp_abcdefghij1234567890",
    });
    const content = backend.written.get("task-001/001/task-description.md")!;
    expect(content).toContain("[REDACTED:GITHUB_TOKEN]");
    expect(content).not.toContain("ghp_abcdef");
  });

  it("[AC-2] password: ... 被 redact 為 [REDACTED:PASSWORD]", async () => {
    await writer.writeRun("task-001", "001", {
      "final-status": '{"message":"password: supersecret123"}',
    });
    const content = backend.written.get("task-001/001/final-status.json")!;
    expect(content).toContain("[REDACTED:PASSWORD]");
    expect(content).not.toContain("supersecret123");
  });

  it("[AC-2] BEGIN PRIVATE KEY 區塊被 redact 為 [REDACTED:PRIVATE_KEY]", async () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG\n-----END PRIVATE KEY-----";
    await writer.writeRun("task-001", "001", { "code-diff": pem });
    const content = backend.written.get("task-001/001/code-diff.patch")!;
    expect(content).toContain("[REDACTED:PRIVATE_KEY]");
    expect(content).not.toContain("MIIEvQIBADANBgkqhkiG");
  });

  it("[AC-2] 無敏感資料時內容不變", async () => {
    const original = "# 普通任務描述\n這段沒有敏感資訊";
    await writer.writeRun("task-001", "001", { "task-description": original });
    const content = backend.written.get("task-001/001/task-description.md")!;
    expect(content).toBe(original);
  });
});
