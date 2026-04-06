# [SPEC-010] Feature: Telemetry Unification (DevAP)

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Author** | AI Assistant |
| **Created** | 2026-04-06 |
| **Priority** | Medium |

## Overview

將 UDS harness hooks 的 telemetry 資料（`telemetry.jsonl`）整合到 DevAP 的 `ExecutionReport.standards_effectiveness` 中，提供 hook 執行統計的彙總視圖。

## Motivation

目前 `StandardsEffectivenessReport` 只從 `TaskResult.verification_evidence` 推導標準效果。UDS harness hooks 會在 `.standards/telemetry.jsonl` 寫入每次 hook 執行的事件紀錄（pass/fail、執行時間、關聯 standard_id），但 DevAP 的 `buildReport()` 未讀取這些資料。整合後可提供更完整的標準有效性視圖。

## Requirements

### Requirement 1: HarnessHookData 型別定義

系統 SHALL 在 `StandardsEffectivenessReport` 介面新增可選的 `harness_hook_data` 欄位，包含以下彙總統計：

- `total_executions`: hook 總執行次數
- `pass_count` / `fail_count`: 通過/失敗次數
- `pass_rate`: 通過率（0-1）
- `avg_duration_ms`: 平均執行時間（毫秒）
- `by_standard`: 按 `standard_id` 分群的統計

#### Scenario: harness_hook_data 型別存在且可選

- **GIVEN** 現有的 `StandardsEffectivenessReport` 介面
- **WHEN** 新增 `harness_hook_data` 欄位
- **THEN** 該欄位型別為 `HarnessHookData | undefined`
- **AND** 不影響現有 `StandardsEffectivenessReport` 的其他欄位

### Requirement 2: telemetry.jsonl 解析

系統 SHALL 在 `buildReport()` 中讀取 `.standards/telemetry.jsonl`（若存在），解析每行 JSON 事件並彙整到 `harness_hook_data`。

#### Scenario: telemetry.jsonl 存在且有效

- **GIVEN** `.standards/telemetry.jsonl` 存在且包含有效的 JSON Lines
- **WHEN** `buildReport()` 被呼叫
- **THEN** `standards_effectiveness.harness_hook_data` 包含正確的彙總統計
- **AND** `total_executions` 等於 jsonl 的總行數
- **AND** `pass_rate` 等於 `pass_count / total_executions`
- **AND** `by_standard` 按 `standard_id` 正確分群

#### Scenario: telemetry.jsonl 不存在

- **GIVEN** `.standards/telemetry.jsonl` 不存在
- **WHEN** `buildReport()` 被呼叫
- **THEN** `standards_effectiveness.harness_hook_data` 為 `undefined`
- **AND** 其餘報告欄位不受影響

#### Scenario: telemetry.jsonl 包含無效行

- **GIVEN** `.standards/telemetry.jsonl` 存在但部分行是無效 JSON
- **WHEN** `buildReport()` 被呼叫
- **THEN** 無效行被跳過，只彙整有效行
- **AND** 不拋出例外

### Requirement 3: 向後相容

系統 SHALL 保持 `ExecutionReport` 的向後相容性。

#### Scenario: 無 telemetry 檔案時的向後相容

- **GIVEN** 專案未使用 UDS harness hooks（無 telemetry.jsonl）
- **WHEN** orchestrator 完成執行
- **THEN** `ExecutionReport` 結構與變更前完全相同
- **AND** 現有測試無 regression

## Acceptance Criteria

- AC-1: Given `StandardsEffectivenessReport`, when 查看介面, then 存在可選的 `harness_hook_data: HarnessHookData | undefined` 欄位
- AC-2: Given telemetry.jsonl 存在, when buildReport() 執行, then harness_hook_data 包含正確的彙總統計
- AC-3: Given telemetry.jsonl 不存在, when buildReport() 執行, then harness_hook_data 為 undefined
- AC-4: Given telemetry.jsonl 有無效行, when buildReport() 執行, then 跳過無效行不拋例外
- AC-5: Given 現有測試套件, when 執行 pnpm test, then 所有測試通過（無 regression）

## Technical Design

### 型別變更 (`packages/core/src/types.ts`)

```typescript
/** 單一 standard 的 hook 統計 */
export interface HarnessHookStandardStats {
  standard_id: string;
  executions: number;
  pass_count: number;
  fail_count: number;
  pass_rate: number;
  avg_duration_ms: number;
}

/** Harness hook telemetry 彙總資料 */
export interface HarnessHookData {
  total_executions: number;
  pass_count: number;
  fail_count: number;
  pass_rate: number;
  avg_duration_ms: number;
  by_standard: HarnessHookStandardStats[];
}
```

在 `StandardsEffectivenessReport` 新增：
```typescript
harness_hook_data?: HarnessHookData;
```

### orchestrator.ts 變更

- `buildReport()` 新增 `cwd` 參數（用於定位 telemetry.jsonl 路徑）
- 新增 `parseTelemetryJsonl(cwd: string): HarnessHookData | undefined` 函式
- telemetry.jsonl 每行預期格式：`{"standard_id": "...", "passed": true/false, "duration_ms": number, ...}`

### telemetry.jsonl 事件格式（預期輸入）

```jsonl
{"standard_id":"testing","hook_name":"pre-commit-test","passed":true,"duration_ms":1234,"timestamp":"2026-04-06T..."}
{"standard_id":"commit-message","hook_name":"commit-msg-check","passed":false,"duration_ms":56,"timestamp":"2026-04-06T..."}
```

## Test Plan

- [ ] 單元測試：`HarnessHookData` 型別可正確建立
- [ ] 單元測試：`parseTelemetryJsonl()` 解析有效 jsonl
- [ ] 單元測試：`parseTelemetryJsonl()` 處理不存在檔案 → undefined
- [ ] 單元測試：`parseTelemetryJsonl()` 跳過無效行
- [ ] 單元測試：`buildReport()` 正確彙整 harness_hook_data
- [ ] 回歸測試：現有 orchestrator 測試全數通過

## Impact Analysis

- **修改檔案**：`packages/core/src/types.ts`, `packages/core/src/orchestrator.ts`
- **新增匯出**：`HarnessHookData`, `HarnessHookStandardStats`
- **破壞性變更**：無（新增可選欄位）
- **相依套件**：無新增（使用 Node.js 內建 fs）
