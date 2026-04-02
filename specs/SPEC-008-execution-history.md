# SPEC-008 執行歷史倉庫（Execution History Repository）

**狀態**: Implemented (Phase 1-3)
**建立日期**: 2026-04-02
**作者**: devap team
**上游規格**: dev-platform XSPEC-003-SDD（Approved）
**動機來源**: Meta-Harness 論文（arXiv:2603.28052）

---

## Summary

devap 目前是「射後即忘」— 每次 `orchestrate()` 產出 `ExecutionReport` 後，執行細節僅存在於記憶體和終端輸出中。後續 agent 無法從前次經驗學習。

**根本問題**：devap 缺乏**跨對話的執行歷史持久化**。

本規格在 devap 中實作 XSPEC-003-SDD 定義的執行歷史標準，新增獨立的 `.execution-history/` 目錄和 `execution-history` 模組，使每次任務執行自動產出結構化的 artifacts，供後續 agent 參考。

## Motivation

### 問題

1. **歷史遺失** — `ExecutionReport` 是 in-memory 物件，對話結束後即遺失
2. **無法學習** — 後續 agent 面對相同/類似任務時，無法知道前次是成功還是失敗、為何失敗
3. **無量化反饋** — 無法追蹤標準/規則的實際效果（通過率、平均成本等）
4. **診斷困難** — 失敗時無法回溯完整的執行日誌和程式碼變更

### 期望

使用 devap 執行 task plan 後：
- 每個 task 的執行結果自動持久化為結構化 artifacts
- 後續 agent 能透過 L1/L2/L3 分層存取歷史（從索引到完整日誌）
- 敏感資訊在寫入時自動 redact
- 歷史量可控（retention policy 自動清理）

### 研究依據

Meta-Harness 論文（arXiv:2603.28052）核心發現：給 agent 完整的先前執行歷史（而非壓縮摘要）能大幅提升效果。同一 benchmark 上 harness 設計差異可導致性能相差 6 倍。

---

## 設計決策

### 儲存位置

獨立的 `.execution-history/` 目錄（不擴展 `.devap/worktrees/`）。理由：
- 語義不同：worktree 是「當前隔離執行空間」，history 是「已完成任務的歷史紀錄」
- 生命週期不同：worktree 在 merge 後清理，history 長期保留
- 此標準來自 UDS（跨專案），不應綁定 DevAP 特有的 worktree 機制

### Opt-in 啟用

透過 `TaskPlan.execution_history.enabled` 啟用（預設 `false`），不破壞現有行為。

### 分層存取

| 層級 | 檔案 | Token 目標 | 用途 |
|------|------|-----------|------|
| L1 | `index.json` | < 200 | 快速篩選相關歷史 |
| L2 | `manifest.json` | < 1,000/task | 了解任務脈絡與摘要 |
| L3 | 個別 artifact 檔案 | 不限 | 深入因果推理 |

### 雙儲存後端

預設 local（檔案系統），可配置外部 FileServer。L1 索引始終同步到本地。

---

## Requirements

### REQ-001: TaskPlan 擴展

`TaskPlan` 新增可選的 `execution_history` 欄位，啟用歷史記錄功能。

#### Scenario: 啟用執行歷史

- **GIVEN** TaskPlan 包含 `execution_history: { enabled: true }`
- **WHEN** `orchestrate()` 執行
- **THEN** 每個 task 完成後自動寫入 artifacts 到 `.execution-history/`

#### Scenario: 未啟用時向後相容

- **GIVEN** TaskPlan 不包含 `execution_history` 欄位
- **WHEN** `orchestrate()` 執行
- **THEN** 行為與現有完全相同，不產生 `.execution-history/` 目錄

### REQ-002: Artifact 自動寫入

每個 task 執行完畢後（無論成功或失敗），自動產出 6 個 required artifacts。

#### Scenario: Task 成功完成

