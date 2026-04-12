# SPEC-013 Feature: Execution History Storage Module（獨立儲存 API）

**Status**: Approved
**Created**: 2026-04-12
**Author**: AlbertHsu
**Related**: SPEC-008 (DevAP 整合層), XSPEC-003-SDD (跨專案標準)

---

## Overview

在 SPEC-008 DevAP 整合層之上，提供一套**獨立的 Execution History 儲存 API**。
此 API 不依賴 DevAP 的 `Task`/`TaskResult` 型別，接受原始 artifact 字串內容，
可供 `.workflow-state/` 任務完成橋接呼叫，也可供任何不使用 orchestrator 的場景使用。

### 分層關係

```
execution-history-manager.ts  ← 主入口（recordRun / getHistory）
├── artifact-writer.ts        ← L3 artifact 寫入 + redaction
├── manifest-manager.ts       ← L1 index + L2 manifest 維護
├── access-reader.ts          ← L1/L2/L3 分層讀取
└── retention-manager.ts      ← L3 清理策略
        ↓
  storage-backend.ts           ← LocalBackend / FileServerBackend（Phase 4 stub）
```

---

## Motivation

SPEC-008 的 `HistoryWriter` 依賴 `Task`/`TaskResult` 介面，與 DevAP orchestrator 緊耦合。
當 `.workflow-state/` 完成任務時（非 orchestrator 路徑），無法直接呼叫 SPEC-008 API。
本 SPEC 提供解耦的儲存層，以 `RunArtifacts`（原始內容 map）為輸入。

---

## Requirements

### REQ-013-001: ArtifactWriter — 寫入 required artifacts

#### Scenario: 寫入 6 個 required artifacts

- **GIVEN** `RunArtifacts.content` 包含 6 個 required artifact key
- **WHEN** `ArtifactWriter.writeRun()` 被呼叫
- **THEN** 每個 artifact 以正確副檔名寫入 `{taskId}/{runNumber}/` 目錄

#### Scenario: 寫入前 redact 4 種敏感資料

- **GIVEN** artifact 內容包含 `sk-xxx`、`ghp_xxx`、`password: secret`、`BEGIN PRIVATE KEY`
- **WHEN** 寫入 `.execution-history/`
- **THEN** 敏感內容被替換為 `[REDACTED:LABEL]`

### REQ-013-002: ManifestManager — 維護 L1/L2 索引

#### Scenario: 首次執行取得 run number 001

- **GIVEN** task `impl-auth` 尚無歷史紀錄
- **WHEN** `ManifestManager.getNextRunNumber("impl-auth")`
- **THEN** 回傳 `"001"`

#### Scenario: index.json 活躍 task 超過 50 個

- **GIVEN** `index.json` 已有 50 個活躍 tasks
- **WHEN** 新 task 第一次執行
- **THEN** 最舊的 task 移至 `index-archive.json`，新 task 加入 `index.json`

#### Scenario: 歸檔 task 有新 run 時自動 reactivate

- **GIVEN** task 已在 `index-archive.json`
- **WHEN** `ManifestManager.reactivateTask(taskId)` 被呼叫
- **THEN** task 從 archive 移回 `index.json`

#### Scenario: 超過 90 天的 task 自動歸檔

- **GIVEN** task 最後一次 run 距今 > 90 天
- **WHEN** `ManifestManager.archiveStaleTasks()` 被呼叫
- **THEN** task 從 `index.json` 移至 `index-archive.json`

### REQ-013-003: AccessReader — 分層讀取

- **L1** `readL1()` → `HistoryIndex | null`
- **L2** `readL2(taskId)` → `ManifestL2 | null`
- **L3** `readL3(taskId, run, artifactId)` → `string | null`
- 檔案不存在時回傳 `null`，不拋錯

### REQ-013-004: StorageRetentionManager — L3 清理

#### Scenario: 超過 max_runs_per_task 時清理最舊 L3

- **GIVEN** `policy.max_runs_per_task = 3`，task 已有 3 個 runs
- **WHEN** 第 4 次 run 完成後呼叫 `StorageRetentionManager.enforce(taskId)`
- **THEN** run 001 的 L3 目錄被刪除，L1/L2 索引保留

### REQ-013-005: ExecutionHistoryManager — 主入口

#### Scenario: recordRun 完整流程

- **GIVEN** `StorageConfig` 指定 `basePath`，`RunArtifacts` 包含所有內容
- **WHEN** `recordRun(config, artifacts)` 被呼叫
- **THEN** artifacts 寫入、L2 manifest 更新、L1 index 更新、retention 執行

#### Scenario: getHistory 回傳 L1 index

- **GIVEN** `.execution-history/index.json` 存在
- **WHEN** `getHistory(config)` 被呼叫
- **THEN** 回傳 `HistoryIndex` 物件

---

## Acceptance Criteria

- **AC-1**: 6 個 required artifacts 全部以正確副檔名寫入
- **AC-2**: 4 種敏感資料 pattern 正確 redact
- **AC-3**: `getNextRunNumber` 回傳三位數字格式（001-999）
- **AC-4**: index.json 最多 50 個活躍 tasks，超出移至 archive
- **AC-5**: 超過 90 天的 task 自動歸檔
- **AC-6**: 歸檔 task 有新 run 時自動移回 active
- **AC-7**: 超過 `max_runs_per_task` 時刪除最舊 L3，保留 L1/L2
- **AC-8**: `recordRun` 完整流程端到端通過
- **AC-9**: 30 個 mock 測試全部通過

---

## New Types（補充至 types.ts）

```typescript
type ArtifactType = 'task-description' | 'code-diff' | 'test-results'
  | 'execution-log' | 'token-usage' | 'final-status' | 'error-analysis' | 'agent-reasoning';

type ManifestL1Entry = HistoryIndexEntry;  // 別名
type ManifestL2 = TaskManifest;           // 別名

interface RunManifest {
  run: string;
  status: 'success' | 'failure' | 'partial';
  date: string;
  duration_s: number;
  tokens_total: number;
  artifacts: string[];
}

interface StorageConfig {
  basePath: string;
  backend?: 'local' | 'file_server';
  file_server_url?: string;
  retention?: Partial<RetentionConfig>;
  sensitivePatternsExtra?: SensitivePattern[];
}

type RetentionPolicy = RetentionConfig;  // 別名

interface RunArtifacts {
  taskId: string;
  taskName: string;
  tags?: string[];
  status: 'success' | 'failure' | 'partial';
  content: Partial<Record<ArtifactType, string>>;
  durationS?: number;
  tokensTotal?: number;
}
```

---

## Module 職責

| 模組 | 類別/函式 | 依賴 |
|------|-----------|------|
| `artifact-writer.ts` | `ArtifactWriter` | `StorageBackend` |
| `manifest-manager.ts` | `ManifestManager` | `StorageBackend` |
| `access-reader.ts` | `AccessReader` | `StorageBackend` |
| `retention-manager.ts` | `StorageRetentionManager` | `StorageBackend` |
| `execution-history-manager.ts` | `recordRun()`, `getHistory()` | 以上全部 |

---

## 與 SPEC-008 關係

- SPEC-008 `HistoryWriter` 接受 DevAP `Task`/`TaskResult`，適合 orchestrator 整合
- SPEC-013 `ArtifactWriter` + `ManifestManager` 接受原始字串，適合獨立呼叫
- 兩者共用相同 `StorageBackend` 介面和目錄結構
- `.workflow-state/` 橋接應呼叫 SPEC-013 的 `recordRun()`
