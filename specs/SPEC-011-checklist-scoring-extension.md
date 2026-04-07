# SPEC-011: Checklist Scoring Extension for QualityGateResult

**狀態**: Draft
**建立日期**: 2026-04-07
**跨專案參考**: XSPEC-005 Phase 2B（dev-platform/cross-project/specs/）
**依賴**: UDS Phase 2B（checklist scoring standard）須先完成

> **本文件為自足規格**，包含所有實作所需的完整介面定義和變更位置。
> 不需要讀取 dev-platform 的文件即可進行開發。

---

## 摘要

為 DevAP 的 `QualityGateResult` 介面新增 optional `score` 和 `max_score` 欄位，讓 Judge agent 可參考量化的規格品質評分作為 APPROVE/REJECT 的依據。

## 動機

UDS 正在實作 Checklist Scoring 功能（XSPEC-005 Phase 2B），為規格產生量化品質評分（Standard mode /10，Boost mode /25）。DevAP 的 QualityGate 是下游消費這些評分的自然介入點，但目前 `QualityGateResult` 只有布林值 `passed`，無法傳遞量化分數。

---

## 要修改的檔案

### 1. `packages/core/src/types.ts`

修改 `QualityGateResult` 介面，新增兩個 optional 欄位：

```typescript
export interface QualityGateResult {
  /** 是否全部通過 */
  passed: boolean;
  /** 各步驟結果 */
  steps: QualityGateStep[];
  /** 失敗的回饋訊息（用於 fix loop 注入 agent prompt） */
  feedback?: string;
  /** 驗證證據（借鑑 Superpowers Iron Law：Evidence before claims） */
  evidence: VerificationEvidence[];
  /** 規格品質評分（由 UDS checklist scoring 提供） */
  score?: number;
  /** 規格品質滿分（Standard mode = 10, Boost mode = 25） */
  max_score?: number;
}
```

**向後相容**：兩個欄位皆為 optional (`?`)，現有消費者不受影響。

### 2. `packages/core/src/quality-gate.ts`

#### 2a. `runQualityGate()` 函式（約 line 104-237）

在函式回傳結果前，新增 scoring 邏輯：

```typescript
// 在建構 result 物件時：
const result: QualityGateResult = {
  passed: steps.every(s => s.passed),
  steps,
  evidence,
  // 新增：如果 task 帶有 spec_score 資訊，傳遞到結果
  ...(task.spec_score != null && {
    score: task.spec_score,
    max_score: task.spec_max_score ?? (task.spec_score <= 10 ? 10 : 25),
  }),
};
```

#### 2b. `buildFailResult()` 函式（約 line 365-380）

在失敗回饋中包含 score 資訊（如果存在）：

```typescript
function buildFailResult(steps, evidence, task): QualityGateResult {
  const failedSteps = steps.filter(s => !s.passed);
  const feedback = failedSteps
    .map(s => `[${s.name}] FAILED:\n${s.output}`)
    .join('\n---\n');

  return {
    passed: false,
    steps,
    feedback,
    evidence,
    // 新增
    ...(task?.spec_score != null && {
      score: task.spec_score,
      max_score: task.spec_max_score ?? (task.spec_score <= 10 ? 10 : 25),
    }),
  };
}
```

### 3. `packages/core/src/types.ts`（Task 介面）

在 `Task` 介面新增 optional 欄位，讓 plan.json 可以攜帶 spec score：

```typescript
export interface Task {
  // ... 現有欄位 ...

  /** 規格品質評分（由 UDS checklist scoring 提供，optional） */
  spec_score?: number;
  /** 規格品質滿分 */
  spec_max_score?: number;
}
```

### 4. `specs/task-schema.json`

在 JSON Schema 中新增對應欄位：

```json
{
  "spec_score": {
    "type": "number",
    "description": "Spec quality score from UDS checklist scoring"
  },
  "spec_max_score": {
    "type": "number",
    "description": "Maximum possible spec quality score (10 for standard, 25 for boost)"
  }
}
```

---

## 不修改的部分

- **Judge agent 邏輯**：Judge 已可讀取 `QualityGateResult` 的所有欄位。新增的 `score` / `max_score` 會自動出現在 Judge 的 input context 中，無需額外修改 Judge prompt。
- **Fix loop**：Fix loop 以 `passed` 布林值驅動，score 不影響重試邏輯。
- **Orchestrator**：Orchestrator 只關心 `passed`，score 為 advisory。

---

## Acceptance Criteria

- [ ] AC-1: `QualityGateResult` 介面包含 `score?: number` 和 `max_score?: number`
- [ ] AC-2: `Task` 介面包含 `spec_score?: number` 和 `spec_max_score?: number`
- [ ] AC-3: `runQualityGate()` 當 task 帶有 `spec_score` 時，結果包含 score
- [ ] AC-4: `runQualityGate()` 當 task 不帶 `spec_score` 時，結果不包含 score（向後相容）
- [ ] AC-5: `buildFailResult()` 同樣傳遞 score（如果存在）
- [ ] AC-6: `task-schema.json` 包含 `spec_score` 和 `spec_max_score` 定義
- [ ] AC-7: 現有所有測試仍通過（無 breaking change）

---

## 測試計畫

### Unit Tests

在 `packages/core/src/__tests__/quality-gate.test.ts` 新增：

```typescript
describe('QualityGateResult scoring', () => {
  it('should include score when task has spec_score', async () => {
    const task = { ...baseTask, spec_score: 8, spec_max_score: 10 };
    const result = await runQualityGate(task, config, options);
    expect(result.score).toBe(8);
    expect(result.max_score).toBe(10);
  });

  it('should not include score when task lacks spec_score', async () => {
    const result = await runQualityGate(baseTask, config, options);
    expect(result.score).toBeUndefined();
    expect(result.max_score).toBeUndefined();
  });

  it('should infer max_score=10 when score<=10 and max not specified', async () => {
    const task = { ...baseTask, spec_score: 7 };
    const result = await runQualityGate(task, config, options);
    expect(result.max_score).toBe(10);
  });

  it('should infer max_score=25 when score>10 and max not specified', async () => {
    const task = { ...baseTask, spec_score: 18 };
    const result = await runQualityGate(task, config, options);
    expect(result.max_score).toBe(25);
  });
});
```

### Verification Commands

```bash
cd packages/core
npm test -- --grep "scoring"           # 執行 scoring 相關測試
npx tsc --noEmit                       # 確認型別正確
```
