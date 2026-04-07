# SPEC-011 Checklist Scoring Extension — ATDD 追蹤表

> [Source] SPEC-011 | [Generated] 2026-04-07

## AC ↔ BDD ↔ TDD 追蹤矩陣

| AC | 驗收條件 | BDD 場景 | TDD 測試 | 檔案 | 狀態 |
|----|----------|----------|----------|------|------|
| AC-1 | `QualityGateResult` 包含 `score?: number` 和 `max_score?: number` | Background 前提條件 | `[AC-1] QualityGateResult 型別包含 score 與 max_score` (2 tests) | `packages/core/src/quality-gate.ts` | GREEN ✅ |
| AC-2 | `Task` 包含 `spec_score?: number` 和 `spec_max_score?: number` | Background 前提條件 | `[AC-2] Task 型別包含 spec_score 與 spec_max_score` (2 tests) | `packages/core/src/types.ts` | GREEN ✅ |
| AC-3 | `runQualityGate()` 帶 `spec_score` 時結果包含 score | `品質門檻通過時傳遞規格評分` (Outline, 4 examples) + `未指定 max_score 時自動推斷模式` (Outline, 5 examples) | `[AC-3] runQualityGate — spec_score 存在時傳遞` (4 tests) | `packages/core/src/quality-gate.ts` | GREEN ✅ |
| AC-4 | `runQualityGate()` 不帶 `spec_score` 時不包含 score | `品質門檻結果不含 score 當 task 未設定規格評分` | `[AC-4] runQualityGate — 無 spec_score 時向後相容` (2 tests) | `packages/core/src/quality-gate.ts` | GREEN ✅ |
| AC-5 | `buildFailResult()` 傳遞 score | `品質門檻失敗時仍傳遞規格評分` + `品質門檻失敗且無規格評分時不包含 score` | `[AC-5] buildFailResult — spec_score 存在時傳遞` (2 tests) | `packages/core/src/quality-gate.ts` | GREEN ✅ |
| AC-6 | `task-schema.json` 包含欄位定義 | `task-schema.json 包含 scoring 欄位定義` | `[AC-6] task-schema.json 包含 scoring 欄位` (2 tests) | `specs/task-schema.json` | GREEN ✅ |
| AC-7 | 現有測試無 regression | `新增欄位後現有測試無 regression` | 全套件 416 tests 通過 | N/A | GREEN ✅ |

## 修改檔案清單

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `packages/core/src/quality-gate.ts` | 修改 | `QualityGateResult` 新增 `score?`、`max_score?`；`runQualityGate()` 傳遞 score；`buildFailResult()` 傳遞 score |
| `packages/core/src/types.ts` | 修改 | `Task` 新增 `spec_score?`、`spec_max_score?` |
| `specs/task-schema.json` | 修改 | 新增 `spec_score`、`spec_max_score` 欄位定義 |
| `packages/core/src/__tests__/checklist-scoring.test.ts` | 新增 | SPEC-011 測試 |

## TDD 測試骨架摘要

| 測試檔案 | 測試數 | 覆蓋 AC |
|----------|--------|---------|
| `packages/core/src/__tests__/checklist-scoring.test.ts` | 14 | AC-1 ~ AC-6 |
| 全套件回歸 | 既有 | AC-7 |

## max_score 推斷規則

[Source] 當 `spec_max_score` 未指定時：
- `spec_score <= 10` → `max_score = 10`（Standard mode）
- `spec_score > 10` → `max_score = 25`（Boost mode）

## 驗證指令

```bash
# 執行 SPEC-011 相關測試
pnpm --filter @devap/core test -- --grep "SPEC-011"

# 型別檢查
pnpm --filter @devap/core exec tsc --noEmit

# 執行全部測試（回歸驗證）
pnpm test
```