- **GIVEN** task 執行完成且 `status === "success"`
- **WHEN** HistoryWriter.recordRun() 被呼叫
- **THEN** 在 `.execution-history/{task-id}/{run-number}/` 下寫入：
  - `task-description.md` — 來自 `Task.title` + `Task.spec` + `Task.acceptance_criteria`
  - `code-diff.patch` — 來自 task 執行前後的 `git diff`
  - `test-results.json` — 來自 `TaskResult.verification_evidence[]`
  - `execution-log.jsonl` — 來自 `onProgress` callback 收集的結構化事件
  - `token-usage.json` — 來自 `TaskResult.cost_usd`（Phase 1 僅 total）
  - `final-status.json` — 來自 `TaskResult.status` + `error` + `duration_ms`

#### Scenario: Task 失敗時額外產出錯誤分析

- **GIVEN** task 執行完成且 `status === "failed"`
- **WHEN** HistoryWriter.recordRun() 被呼叫
- **THEN** 除 6 個 required artifacts 外，額外產出 `error-analysis.md`（來自 FixFeedback.previous_attempts）

#### Scenario: Run number 遞增

- **GIVEN** task `impl-auth-flow` 已有 run 001 和 002
- **WHEN** 新的執行完成
- **THEN** 新 run 編號為 `003`（讀取 task manifest 的 run_history 長度 + 1）

### REQ-003: Manifest 與 Index 更新

每次 run 完成後，更新 L2 task manifest 和 L1 全域 index。

#### Scenario: 新 task 首次執行

- **GIVEN** `.execution-history/` 中不存在 task `fix-rate-limiter`
- **WHEN** 該 task 首次執行完成
- **THEN** 建立 `fix-rate-limiter/manifest.json`（L2）並新增 entry 到 `index.json`（L1）

#### Scenario: index.json 活躍 task 上限

- **GIVEN** `index.json` 已有 50 個 tasks
- **WHEN** 新 task 首次執行完成
- **THEN** 最久未更新的 task 移至 `index-archive.json`，新 task 加入 `index.json`

### REQ-004: 分層讀取 API

提供 L1/L2/L3 讀取器，供 agent 或外部工具查詢歷史。

#### Scenario: L1 快速篩選

- **GIVEN** agent 需要找到相關歷史
- **WHEN** 呼叫 `reader.readIndex()`
- **THEN** 回傳 `HistoryIndex` 物件（最近 50 個活躍 tasks 的索引）

#### Scenario: L2 任務摘要

- **GIVEN** agent 從 L1 篩選出感興趣的 task
- **WHEN** 呼叫 `reader.readTaskManifest(taskId)`
- **THEN** 回傳 `TaskManifest` 物件（含 run_history、key_metrics、failure_summary）

#### Scenario: L3 完整 artifact

- **GIVEN** agent 需要深入診斷某個 run
- **WHEN** 呼叫 `reader.readArtifact(taskId, runNumber, artifactId)`
- **THEN** 回傳 artifact 原始內容（string）

### REQ-005: Sensitive Data Redaction

所有 artifacts 在寫入前，自動掃描並 redact 敏感資訊。

#### Scenario: API key 被 redact

- **GIVEN** execution-log.jsonl 中包含 `sk-proj-abc123def456...`
- **WHEN** artifact 寫入 `.execution-history/`
- **THEN** 內容中的 API key 被替換為 `[REDACTED:API_KEY]`

#### Scenario: 多種 pattern 同時 redact

- **GIVEN** 內容中同時包含 GitHub token (`ghp_xxx`) 和密碼 (`password: secret123`)
- **WHEN** redactor 處理
- **THEN** 兩者分別被替換為 `[REDACTED:GITHUB_TOKEN]` 和 `[REDACTED:PASSWORD]`

### REQ-006: Retention Policy

自動清理超過保留上限的歷史，避免磁碟空間膨脹。

#### Scenario: 超過 max_runs 上限

