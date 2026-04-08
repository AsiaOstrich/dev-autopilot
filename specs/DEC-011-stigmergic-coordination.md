# [DEC-011] Feature: Stigmergic 間接協調模式落地

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Author** | AI Assistant |
| **Created** | 2026-04-08 |
| **Priority** | High |
| **Reference** | arXiv:2604.03997 (Ledger-State Stigmergy) |

## Overview

將 DevAP 已在實踐的 stigmergic 協調模式（agent 透過讀寫 `.workflow-state/` 共享狀態進行間接協調）進行形式化：

1. 文件化 `.workflow-state/` 為 stigmergic 共享狀態媒介，定義 State-Flag 語義
2. Task 介面新增 `activationPredicate` 選填欄位，支援動態條件觸發
3. 評估 QualityGate Threshold-Trigger（度量閾值觸發額外任務）

## Motivation

基於 Ledger-State Stigmergy 論文（arXiv:2604.03997）的間接協調框架，DevAP 已經在實踐 stigmergy — agent 透過讀取 `.workflow-state/` 共享狀態協調，而非直接訊息交換。然而：

- **State-Flag 缺乏形式化**：`TaskStatus`（success/failed/skipped/...）實質上就是 stigmergic 協調旗標，但未被文件化為協調機制
- **DAG 僅支援靜態依賴**：`depends_on` 只能表達「A 完成後才執行 B」，無法表達「A 完成且測試失敗率 > 30% 時才執行 B」
- **品質門檻缺乏閾值觸發**：QualityGate 只有 pass/fail，無法根據度量閾值動態插入額外任務

論文提出三個核心協調模式：

| 模式 | 說明 | DevAP 現狀 |
|------|------|-----------|
| **State-Flag** | agent 讀取旗標決定行為 | TaskStatus 已實作但未形式化 |
| **Activation Predicates** | 形式化自主行動條件 | 僅有靜態 `depends_on` |
| **Threshold-Trigger** | 閾值觸發行為 | QualityGate 僅 pass/fail |

---

## Requirements

### Requirement 1: STIGMERGY.md 架構文件

系統 SHALL 在 `docs/STIGMERGY.md` 建立架構文件，說明 `.workflow-state/` 的 stigmergic 語義。

文件 MUST 包含：

1. `.workflow-state/` 作為 stigmergic 共享狀態媒介的定位
2. 每個 `TaskStatus` 值作為 State-Flag 的語義定義及其對下游任務的影響
3. 與直接訊息傳遞模式的區別說明

#### Scenario: STIGMERGY.md 文件存在且包含必要區段

- **GIVEN** DEC-011 實作完成
- **WHEN** 讀取 `docs/STIGMERGY.md`
- **THEN** 文件包含「共享狀態媒介」區段
- **AND** 文件包含所有 7 個 TaskStatus 值的語義定義
- **AND** 文件包含「與直接訊息傳遞的區別」區段

#### Scenario: State-Flag 語義與實際行為一致

- **GIVEN** STIGMERGY.md 定義 `success` 旗標語義為「下游任務可執行」
- **WHEN** orchestrator 處理一個前置任務為 `success` 的 task
- **THEN** 該 task 不會被跳過
- **AND** 行為與文件描述一致

### Requirement 2: ActivationPredicate 型別定義

系統 SHALL 在 `packages/core/src/types.ts` 的 `Task` 介面新增 optional `activationPredicate` 欄位。

`ActivationPredicate` 介面 MUST 包含：

- `type`: 條件類型，為 `"threshold" | "state_flag" | "custom"` 之一
- `metric?`: threshold 類型的度量名稱（如 `"test_coverage"`, `"fail_rate"`）
- `operator?`: 比較運算子（`">" | "<" | ">=" | "<=" | "=="`）
- `value?`: 閾值數值
- `taskId?`: state_flag 類型的目標任務 ID
- `expectedStatus?`: state_flag 類型的期望狀態
- `command?`: custom 類型的 shell 指令
- `description`: 人類可讀的條件說明（必填）

