# SPEC-002 意圖驗證系統（Intent Validation System）

**狀態**: Implemented
**建立日期**: 2026-03-09
**作者**: devap team
**前置**: SPEC-001（品質強制系統）

---

## Summary

SPEC-001 解決了「技術正確」問題（測試通過、品質門檻、自動修復）。
SPEC-002 解決「意圖正確」問題——確保產出真正符合使用者想要的結果。

**核心問題**：系統只驗證「code 符合 spec」，不驗證「code 解決使用者的問題」。

## Motivation

### 三層品質模型

```
第 1 層 — 技術正確：編譯、測試、lint     ← SPEC-001 已解決
第 2 層 — 規格正確：code 符合 spec        ← SPEC-001 Judge 已解決
第 3 層 — 意圖正確：code 解決使用者問題   ← 本 SPEC 要解決
```

### 具體問題

1. `spec` 是自由格式字串，agent 容易忽略隱含需求
2. `verify_command` 只有一個指令，無法表達多維度驗收
3. Judge 只審查「code 品質」，不審查「是否解決問題」
4. 全自動執行，使用者完全沒有介入機會
5. 沒有回饋迴圈處理「技術正確但意圖不符」的情況

---

## Requirements

### REQ-001: Acceptance Criteria 結構化
Task 新增 `acceptance_criteria` 欄位（string[]），每條是一個可觀察的驗收條件。

### REQ-002: User Intent 欄位
Task 新增 `user_intent` 欄位（string），描述「為什麼需要這個功能」。

### REQ-003: Intent-Aware Judge
Judge prompt 注入 acceptance_criteria 和 user_intent，逐條驗收。Judge 結果新增 `criteria_results` 結構化輸出。

### REQ-004: 層間 Checkpoint
Orchestrator 新增 `checkpoint_policy`（after_each_layer / after_critical / never），在指定時機暫停並向使用者呈現進度摘要，等待確認後繼續。

### REQ-005: Acceptance Criteria 注入 Agent Prompt
claudemd-generator 將 acceptance_criteria 注入 sub-agent 的 CLAUDE.md，讓 agent 從一開始就知道驗收標準。

---

## Acceptance Criteria

- AC-1: Given task 有 acceptance_criteria，when generateClaudeMd()，then prompt 包含每條 criteria
- AC-2: Given task 有 user_intent，when Judge 審查，then prompt 包含 user_intent 且 Judge 判斷意圖達成度
- AC-3: Given task 有 acceptance_criteria，when Judge 審查，then JudgeResult 包含 criteria_results 逐條結果
- AC-4: Given checkpoint_policy="after_each_layer"，when 一層完成，then 呼叫 onCheckpoint 回呼並等待確認
- AC-5: Given 無 acceptance_criteria 的舊 plan，when 執行，then 行為與現有完全相同（向後相容）

---

## Technical Design

### Phase A — 結構化驗收（Task + Prompt + Judge）

```
types.ts:
  Task += acceptance_criteria?: string[]
  Task += user_intent?: string
  JudgeResult += criteria_results?: CriteriaResult[]

claudemd-generator.ts:
  generateClaudeMd() 注入 acceptance_criteria + user_intent

judge.ts:
  buildJudgePrompt() 注入 criteria，要求逐條判定
  parseJudgeOutput() 解析 criteria_results
```

### Phase B — 層間 Checkpoint

```
types.ts:
  OrchestratorOptions += checkpointPolicy?: CheckpointPolicy
  OrchestratorOptions += onCheckpoint?: CheckpointCallback

orchestrator.ts:
  每層完成後，依 policy 呼叫 onCheckpoint
  onCheckpoint 回傳 continue / abort / retry_layer

Claude Code 模式 (SKILL.md):
  每層完成後輸出摘要，詢問使用者是否繼續
```

### 資料流

```
TaskPlan { tasks: [{ acceptance_criteria: [...], user_intent: "..." }] }
  │
  ▼ claudemd-generator
  │  注入 acceptance_criteria + user_intent 到 agent prompt
  │
  ▼ agent 執行（從一開始就知道驗收標準）
  │
  ▼ Quality Gate（SPEC-001）
  │
  ▼ Intent-Aware Judge
  │  ├── 逐條 acceptance_criteria 判定
  │  ├── user_intent 達成度評估
  │  └── criteria_results 結構化輸出
  │
  ▼ 層間 Checkpoint（若啟用）
  │  ├── 呈現本層結果摘要
  │  ├── 列出 criteria 通過/未通過
  │  └── 使用者確認 → 繼續 / 中止 / 重做本層
  │
  ▼ 下一層...
```

---

## Risks

| 風險 | 影響 | 緩解 |
|------|------|------|
| acceptance_criteria 寫得模糊 | Judge 無法精確判定 | 提供範例和格式指引 |
| Checkpoint 打斷自動化流程 | 使用者需等待 | 支援 never policy；Claude Code 可非同步通知 |
| Judge 的 criteria_results 解析不穩定 | 結構化輸出不可靠 | 增加 fallback：解析失敗時降級為 boolean |
| 向後相容 | 舊 plan 不能壞 | 所有新欄位 optional，缺失時走舊邏輯 |

---

## Test Plan

### Phase A
- [ ] Unit: types — acceptance_criteria 和 user_intent 為 optional
- [ ] Unit: claudemd-generator — 有 criteria 時注入 prompt
- [ ] Unit: claudemd-generator — 無 criteria 時與現有一致
- [ ] Unit: judge — buildJudgePrompt 含 criteria + intent
- [ ] Unit: judge — parseJudgeOutput 解析 criteria_results
- [ ] Unit: plan-resolver — acceptance_criteria 傳遞到 ResolvedTask

### Phase B
- [ ] Unit: orchestrator — checkpoint_policy=never 不暫停
- [ ] Unit: orchestrator — checkpoint_policy=after_each_layer 每層呼叫 onCheckpoint
- [ ] Unit: orchestrator — onCheckpoint 回傳 abort 時中止
- [ ] Integration: 完整 plan 含 criteria + checkpoint 流程