- **GIVEN** `retention.max_runs_per_task` 設為 50，task 已有 50 個 runs
- **WHEN** 第 51 次 run 寫入
- **THEN** 最舊 run 的 L3 artifacts 被刪除，但 L1/L2 索引保留

#### Scenario: 歸檔 stale tasks

- **GIVEN** task 最後一次 run 距今超過 90 天
- **WHEN** index 更新時
- **THEN** 該 task 從 `index.json` 移至 `index-archive.json`

#### Scenario: 歸檔 task reactivate

- **GIVEN** 已歸檔的 task 有新 run 寫入
- **WHEN** manifest 更新時
- **THEN** 該 task 從 `index-archive.json` 移回 `index.json`

### REQ-007: Storage Backend

支援 local 和 file_server 兩種儲存後端，透過 `StorageBackend` 介面抽象。

#### Scenario: Local 後端（預設）

- **GIVEN** `execution_history.backend` 為 `"local"` 或未設定
- **WHEN** artifacts 寫入
- **THEN** 直接寫入 `{cwd}/.execution-history/` 目錄

#### Scenario: FileServer 後端

- **GIVEN** `execution_history.backend` 為 `"file_server"`，`file_server_url` 已設定
- **WHEN** artifacts 寫入
- **THEN** 透過 HTTP API 寫入 FileServer，L1 索引同步到本地

---

## Technical Design

### 新增模組：`packages/core/src/execution-history/`

```
execution-history/
├── index.ts              # barrel export
├── types.ts              # 所有介面定義
├── writer.ts             # HistoryWriter — artifact 寫入 + manifest/index 更新
├── reader.ts             # HistoryReader — L1/L2/L3 分層讀取
├── storage-backend.ts    # StorageBackend interface + LocalStorageBackend
├── redactor.ts           # SensitiveDataRedactor
└── retention.ts          # RetentionManager — 清理 + 歸檔
```

### 新增型別（`execution-history/types.ts`）

```typescript
/** 執行歷史配置（TaskPlan 層級） */
export interface ExecutionHistoryConfig {
  enabled: boolean;
  backend?: "local" | "file_server";
  file_server_url?: string;
  retention?: Partial<RetentionConfig>;
  extra_sensitive_patterns?: SensitivePattern[];
}

/** L1 全域索引 */
export interface HistoryIndex {
  version: string;
  updated: string;              // ISO 8601
  max_active_tasks: number;     // 預設 50
  archive_threshold_days: number; // 預設 90
  tasks: HistoryIndexEntry[];
}

export interface HistoryIndexEntry {
  task_id: string;
  task_name: string;
  tags: string[];
  latest_run: string;           // "001"-"999"
  latest_status: "success" | "failure" | "partial";
  latest_date: string;
  total_runs: number;
}

/** L2 Task Manifest */
export interface TaskManifest {
  task_id: string;
  task_description_summary: string;
  run_history: RunHistoryEntry[];
  key_metrics: {
    pass_rate: number;
    avg_tokens: number;
    avg_duration_s: number;
  };
  artifacts_available: string[];
  failure_summary?: string;
}

export interface RunHistoryEntry {
  run: string;
  status: "success" | "failure" | "partial";
  date: string;
  duration_s: number;
  tokens_total: number;
}

/** Retention 配置 */
export interface RetentionConfig {
  max_runs_per_task: number;         // 預設 50
  max_total_size_mb: number;         // 預設 500
  cleanup_strategy: "oldest_l3_first";
  archive_threshold_days: number;    // 預設 90
}

/** Sensitive Pattern */
export interface SensitivePattern {
  pattern: string;   // RegExp string
  label: string;
}

/** Storage Backend 介面 */
export interface StorageBackend {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteDir(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}
```

### 修改現有檔案

#### `packages/core/src/types.ts`