#### Scenario: Task 介面包含 optional activationPredicate 欄位

- **GIVEN** 現有的 `Task` 介面
- **WHEN** 新增 `activationPredicate` 欄位
- **THEN** 該欄位型別為 `ActivationPredicate | undefined`
- **AND** 不影響現有 `Task` 介面的其他欄位
- **AND** 不設定 `activationPredicate` 的 task 行為與先前完全相同

#### Scenario: ActivationPredicate 型別正確定義

- **GIVEN** `ActivationPredicate` 介面
- **WHEN** 檢查型別定義
- **THEN** `type` 欄位為必填，值域為 `"threshold" | "state_flag" | "custom"`
- **AND** `description` 欄位為必填
- **AND** `metric`, `operator`, `value` 為 threshold 類型的選填欄位
- **AND** `taskId`, `expectedStatus` 為 state_flag 類型的選填欄位
- **AND** `command` 為 custom 類型的選填欄位

### Requirement 3: Plan Validator 支援 ActivationPredicate 驗證

系統 SHALL 在 `plan-validator.ts` 中驗證 `activationPredicate` 的格式合法性。

驗證規則：

1. `threshold` 類型：`metric`、`operator`、`value` 三者 MUST 同時存在
2. `state_flag` 類型：`taskId` MUST 存在且參照 plan 中的有效 task ID
3. `custom` 類型：`command` MUST 存在且 MUST 通過 `detectDangerousCommand()` 安全檢查
4. `description` MUST 非空字串

#### Scenario: threshold 類型缺少必要欄位時驗證失敗

- **GIVEN** 一個 task 的 activationPredicate 為 `{ type: "threshold", metric: "fail_rate", description: "..." }`（缺少 `operator` 和 `value`）
- **WHEN** 執行 `validatePlan()`
- **THEN** 回傳 `valid: false`
- **AND** errors 包含說明 threshold 類型缺少 operator/value 的訊息

#### Scenario: threshold 類型三欄位齊全時驗證通過

- **GIVEN** 一個 task 的 activationPredicate 為 `{ type: "threshold", metric: "fail_rate", operator: ">", value: 0.3, description: "..." }`
- **WHEN** 執行 `validatePlan()`
- **THEN** 該 predicate 驗證通過（不產生 predicate 相關錯誤）

#### Scenario: state_flag 類型引用不存在的 taskId 時驗證失敗

- **GIVEN** 一個 task 的 activationPredicate 為 `{ type: "state_flag", taskId: "T-999", expectedStatus: "failed", description: "..." }`
- **AND** plan 中不存在 task ID `T-999`
- **WHEN** 執行 `validatePlan()`
- **THEN** 回傳 `valid: false`
- **AND** errors 包含說明 taskId `T-999` 不存在的訊息

#### Scenario: custom 類型包含危險指令時驗證失敗

- **GIVEN** 一個 task 的 activationPredicate 為 `{ type: "custom", command: "rm -rf /", description: "..." }`
- **WHEN** 執行 `validatePlan()`
- **THEN** 回傳 `valid: false`
- **AND** errors 包含危險指令偵測訊息

#### Scenario: custom 類型安全指令驗證通過

- **GIVEN** 一個 task 的 activationPredicate 為 `{ type: "custom", command: "test -f coverage.json", description: "..." }`
- **WHEN** 執行 `validatePlan()`
- **THEN** 該 predicate 驗證通過

#### Scenario: 無 activationPredicate 的 task 驗證不受影響

- **GIVEN** plan 中所有 task 都沒有 `activationPredicate` 欄位
- **WHEN** 執行 `validatePlan()`
- **THEN** 驗證結果與先前行為完全相同（向後相容）

### Requirement 4: JSON Schema 更新

系統 SHALL 更新 `plan-validator.ts` 中的 `taskSchema` 定義，加入 `activationPredicate` 的 JSON Schema 驗證。

