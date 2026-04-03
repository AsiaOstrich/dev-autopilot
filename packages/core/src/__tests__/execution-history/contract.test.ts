// @ts-nocheck — ajv ESM/CJS interop 型別問題，合約測試不需嚴格型別檢查
/**
 * Execution History 合約測試（DEC-004 跨專案測試策略）
 *
 * 驗證 HistoryWriter 產出的 JSON artifacts 符合 UDS 匯出的 JSON Schema。
 * Schema 來源：specs/schemas/execution-history-*.schema.json
 *
 * 合約測試確保：
 * 1. DevAP（生產者）產出的格式符合 UDS（消費者）的期望
 * 2. Schema 變更時自動偵測不相容
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HistoryWriter } from "../../execution-history/writer.js";
import type { StorageBackend, ExecutionHistoryConfig } from "../../execution-history/types.js";
import type { Task, TaskResult } from "../../types.js";

// ============================================================
// Schema 載入
// ============================================================

const SCHEMA_DIR = join(__dirname, "../../../../../specs/schemas");

let ajv: InstanceType<typeof Ajv>;
let schemas: Record<string, object>;

beforeAll(async () => {
  ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  const schemaFiles = [
    "execution-history-index.schema.json",
    "execution-history-manifest.schema.json",
    "execution-history-test-results.schema.json",
    "execution-history-log-entry.schema.json",
    "execution-history-token-usage.schema.json",
    "execution-history-final-status.schema.json",
  ];

  schemas = {};
  for (const file of schemaFiles) {
    const content = await readFile(join(SCHEMA_DIR, file), "utf-8");
    const schema = JSON.parse(content);
    schemas[file.replace(".schema.json", "")] = schema;
    ajv.addSchema(schema);
  }
});

// ============================================================
// Writer 產出捕獲
// ============================================================

function createCaptureBackend(): StorageBackend & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    readFile: vi.fn(async () => null),
    writeFile: vi.fn(async (path: string, content: string) => { written.set(path, content); }),
    deleteFile: vi.fn(async () => {}),
    deleteDir: vi.fn(async () => {}),
    listDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
  };
}

const cfg: ExecutionHistoryConfig = { enabled: true };

const task: Task = {
  id: "T-001",
  title: "實作認證模組",
  spec: "使用 bcrypt 雜湊密碼",
  acceptance_criteria: ["登入成功回傳 token"],
};

const successResult: TaskResult = {
  task_id: "T-001",
  status: "success",
  cost_usd: 0.5,
  duration_ms: 30000,
  verification_evidence: [
    { command: "pnpm test", exit_code: 0, output: "5 passed", timestamp: "2026-04-02T10:00:00Z" },
  ],
};

const failedResult: TaskResult = {
  task_id: "T-001",
  status: "failed",
  cost_usd: 1.0,
  duration_ms: 60000,
  error: "test exit code 1",
};

const ctx = {
  codeDiff: "diff --git a/src/auth.ts\n+export function login() {}",
  executionLog: [
    { timestamp: "2026-04-02T10:00:00Z", message: "[T-001] 開始執行" },
    { timestamp: "2026-04-02T10:00:30Z", message: "[T-001] 完成" },
  ],
};

// ============================================================
// 合約測試
// ============================================================

describe("Execution History 合約測試（UDS Schema 驗證）", () => {
  describe("index.json 符合 execution-history-index schema", () => {
    it("成功 task 的 index.json 應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, successResult, ctx);

      const indexJson = backend.written.get("index.json");
      expect(indexJson).toBeDefined();

      const data = JSON.parse(indexJson!);
      const valid = ajv.validate(schemas["execution-history-index"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });
  });

  describe("manifest.json 符合 execution-history-manifest schema", () => {
    it("成功 task 的 manifest.json 應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, successResult, ctx);

      const manifestJson = backend.written.get("T-001/manifest.json");
      expect(manifestJson).toBeDefined();

      const data = JSON.parse(manifestJson!);
      const valid = ajv.validate(schemas["execution-history-manifest"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("失敗 task 的 manifest.json（含 failure_summary）應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, failedResult, { ...ctx, previousAttempts: [] });

      const manifestJson = backend.written.get("T-001/manifest.json");
      const data = JSON.parse(manifestJson!);
      const valid = ajv.validate(schemas["execution-history-manifest"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });
  });

  describe("test-results.json 符合 execution-history-test-results schema", () => {
    it("有 verification_evidence 時應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, successResult, ctx);

      const json = backend.written.get("T-001/001/test-results.json");
      expect(json).toBeDefined();

      const data = JSON.parse(json!);
      const valid = ajv.validate(schemas["execution-history-test-results"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("verification_evidence 為空時（空陣列）應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, { ...successResult, verification_evidence: undefined }, ctx);

      const json = backend.written.get("T-001/001/test-results.json");
      const data = JSON.parse(json!);
      const valid = ajv.validate(schemas["execution-history-test-results"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });
  });

  describe("execution-log.jsonl 每行符合 execution-history-log-entry schema", () => {
    it("每行 JSON 應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, successResult, ctx);

      const jsonl = backend.written.get("T-001/001/execution-log.jsonl");
      expect(jsonl).toBeDefined();

      const lines = jsonl!.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        const entry = JSON.parse(line);
        const valid = ajv.validate(schemas["execution-history-log-entry"], entry);
        expect(ajv.errors).toBeNull();
        expect(valid).toBe(true);
      }
    });
  });

  describe("token-usage.json 符合 execution-history-token-usage schema", () => {
    it("應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, successResult, ctx);

      const json = backend.written.get("T-001/001/token-usage.json");
      expect(json).toBeDefined();

      const data = JSON.parse(json!);
      const valid = ajv.validate(schemas["execution-history-token-usage"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("cost_usd 為 0 時應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, { ...successResult, cost_usd: undefined }, ctx);

      const json = backend.written.get("T-001/001/token-usage.json");
      const data = JSON.parse(json!);
      const valid = ajv.validate(schemas["execution-history-token-usage"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });
  });

  describe("final-status.json 符合 execution-history-final-status schema", () => {
    it("成功 task 應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, successResult, ctx);

      const json = backend.written.get("T-001/001/final-status.json");
      expect(json).toBeDefined();

      const data = JSON.parse(json!);
      const valid = ajv.validate(schemas["execution-history-final-status"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("失敗 task（含 error）應通過 schema 驗證", async () => {
      const backend = createCaptureBackend();
      const writer = new HistoryWriter(backend, cfg);
      await writer.recordRun(task, failedResult, { ...ctx, previousAttempts: [] });

      const json = backend.written.get("T-001/001/final-status.json");
      const data = JSON.parse(json!);
      const valid = ajv.validate(schemas["execution-history-final-status"], data);
      expect(ajv.errors).toBeNull();
      expect(valid).toBe(true);
    });
  });
});