```typescript
// 在 TaskPlan 介面新增欄位（L134-153）：
export interface TaskPlan {
  // ...existing fields...
  /** 執行歷史配置（opt-in） */
  execution_history?: ExecutionHistoryConfig;
}
```

`ExecutionHistoryConfig` 從 `execution-history/types.ts` import。

#### `packages/core/src/orchestrator.ts`

在 `orchestrate()` 函式中（L177-181）整合 HistoryWriter：

```typescript
export async function orchestrate(
  plan: TaskPlan,
  adapter: AgentAdapter,
  options: OrchestratorOptions,
): Promise<ExecutionReport> {
  // ★ 新增：初始化 HistoryWriter（若啟用）
  const historyWriter = plan.execution_history?.enabled
    ? new HistoryWriter(options.cwd, plan.execution_history)
    : null;

  // ★ 新增：wrap onProgress 收集執行日誌
  const logCollector = historyWriter
    ? new ExecutionLogCollector(options.onProgress)
    : null;
  const wrappedOptions = logCollector
    ? { ...options, onProgress: logCollector.handler }
    : options;

  // ...existing orchestration logic（使用 wrappedOptions）...

  // 在每個 task 完成後（orchestrateSequential/Parallel 內部）：
  // ★ 新增：記錄歷史
  // await historyWriter?.recordRun(task, result, {
  //   codeDiff: await diffCapture.getDiff(),
  //   executionLog: logCollector?.getEntries(),
  // });

  // 在 buildReport() 前：
  // ★ 新增：finalize 歷史（更新 index、執行 retention）
  // await historyWriter?.finalize();

  return report;
}
```

#### `packages/core/src/index.ts`

```typescript
export * from "./execution-history/index.js";
```

### TaskResult → Artifact 映射

| Artifact | 來源 | 格式 |
|----------|------|------|
| `task-description.md` | `Task.title` + `Task.spec` + `Task.acceptance_criteria` | Markdown |
| `code-diff.patch` | 新增 `DiffCapture`：task 前後 `git diff` | Unified diff |
| `test-results.json` | `TaskResult.verification_evidence[]` → 結構化 JSON | JSON (XSPEC-003 schema) |
| `execution-log.jsonl` | 新增 `ExecutionLogCollector`：wrap `onProgress` callback | JSONL |
| `token-usage.json` | `TaskResult.cost_usd` → `{ total: { cost_usd }, breakdown: [] }` | JSON |
| `final-status.json` | `TaskResult.status` + `error` + `duration_ms` | JSON |
| `error-analysis.md` | `FixFeedback.previous_attempts`（僅失敗時） | Markdown |

### 已知限制

| 限制 | 緩解 | 時程 |
|------|------|------|
| `TaskResult.cost_usd` 無 token 明細 | Phase 1 先寫 total only，breakdown 為空陣列 | Phase 2 擴展 AgentAdapter |
| 非 git repo 中 `code-diff.patch` 失敗 | try-catch，寫入空內容並在 manifest 標記 | Phase 1 |
| 並行 task 同時更新 index.json | 使用 file-level lock 或序列化 index 更新 | Phase 2 |

---

## Implementation Phases

### Phase 1: Core Writer + Redactor（PR #1）

**新增檔案：**
- `packages/core/src/execution-history/types.ts`
- `packages/core/src/execution-history/storage-backend.ts`（LocalStorageBackend）
- `packages/core/src/execution-history/redactor.ts`
- `packages/core/src/execution-history/writer.ts`
- `packages/core/src/execution-history/index.ts`

**測試檔案：**
- `packages/core/src/__tests__/execution-history/redactor.test.ts`
- `packages/core/src/__tests__/execution-history/writer.test.ts`
- `packages/core/src/__tests__/execution-history/storage-backend.test.ts`

**範圍：** 獨立可測試模組，不修改 orchestrator。Writer 接受手動傳入的 RunContext，自行測試寫入邏輯。

### Phase 2: Orchestrator 整合（PR #2）