#### Scenario: activationPredicate 通過 JSON Schema 驗證

- **GIVEN** 一個包含合法 `activationPredicate` 的 task plan JSON
- **WHEN** 執行 JSON Schema 驗證
- **THEN** schema 驗證通過
- **AND** `type` 欄位限制為 `["threshold", "state_flag", "custom"]`
- **AND** `operator` 欄位限制為 `[">", "<", ">=", "<=", "=="]`

#### Scenario: activationPredicate 含無效 type 時 schema 驗證失敗

- **GIVEN** 一個 task 的 activationPredicate 的 `type` 為 `"invalid"`
- **WHEN** 執行 JSON Schema 驗證
- **THEN** schema 驗證失敗

### Requirement 5: Orchestrator 支援 ActivationPredicate 評估

系統 SHALL 修改 `orchestrator.ts` 的 `executeOneTask()`，在依賴檢查通過後、任務執行前評估 `activationPredicate`。

評估邏輯：

1. **threshold**: 從前置任務的 `TaskResult` 中讀取相關度量，比較閾值
2. **state_flag**: 檢查指定 `taskId` 的最終 `TaskStatus` 是否符合 `expectedStatus`
3. **custom**: 執行 shell 指令，exit code `0` = 條件滿足
4. 條件不滿足 → 設為 `skipped`，記錄 `error: "activation predicate not met: {description}"`

#### Scenario: threshold 條件不滿足時 skip

- **GIVEN** task T-002 依賴 T-001，且 T-002 的 activationPredicate 為 `{ type: "threshold", metric: "fail_rate", operator: ">", value: 0.3, description: "失敗率超過 30% 才觸發重構" }`
- **AND** T-001 已完成且結果中無 fail_rate 度量（或 fail_rate <= 0.3）
- **WHEN** orchestrator 準備執行 T-002
- **THEN** T-002 狀態設為 `skipped`
- **AND** error 包含 `"activation predicate not met: 失敗率超過 30% 才觸發重構"`

#### Scenario: threshold 條件滿足時正常執行

- **GIVEN** task T-002 依賴 T-001，且 T-002 的 activationPredicate 為 `{ type: "threshold", metric: "fail_rate", operator: ">", value: 0.3, description: "..." }`
- **AND** T-001 完成且結果包含度量 `fail_rate = 0.5`
- **WHEN** orchestrator 準備執行 T-002
- **THEN** T-002 正常執行（不被 skip）

#### Scenario: state_flag 條件不滿足時 skip

- **GIVEN** task T-003 的 activationPredicate 為 `{ type: "state_flag", taskId: "T-001", expectedStatus: "failed", description: "T-001 失敗時才執行修復" }`
- **AND** T-001 的最終狀態為 `success`
- **WHEN** orchestrator 準備執行 T-003
- **THEN** T-003 狀態設為 `skipped`

#### Scenario: state_flag 條件滿足時正常執行

- **GIVEN** task T-003 的 activationPredicate 為 `{ type: "state_flag", taskId: "T-001", expectedStatus: "failed", description: "..." }`
- **AND** T-001 的最終狀態為 `failed`
- **WHEN** orchestrator 準備執行 T-003
- **THEN** T-003 正常執行

#### Scenario: custom 指令回傳非零時 skip

- **GIVEN** task T-002 的 activationPredicate 為 `{ type: "custom", command: "test -f coverage.json", description: "coverage 檔案存在時才執行" }`
- **AND** `coverage.json` 不存在（指令回傳 exit code 1）
- **WHEN** orchestrator 準備執行 T-002
- **THEN** T-002 狀態設為 `skipped`

#### Scenario: custom 指令回傳零時正常執行

- **GIVEN** task T-002 的 activationPredicate 為 `{ type: "custom", command: "test -f package.json", description: "..." }`
- **AND** `package.json` 存在（指令回傳 exit code 0）
- **WHEN** orchestrator 準備執行 T-002
- **THEN** T-002 正常執行

