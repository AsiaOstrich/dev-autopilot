# SPEC-014: DevAP Epistemic Routing — DAG 認知路由支援

> **狀態**: Implemented
> **建立日期**: 2026-04-13
> **對應**: XSPEC-008 Phase 4
> **影響元件**: `fix_loop.py`, `orchestrator.py`, `models/types.py`

## 摘要

實作 XSPEC-008 Phase 4：DAG 引擎區分 `ask`/`abstain` 與一般執行失敗，Fix Loop 對認知動作不觸發重試。

## 使用者故事

### US-3: DevAP 路由支援（來自 XSPEC-008）

As a DevAP DAG 引擎,
I want 當 agent 回報 Ask 或 Abstain 時有明確的路由策略,
So that 任務編排不因 agent 的不確定性而崩潰。

## 驗收條件

- [x] **AC-1**: Given Fix Loop 執行時 agent 的 `ExecuteResult.epistemic_action == "ask"`，When `run_fix_loop` 處理，Then 立即返回 `stop_reason="ask"`，不觸發重試
- [x] **AC-2**: Given Fix Loop 執行時 agent 的 `ExecuteResult.epistemic_action == "abstain"`，When `run_fix_loop` 處理，Then 立即返回 `stop_reason="abstain"`，不觸發重試
- [x] **AC-3**: Given DAG 任務回傳 `status="needs_context"`，When orchestrator 記錄，Then log 訊息標示「有意識的詢問（ask）」而非「失敗」
- [x] **AC-4**: Given DAG 任務回傳 `status="blocked"`，When orchestrator 記錄，Then log 訊息標示「有意識的放棄（abstain）」而非「失敗」
- [x] **AC-5**: Given `ExecuteResult.epistemic_action` 為 `None`，When Fix Loop 處理，Then 行為與原來相同（向後相容）

## 實作

| 元件 | 修改 |
|------|------|
| `models/types.py` | 新增 `EpistemicActionType`；`FixLoopResult.stop_reason` 加入 `"ask"`, `"abstain"` |
| `fix_loop.py` | `ExecuteResult` 加 `epistemic_action`；`run_fix_loop` 早期返回邏輯 |
| `orchestrator.py` | `_execute_one_task` 對 `needs_context`/`blocked` 輸出語意化 log |