**修改檔案：**
- `packages/core/src/types.ts` — 新增 `ExecutionHistoryConfig`、`TaskPlan.execution_history`
- `packages/core/src/orchestrator.ts` — 初始化 HistoryWriter、wrap onProgress、recordRun、finalize
- `packages/core/src/index.ts` — re-export

**新增檔案：**
- `packages/core/src/execution-history/diff-capture.ts` — git diff 前後捕獲
- `packages/core/src/execution-history/log-collector.ts` — onProgress wrapper

**測試檔案：**
- `packages/core/src/__tests__/execution-history/orchestrator-integration.test.ts`

### Phase 3: Reader + Retention（PR #3）

**新增檔案：**
- `packages/core/src/execution-history/reader.ts`
- `packages/core/src/execution-history/retention.ts`

**修改檔案：**
- `packages/core/src/execution-history/writer.ts` — finalize 中呼叫 retention

**測試檔案：**
- `packages/core/src/__tests__/execution-history/reader.test.ts`
- `packages/core/src/__tests__/execution-history/retention.test.ts`

### Phase 4: FileServer Backend（PR #4 — 可延後）

**新增/修改檔案：**
- `packages/core/src/execution-history/storage-backend.ts` — 新增 `FileServerStorageBackend`
- `packages/core/src/execution-history/storage-config.ts` — storage.json 讀取

---

## Test Plan

### 單元測試

| 模組 | 測試重點 |
|------|----------|
| `redactor` | 各 sensitive pattern（API key, GitHub token, password, private key）、多模式混合、無匹配不改、自訂 extra patterns |
| `writer` | run number 遞增、6 個 required artifacts 寫入、manifest 更新、index 更新、失敗時產出 error-analysis.md |
| `reader` | L1 readIndex()、L2 readTaskManifest()、L3 readArtifact()、檔案不存在回傳 null |
| `retention` | max_runs 清理最舊 L3 保留 L1/L2、archive 觸發（> 90 天）、reactivate |
| `storage-backend` | LocalStorageBackend 讀寫刪（用 vitest temp dir） |
| `diff-capture` | git repo 中正確捕獲 diff、非 git repo 回傳空字串 |
| `log-collector` | 收集 onProgress 事件、同時轉發原始 callback |

### 整合測試

| 測試 | 說明 |
|------|------|
| Orchestrator + History | `orchestrate()` with `execution_history.enabled = true` → 驗證 `.execution-history/` 目錄結構完整 |
| Opt-in 向後相容 | `orchestrate()` without `execution_history` → 無 `.execution-history/` 目錄 |
| Retention 端到端 | 寫入 51 個 runs → 驗證第 1 個 run 的 L3 被清理，L1/L2 保留 |

### Token 預算驗證

- L1 index.json（50 tasks）< 200 tokens（以字元數估算：~50 * 4 fields * ~10 chars ≈ 2000 chars ≈ 500 tokens — **需調整目標或 entry 格式**）
- L2 manifest.json < 1,000 tokens/task

---

## 與現有模組的相容性

| 模組 | 影響 | 說明 |
|------|------|------|
| orchestrator | 修改（Phase 2） | 新增 optional HistoryWriter 整合，不改現有邏輯路徑 |
| types | 修改（Phase 2） | TaskPlan 新增 optional 欄位，不破壞現有 plan |
| quality-gate | 唯讀（不改） | QualityGateResult 作為 test-results.json 的資料來源 |
| fix-loop | 唯讀（不改） | FixFeedback 作為 error-analysis.md 的資料來源 |
| judge | 唯讀（不改） | JudgeVerdict 可記錄在 final-status.json |
| safety-hook | 唯讀（不改） | 不與 execution-history 互動 |
| worktree-manager | 唯讀（不改） | `.execution-history/` 獨立於 `.devap/worktrees/` |
| task-schema.json | 修改（Phase 2） | 新增 `execution_history` 欄位的 JSON Schema |