#### Scenario: 無 activationPredicate 時行為不變

- **GIVEN** task 沒有 `activationPredicate` 欄位
- **AND** 依賴已滿足
- **WHEN** orchestrator 準備執行該 task
- **THEN** 直接執行（與先前行為完全相同）

### Requirement 6: TaskResult 度量欄位（供 threshold 評估使用）

系統 SHALL 在 `TaskResult` 介面新增 optional `metrics` 欄位，供 threshold 類型的 activationPredicate 讀取。

```typescript
/** 執行度量（供 activationPredicate threshold 類型讀取） */
metrics?: Record<string, number>;
```

#### Scenario: TaskResult 包含 optional metrics 欄位

- **GIVEN** 現有的 `TaskResult` 介面
- **WHEN** 新增 `metrics` 欄位
- **THEN** 該欄位型別為 `Record<string, number> | undefined`
- **AND** 不影響現有 `TaskResult` 的其他欄位

### Requirement 7: QualityGate Threshold-Trigger（Future Work）

系統 SHOULD 在未來版本支援 QualityGate 根據度量閾值動態插入額外任務到 DAG。

**評估結論**：標記為 future work。理由：
- 動態修改 DAG 需要重新拓撲排序，增加複雜度
- 目前 `activationPredicate` 已可部分解決此需求（預定義條件任務 + threshold 條件）
- 建議先觀察 `activationPredicate` 的實際使用情況再決定

#### Scenario: 不實作動態 DAG 插入

- **GIVEN** DEC-011 Phase 1 實作完成
- **WHEN** 檢查 QualityGate 程式碼
- **THEN** QualityGate 不會動態插入新任務到 DAG
- **AND** 既有 QualityGate 行為不受影響

---

## Acceptance Criteria

| ID | 說明 | Requirement |
|----|------|-------------|
| AC-011-001 | `docs/STIGMERGY.md` 存在，包含 State-Flag 語義定義 | R1 |
| AC-011-002 | `ActivationPredicate` 型別定義正確，`Task.activationPredicate` 為 optional | R2 |
| AC-011-003 | plan-validator 驗證 threshold 缺少欄位時回傳錯誤 | R3 |
| AC-011-004 | plan-validator 驗證 state_flag 引用不存在 taskId 時回傳錯誤 | R3 |
| AC-011-005 | plan-validator 驗證 custom 含危險指令時回傳錯誤 | R3 |
| AC-011-006 | JSON Schema 正確定義 activationPredicate 結構 | R4 |
| AC-011-007 | orchestrator threshold 評估：條件不滿足 → skip | R5 |
| AC-011-008 | orchestrator state_flag 評估：條件不滿足 → skip | R5 |
| AC-011-009 | orchestrator custom 評估：exit code ≠ 0 → skip | R5 |
| AC-011-010 | 無 activationPredicate 時行為向後相容 | R2, R5 |
| AC-011-011 | `TaskResult.metrics` optional 欄位存在 | R6 |
| AC-011-012 | QualityGate Threshold-Trigger 標記為 future work | R7 |
| AC-011-013 | 既有 plan-validator.test.ts 全部通過（零回歸） | R3, R4 |
| AC-011-014 | 既有 orchestrator.test.ts 全部通過（零回歸） | R5 |

---

## Technical Design

### 修改檔案清單

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `docs/STIGMERGY.md` | 新增 | Stigmergic 協調架構文件 |
| `packages/core/src/types.ts` | 修改 | 新增 `ActivationPredicate` 介面、`Task.activationPredicate`、`TaskResult.metrics` |
| `packages/core/src/plan-validator.ts` | 修改 | JSON Schema 擴充 + activationPredicate 語義驗證 |
| `packages/core/src/orchestrator.ts` | 修改 | `executeOneTask()` 加入 predicate 評估邏輯 |
| `specs/task-schema.json` | 修改 | 同步 activationPredicate schema（若有獨立 schema 檔案） |

