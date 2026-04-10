# SPEC-012 Feature: Telemetry Client SDK Integration

**Status**: Approved  
**Created**: 2026-04-10  
**Author**: AlbertHsu  
**Related**: SPEC-008 (Execution History), SPEC-010 (Telemetry Unification)

---

## Overview

將 `@asiaostrich/telemetry-client` SDK 整合到 DevAP orchestrator。
當 `execution_history.backend="file_server"` 且 `telemetryUpload=true` 時，
orchestrator 完成後將 L1 index snapshot 上傳至遙測伺服器，實現跨專案執行統計收集。

---

## Motivation

DevAP 目前的執行歷史僅支援本機 `LocalStorageBackend`。
為了讓 AsiaOstrich 能夠收集跨專案的任務執行統計，需要：

1. 提供 `FileServerStorageBackend` 作為可選的遠端 backend
2. 在 orchestrator 完成後，自動上傳 L1 全域索引 snapshot
3. 確保 opt-in 設計：使用者必須明確啟用，zero data egress by default
4. 確保優雅降級：伺服器不可用時不影響主流程

---

## Requirements

### REQ-012-001: FileServerStorageBackend 工廠選擇

系統 SHALL 在 `execution_history.backend === "file_server"` 時，
使用 `FileServerStorageBackend`（而非 `LocalStorageBackend`）
作為 `HistoryWriter` 的儲存後端。

#### Scenario: backend="file_server" 時選擇正確 backend

- **GIVEN** `plan.execution_history.enabled = true`
- **AND** `plan.execution_history.backend = "file_server"`
- **AND** `plan.execution_history.telemetryUpload = true`
- **AND** `plan.execution_history.telemetryServer = "https://example.com"`
- **WHEN** `orchestrate()` 被呼叫
- **THEN** `HistoryWriter` 使用 `FileServerStorageBackend` 實例
- **AND** `FileServerStorageBackend` 持有 `TelemetryUploader` 實例

### REQ-012-002: Orchestrator 完成後上傳 L1 index snapshot

系統 SHALL 在 `orchestrate()` 成功完成所有任務後，
非同步上傳 L1 index snapshot 至遙測伺服器。

上傳不得阻塞 `orchestrate()` 的回傳（fire-and-forget）。

#### Scenario: orchestrator 完成後觸發上傳

- **GIVEN** `backend = "file_server"` 且 `telemetryUpload = true`
- **WHEN** `orchestrate()` 完成並產出 `ExecutionReport`
- **THEN** `TelemetryUploader.upload()` 被呼叫，payload 包含 L1 index 內容
- **AND** `orchestrate()` 在上傳完成前即返回（不等待上傳）

### REQ-012-003: telemetryUpload=false 時零數據離開本機

系統 SHALL 在 `telemetryUpload === false`（或未設定）時，
不呼叫任何 `TelemetryUploader` 方法，確保零數據離開本機。

#### Scenario: telemetryUpload=false 時不觸發上傳

- **GIVEN** `plan.execution_history.telemetryUpload = false`
- **WHEN** `orchestrate()` 完成
- **THEN** `TelemetryUploader.upload()` 不被呼叫
- **AND** 沒有任何網路請求發出

#### Scenario: telemetryApiKey 為空時不觸發上傳

- **GIVEN** `telemetryUpload = true` 但 `telemetryApiKey = ""`
- **WHEN** `orchestrate()` 完成
- **THEN** `TelemetryUploader.upload()` 不被呼叫

### REQ-012-004: 伺服器不可用時優雅降級

系統 SHALL 在遙測伺服器不可用時（網路錯誤、HTTP 5xx 等），
靜默吞噬錯誤，不將錯誤傳播給 `orchestrate()` 的呼叫者。

#### Scenario: 伺服器不可用時 orchestrator 正常完成

- **GIVEN** `TelemetryUploader.upload()` 拋出網路錯誤
- **WHEN** `orchestrate()` 的上傳觸發後
- **THEN** `orchestrate()` 已返回 `ExecutionReport`（不受影響）
- **AND** 錯誤被靜默吞噬（不再拋出）

### REQ-012-005: backend="local" 或未設定時不觸發上傳

系統 SHALL 在 `backend = "local"` 或 `execution_history.enabled = false` 或
未設定 `execution_history` 時，不初始化任何 `TelemetryUploader`，
不觸發任何上傳行為。

#### Scenario: backend="local" 時使用 LocalStorageBackend

