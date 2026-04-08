# Stigmergic 間接協調架構

> **來源**: DEC-011 | arXiv:2604.03997 (Ledger-State Stigmergy)
> **建立日期**: 2026-04-08

## 概述

DevAP 採用 **stigmergy（間接協調）** 模式讓 agent 之間進行協調。Agent 不直接交換訊息，而是透過讀寫共享狀態媒介（`.workflow-state/` 目錄）間接通訊。

## 共享狀態媒介

### `.workflow-state/` 目錄

`.workflow-state/` 是 DevAP 的 stigmergic 共享狀態媒介：

- 每個 task 的執行結果寫入此目錄
- 下游 agent 讀取目錄中的檔案決定行為
- 目錄內容構成 agent 之間的唯一協調訊號

```
.workflow-state/
├── T-001.json    # Task T-001 的執行結果
├── T-002.json    # Task T-002 的執行結果
└── ...
```

### Orchestrator 作為媒介管理者

Orchestrator 負責：
1. 維護 `completed` Map（記憶體中的共享狀態）
2. 依據 DAG 拓撲順序派發任務
3. 將 `TaskResult` 寫入共享狀態
4. 評估下游任務的 State-Flag 和 Activation Predicate

## State-Flag 語義定義

`TaskStatus` 是 agent 間的協調旗標。每個值定義了明確的下游行為：

| State-Flag | 語義 | 下游影響 |
|------------|------|---------|
| `success` | 任務正常完成 | 下游任務可執行 |
| `failed` | 任務執行失敗 | 下游任務跳過（依賴失敗） |
| `skipped` | 任務被跳過 | 傳播跳過至下游 |
| `timeout` | 任務逾時 | 等同 `failed`，下游任務跳過 |
| `done_with_concerns` | 完成但有疑慮 | 下游任務可執行，但需注意疑慮內容 |
| `needs_context` | 需要更多上下文 | 暫停等待外部輸入 |
| `blocked` | 無法完成 | 需人工升級處理 |

### 狀態轉換規則

```
OPEN（待執行）
  ├── → success          下游可繼續
  ├── → failed           下游跳過
  ├── → skipped          下游跳過
  ├── → timeout          下游跳過
  ├── → done_with_concerns  下游可繼續（附帶疑慮）
  ├── → needs_context    暫停等待
  └── → blocked          人工介入
```

### 依賴判定邏輯

Orchestrator 在執行任務前檢查所有前置任務的 State-Flag：

```typescript
// 允許繼續的狀態
const canContinue = status === "success" || status === "done_with_concerns";
// 其餘狀態 → 跳過下游任務
```

## Activation Predicates（動態激活條件）

除了 `depends_on` 的靜態依賴，任務可定義 `activationPredicate` 動態條件。前置任務全部完成後，還需滿足此條件才會執行。

### 三種類型

| 類型 | 說明 | 判定方式 |
|------|------|---------|
| `threshold` | 度量閾值比較 | 讀取前置任務的 `TaskResult.metrics`，比較閾值 |
| `state_flag` | 特定任務狀態檢查 | 檢查指定 `taskId` 的 `TaskStatus` |
| `custom` | Shell 指令判定 | 執行指令，exit code `0` = 條件滿足 |

### 評估流程

```
依賴檢查通過？
  │
  ├── 否 → skip（依賴失敗）
  │
  └── 是 → 有 activationPredicate？
              │
              ├── 否 → 直接執行
              │
              └── 是 → 評估 predicate
                        │
                        ├── 滿足 → 執行任務
                        │
                        └── 不滿足 → skip
                              （記錄 "activation predicate not met: {description}"）
```

### 範例

```json
{
  "id": "T-003",
  "title": "重構低品質模組",
  "spec": "針對失敗率過高的模組進行重構",
  "depends_on": ["T-002"],
  "activationPredicate": {
    "type": "threshold",
    "metric": "fail_rate",
    "operator": ">",
    "value": 0.3,
    "description": "測試失敗率超過 30% 才觸發重構"
  }
}
```

## 與直接訊息傳遞的區別

| 面向 | Stigmergy（DevAP） | 直接訊息傳遞 |
|------|-------------------|-------------|
| 通訊方式 | 讀寫共享狀態 | Agent 間直接 RPC/Event |
| 耦合程度 | 低（agent 只需知道狀態格式） | 高（需知道對方介面） |
| 擴展性 | 新增 agent 不影響現有 agent | 需修改通訊拓撲 |
| 協調可見性 | 狀態可觀察（檔案系統） | 訊息易揮發 |
| 失敗隔離 | agent 獨立失敗，不影響共享狀態 | 訊息遺失可能導致連鎖失敗 |

DevAP 選擇 stigmergy 的理由：

1. **Agent-agnostic**: 不同 agent（Claude、OpenCode、CLI）只需讀寫相同格式的共享狀態
2. **可觀察性**: `.workflow-state/` 的檔案內容即協調歷史
3. **簡單性**: 不需要事件匯流排、訊息佇列等基礎設施

## 相關檔案

| 檔案 | 說明 |
|------|------|
| `packages/core/src/types.ts` | `TaskStatus`、`ActivationPredicate` 型別定義 |
| `packages/core/src/orchestrator.ts` | 共享狀態管理 + predicate 評估 |
| `packages/core/src/plan-validator.ts` | ActivationPredicate 格式驗證 |
| `specs/DEC-011-stigmergic-coordination.md` | 完整規格 |