### ActivationPredicate 型別定義

```typescript
/** 比較運算子 */
export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==";

/**
 * 動態激活條件（Activation Predicate）
 *
 * 除了 depends_on 的靜態依賴外，可定義動態條件。
 * 前置任務全部完成後，還需滿足此條件才會執行。
 * 若不滿足，任務狀態設為 skipped 並記錄原因。
 *
 * 來源：DEC-011 Stigmergy — Activation Predicates (arXiv:2604.03997)
 */
export interface ActivationPredicate {
  /** 條件類型 */
  type: "threshold" | "state_flag" | "custom";

  /** threshold 類型：檢查前置任務的度量值 */
  metric?: string;
  operator?: ComparisonOperator;
  value?: number;

  /** state_flag 類型：檢查特定任務的狀態 */
  taskId?: string;
  expectedStatus?: TaskStatus;

  /** custom 類型：shell 指令回傳 0 = 滿足 */
  command?: string;

  /** 人類可讀的條件說明（必填） */
  description: string;
}
```

### Orchestrator 評估邏輯（虛擬碼）

```
executeOneTask(task, ...):
  // 1. 既有：依賴檢查
  if (deps failed) → skip

  // 2. 新增：activationPredicate 評估
  if (task.activationPredicate):
    satisfied = evaluatePredicate(task.activationPredicate, completed)
    if (!satisfied):
      return { status: "skipped", error: "activation predicate not met: {desc}" }

  // 3. 既有：safety hooks → execute → quality gate
  ...
```

### Threshold 度量讀取策略

threshold 類型從 `completed` Map 中找到前置任務的 `TaskResult.metrics`：

```typescript
function evaluateThreshold(pred, completed): boolean {
  // 聚合所有前置任務（depends_on）的 metrics
  for (const [, result] of completed) {
    const metricValue = result.metrics?.[pred.metric!];
    if (metricValue !== undefined) {
      return compare(metricValue, pred.operator!, pred.value!);
    }
  }
  // 找不到度量 → 條件不滿足
  return false;
}
```

---

## Test Plan

- [ ] `plan-validator.test.ts`: threshold 缺少欄位驗證
- [ ] `plan-validator.test.ts`: threshold 三欄位齊全通過
- [ ] `plan-validator.test.ts`: state_flag 引用不存在 taskId 驗證失敗
- [ ] `plan-validator.test.ts`: state_flag 引用有效 taskId 通過
- [ ] `plan-validator.test.ts`: custom 含危險指令驗證失敗
- [ ] `plan-validator.test.ts`: custom 安全指令通過
- [ ] `plan-validator.test.ts`: 無 activationPredicate 向後相容
- [ ] `plan-validator.test.ts`: JSON Schema 驗證 activationPredicate 結構
- [ ] `orchestrator.test.ts`: threshold 條件不滿足 → skip
- [ ] `orchestrator.test.ts`: threshold 條件滿足 → 正常執行
- [ ] `orchestrator.test.ts`: state_flag 條件不滿足 → skip
- [ ] `orchestrator.test.ts`: state_flag 條件滿足 → 正常執行
- [ ] `orchestrator.test.ts`: custom 指令非零 → skip
- [ ] `orchestrator.test.ts`: custom 指令零 → 正常執行
- [ ] `orchestrator.test.ts`: 無 predicate 行為不變
- [ ] 回歸：既有 plan-validator.test.ts 全部通過
- [ ] 回歸：既有 orchestrator.test.ts 全部通過

---

## Constraints

- `activationPredicate` 為 optional，不影響現有 DAG 行為
- 不引入 Event-Signal 模式（不需要事件驅動）
- 不引入區塊鏈或持久化概念（`.workflow-state/` 檔案系統已足夠）
- `custom` command MUST 通過 `detectDangerousCommand()` 安全檢查
- QualityGate Threshold-Trigger 標記為 future work
- 既有測試零回歸