- **GIVEN** `plan.execution_history.backend = "local"` 或未設定
- **WHEN** `orchestrate()` 被呼叫
- **THEN** `HistoryWriter` 使用 `LocalStorageBackend`（不是 `FileServerStorageBackend`）
- **AND** `TelemetryUploader` 不被初始化

---

## 新設定欄位

在 `ExecutionHistoryConfig`（`execution-history/types.ts`）新增：

```typescript
/** 是否啟用遙測上傳（opt-in，預設 false） */
telemetryUpload?: boolean;

/** 遙測伺服器 URL（telemetryUpload=true 時必填） */
telemetryServer?: string;

/** 遙測 API Key（空字串時不觸發上傳） */
telemetryApiKey?: string;
```

---

## Technical Design

### 整合架構

```
orchestrate()
  │
  ├─ [backend="file_server" + telemetryUpload=true]
  │     └─ FileServerStorageBackend(LocalStorageBackend, TelemetryUploader)
  │
  ├─ [backend="local" 或未設定]
  │     └─ LocalStorageBackend
  │
  └─ buildReport() → ExecutionReport
        │
        └─ [telemetryUpload=true] uploadIndexSnapshot().catch(() => {})  ← fire-and-forget
```

### FileServerStorageBackend（DevAP 端 Adapter）

位置：`packages/core/src/execution-history/storage-backend.ts`

```typescript
export class FileServerStorageBackend implements StorageBackend {
  constructor(
    private readonly local: LocalStorageBackend,
    private readonly uploader: TelemetryUploader,
  ) {}

  // 本地操作委派給 LocalStorageBackend
  readFile(path: string): Promise<string | null> { ... }
  writeFile(path: string, content: string): Promise<void> { ... }
  deleteFile(path: string): Promise<void> { ... }
  deleteDir(path: string): Promise<void> { ... }
  listDir(path: string): Promise<string[]> { ... }
  exists(path: string): Promise<boolean> { ... }

  // 上傳 L1 index snapshot
  async uploadIndexSnapshot(): Promise<void> { ... }
}
```

### Orchestrator 修改點

1. HistoryWriter 初始化（`orchestrate()` 第 211 行附近）：
   - 根據 `backend` 欄位選擇 `FileServerStorageBackend` 或 `LocalStorageBackend`

2. `buildReport()` 後（兩條路徑）：
   - 若 backend 為 `FileServerStorageBackend`，fire-and-forget 呼叫 `uploadIndexSnapshot()`

---

## Acceptance Criteria

- **AC-1**: `backend="file_server"` 時，`HistoryWriter` 使用 `FileServerStorageBackend`（可由測試中注入 mock uploader 驗證）
- **AC-2**: orchestrator 完成後，`TelemetryUploader.upload()` 被呼叫，payload 包含 L1 index 內容
- **AC-3**: `telemetryUpload=false` 時，`TelemetryUploader.upload()` 不被呼叫
- **AC-4**: `TelemetryUploader.upload()` 拋出錯誤時，`orchestrate()` 正常返回 `ExecutionReport`
- **AC-5**: `backend="local"` 或未設定時，`TelemetryUploader` 不被初始化，無上傳

---

## Test Plan

- [ ] `FileServerStorageBackend` 的單元測試（storage-backend.test.ts）
  - `uploadIndexSnapshot()` 呼叫 `TelemetryUploader.upload()` 並帶入正確 payload
  - 本地操作正確委派給 `LocalStorageBackend`
- [ ] Orchestrator 整合測試（orchestrator.test.ts 或新增 telemetry-integration.test.ts）
  - AC-1: backend="file_server" → FileServerStorageBackend 被使用
  - AC-2: 完成後 upload() 被呼叫
  - AC-3: telemetryUpload=false → upload() 不被呼叫
  - AC-4: upload() 拋錯 → orchestrate() 正常完成
  - AC-5: backend="local" → upload() 不被呼叫

---

## 影響範圍

| 檔案 | 變更類型 |
|------|---------|
| `packages/core/src/execution-history/types.ts` | 新增欄位 |
| `packages/core/src/execution-history/storage-backend.ts` | 新增 class |
| `packages/core/src/orchestrator.ts` | 修改初始化邏輯 + 新增上傳觸發 |
| `packages/core/package.json` | 新增依賴 |
| `packages/core/src/__tests__/telemetry-integration.test.ts` | 新增測試 |
