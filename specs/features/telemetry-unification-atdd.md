# SPEC-010 Telemetry Unification — ATDD 追蹤表

> [Source] SPEC-010 | [Generated] 2026-04-06

## AC ↔ BDD ↔ TDD 追蹤矩陣

| AC | 驗收條件 | BDD 場景 | TDD 測試 | 檔案 | 狀態 |
|----|----------|----------|----------|------|------|
| AC-1 | `harness_hook_data` 欄位存在且可選 | `StandardsEffectivenessReport 包含可選的 harness_hook_data 欄位` | `[AC-1] HarnessHookData 型別存在且可選` (3 tests) | `packages/core/src/types.ts` | GREEN ✅ |
| AC-2 | telemetry.jsonl 存在時正確彙總 | `telemetry.jsonl 存在且有效時彙總統計正確` | `[AC-2] parseTelemetryJsonl — 有效 jsonl 解析` (5 tests) | `packages/core/src/telemetry-parser.ts` | GREEN ✅ |
| AC-3 | telemetry.jsonl 不存在時為 undefined | `telemetry.jsonl 不存在時 harness_hook_data 為 undefined` | `[AC-3] parseTelemetryJsonl — 檔案不存在` (1 test) | `packages/core/src/telemetry-parser.ts` | GREEN ✅ |
| AC-4 | 無效行跳過不拋例外 | `telemetry.jsonl 包含無效行時跳過並繼續` | `[AC-4] parseTelemetryJsonl — 無效行處理` (2 tests) | `packages/core/src/telemetry-parser.ts` | GREEN ✅ |
| AC-5 | 現有測試無 regression | `無 telemetry 檔案時報告結構不變` | 全套件 523 tests 通過 | `packages/core/src/orchestrator.ts` | GREEN ✅ |

## 修改檔案清單

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `packages/core/src/types.ts` | 修改 | 新增 `HarnessHookData`、`HarnessHookStandardStats` 介面；`StandardsEffectivenessReport` 新增 `harness_hook_data?` |
| `packages/core/src/orchestrator.ts` | 修改 | `buildReport()` 新增 `cwd` 參數，整合 `parseTelemetryJsonl()` |
| `packages/core/src/telemetry-parser.ts` | 新增 | `parseTelemetryJsonl()` 純函式，解析 telemetry.jsonl |
| `packages/core/src/index.ts` | 修改 | 匯出 `parseTelemetryJsonl` |

## TDD 測試骨架摘要

| 測試檔案 | 測試數 | 覆蓋 AC |
|----------|--------|---------|
| `packages/core/src/__tests__/telemetry-parser.test.ts` | 13 | AC-1, AC-2, AC-3, AC-4, AC-5 |

## 驗證指令

```bash
# 執行 SPEC-010 相關測試
pnpm --filter @devap/core test -- --grep "SPEC-010"

# 執行全部測試（回歸驗證）
pnpm test
```
