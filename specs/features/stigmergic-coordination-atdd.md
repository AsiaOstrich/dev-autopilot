# DEC-011 Stigmergic Coordination — ATDD 追蹤表

> [Source] DEC-011 | [Generated] 2026-04-08

## AC ↔ BDD ↔ TDD 追蹤矩陣

| AC | 驗收條件 | BDD 場景 | TDD 測試 | 檔案 | 狀態 |
|----|----------|----------|----------|------|------|
| AC-011-001 | `docs/STIGMERGY.md` 存在，含 State-Flag 語義 | `STIGMERGY.md 存在且包含必要區段` | 手動檢查 | `docs/STIGMERGY.md` | GREEN ✅ |
| AC-011-002 | `ActivationPredicate` 型別定義正確 | `Task 介面包含 optional activationPredicate 欄位` | 型別測試 | `packages/core/src/types.ts` | GREEN ✅ |
| AC-011-003 | threshold 缺少欄位驗證失敗 | `threshold 類型缺少必要欄位時驗證失敗` | `[AC-011-003] threshold 缺少 operator/value` | `packages/core/src/plan-validator.ts` | GREEN ✅ |
| AC-011-004 | state_flag 引用不存在 taskId 驗證失敗 | `state_flag 類型引用不存在的 taskId 時驗證失敗` | `[AC-011-004] state_flag 引用不存在的 taskId` | `packages/core/src/plan-validator.ts` | GREEN ✅ |
| AC-011-005 | custom 含危險指令驗證失敗 | `custom 類型包含危險指令時驗證失敗` | `[AC-011-005] custom 含危險指令` | `packages/core/src/plan-validator.ts` | GREEN ✅ |
| AC-011-006 | JSON Schema 定義 activationPredicate | `JSON Schema 正確驗證 activationPredicate 結構` | `[AC-011-006] schema 驗證 type enum` | `packages/core/src/plan-validator.ts` | GREEN ✅ |
| AC-011-007 | threshold 不滿足 → skip | `threshold 條件不滿足時 task 被 skip` | `[AC-011-007] threshold 評估 skip` | `packages/core/src/orchestrator.ts` | GREEN ✅ |
| AC-011-008 | state_flag 不滿足 → skip | `state_flag 條件不滿足時 task 被 skip` | `[AC-011-008] state_flag 評估 skip` | `packages/core/src/orchestrator.ts` | GREEN ✅ |
| AC-011-009 | custom 非零 → skip | `custom 指令回傳非零時 task 被 skip` | `[AC-011-009] custom 評估 skip` | `packages/core/src/orchestrator.ts` | GREEN ✅ |
| AC-011-010 | 無 predicate 向後相容 | `無 activationPredicate 時 orchestrator 行為不變` | `[AC-011-010] 向後相容` | `packages/core/src/orchestrator.ts` | GREEN ✅ |
| AC-011-011 | `TaskResult.metrics` 欄位存在 | `TaskResult 包含 optional metrics 欄位` | 型別測試 | `packages/core/src/types.ts` | GREEN ✅ |
| AC-011-012 | Threshold-Trigger 為 future work | `QualityGate 不動態插入任務` | 無需測試 | `packages/core/src/quality-gate.ts` | GREEN ✅ |
| AC-011-013 | plan-validator 零回歸 | `無 activationPredicate 的 plan 驗證向後相容` | 既有全套件通過 | `packages/core/src/__tests__/plan-validator.test.ts` | GREEN ✅ |
| AC-011-014 | orchestrator 零回歸 | — | 既有全套件通過 | `packages/core/src/__tests__/orchestrator.test.ts` | GREEN ✅ |

## 修改檔案清單

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `docs/STIGMERGY.md` | 新增 | Stigmergic 協調架構文件 |
| `packages/core/src/types.ts` | 修改 | 新增 `ActivationPredicate`、`ComparisonOperator`、`Task.activationPredicate`、`TaskResult.metrics` |
| `packages/core/src/plan-validator.ts` | 修改 | JSON Schema 擴充 + activationPredicate 語義驗證 |
| `packages/core/src/orchestrator.ts` | 修改 | `executeOneTask()` 加入 predicate 評估 |

## TDD 測試骨架摘要

| 測試檔案 | 測試數 | 覆蓋 AC | 狀態 |
|----------|--------|---------|------|
| `packages/core/src/plan-validator.test.ts` | 15 | AC-011-003, AC-011-004, AC-011-005, AC-011-006, AC-011-010, AC-011-013 | GREEN ✅ |
| `packages/core/src/orchestrator.test.ts` | 12 | AC-011-007, AC-011-008, AC-011-009, AC-011-010, AC-011-011, AC-011-014 | GREEN ✅ |

### plan-validator.test.ts 測試項目

| # | 測試名稱 | AC | 標籤 |
|---|----------|-----|------|
| 1 | 應接受合法的 threshold predicate | AC-011-006 | [Source] |
| 2 | 應接受合法的 state_flag predicate | AC-011-006 | [Source] |
| 3 | 應接受合法的 custom predicate | AC-011-006 | [Source] |
| 4 | 應拒絕無效的 type 值 | AC-011-006 | [Source] |
| 5 | 應拒絕無效的 operator 值 | AC-011-006 | [Source] |
| 6 | 應拒絕缺少 description 的 predicate | AC-011-006 | [Source] |
| 7 | threshold 缺少 operator/value 時驗證失敗 | AC-011-003 | [Source] |
| 8 | threshold 缺少 metric 時驗證失敗 | AC-011-003 | [Source] |
| 9 | threshold 三欄位齊全時驗證通過 | AC-011-003 | [Source] |
| 10 | state_flag 引用不存在 taskId 驗證失敗 | AC-011-004 | [Source] |
| 11 | state_flag 引用有效 taskId 驗證通過 | AC-011-004 | [Source] |
| 12 | state_flag 缺少 taskId 驗證失敗 | AC-011-004 | [Derived] |
| 13 | custom 含危險指令驗證失敗 | AC-011-005 | [Source] |
| 14 | custom 安全指令驗證通過 | AC-011-005 | [Source] |
| 15 | custom 缺少 command 驗證失敗 | AC-011-005 | [Derived] |

### orchestrator.test.ts 測試項目

| # | 測試名稱 | AC | 標籤 |
|---|----------|-----|------|
| 1 | threshold 條件不滿足 → skip | AC-011-007 | [Source] |
| 2 | threshold 條件滿足 → 正常執行 | AC-011-007 | [Source] |
| 3 | 前置任務無 metrics → skip | AC-011-007 | [Derived] |
| 4 | state_flag 條件不滿足 → skip | AC-011-008 | [Source] |
| 5 | state_flag 條件滿足 → 正常執行 | AC-011-008 | [Source] |
| 6 | custom 指令非零 → skip | AC-011-009 | [Source] |
| 7 | custom 指令零 → 正常執行 | AC-011-009 | [Source] |
| 8 | 無 predicate 序列模式不變 | AC-011-010 | [Source] |
| 9 | 無 predicate 並行模式不變 | AC-011-010 | [Derived] |
| 10 | metrics 保留在 TaskResult | AC-011-011 | [Source] |
| 11 | 無 metrics 時為 undefined | AC-011-011 | [Source] |
| 12 | 依賴失敗仍 skip | AC-011-014 | [Derived] |

## 驗證指令

```bash
# 執行 DEC-011 相關測試
pnpm --filter @devap/core test -- --grep "DEC-011"

# 執行全部測試（回歸驗證）
pnpm test
```
