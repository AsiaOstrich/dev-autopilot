# SPEC-001 devap 品質強制系統

**狀態**: Implemented
**建立日期**: 2026-03-09
**核准日期**: 2026-03-09
**作者**: devap team

---

## Summary

devap 目前是一個「編排引擎」，能正確地按照 DAG 排序、派發任務、產出報告，但**不強制任何軟體品質標準**。品質完全依賴 plan 作者的自律。

**根本問題**：devap 是**單次射擊（fire-and-forget）架構**，缺乏**回饋迴圈（feedback loop）**。

本規格設計一套**品質強制系統（Quality Enforcement System）**，使 devap 產出的軟體是**高品質的成品**，而非需要反覆修改的半成品。

## Motivation

### 問題

1. **Judge 是 opt-in** — `judge: true` 可完全不設，審查可被跳過
2. **verify_command 可選** — task 可以不設驗證指令，盲跑完就算成功
3. **無品質門檻** — 無 lint、型別檢查、測試覆蓋率要求
4. **失敗無自愈** — task 失敗或 judge REJECT 後，直接標記失敗，不重試
5. **無祕密掃描** — safety-hook 不偵測硬編碼密鑰

### 期望

使用 devap 執行一個 task plan 後：
- 每個 task 都經過驗證（測試通過）
- 程式碼都經過審查（Judge 或 reviewer）
- 危險操作被攔截（含祕密洩露）
- 失敗的 task 自動重試修復（有限次數）
- 最終產出的是可合併、可部署的程式碼

---

## 設計決策（來自頭腦風暴）

### 核心洞察

透過 5 Whys 分析，根本原因是缺乏**回饋迴圈**。解法核心：

1. **Fix Loop** — 從「pass/fail」升級為「fail → feedback → retry → re-verify」
2. **Quality Profile** — 零摩擦品質預設，一行 `quality: "standard"` 啟用完整檢查
3. **Cost Circuit Breaker** — fix loop 必須有成本熔斷器，防止無限燒錢
4. **Static Analysis First** — 先用免費的靜態分析攔截明顯問題，省去昂貴的 Judge 成本
5. **Post-Execution Checklist** — 個別 task 通過不代表整體能 build

### Quality Profile 定義

```
strict:    verify + lint + type-check + judge(always) + max_retries: 2
standard:  verify + judge(on_change) + max_retries: 1
minimal:   verify only + max_retries: 0
none:      向後相容，等同現在行為
```

預設值：`standard`（新 plan）/ `none`（缺少 quality 欄位的舊 plan）

---

## Requirements

### REQ-001: Quality Profile
plan 層級新增 `quality` 欄位，支援 `strict` / `standard` / `minimal` / `none` 四種預設模板。也可用物件格式自訂每個門檻。

### REQ-002: Fix Loop（自動修復迴圈）
當 verify_command 失敗或 Judge REJECT 時，自動將錯誤回饋注入 agent prompt 重試。受 `max_retries` 和 `max_retry_budget_usd` 限制。

### REQ-003: Cost Circuit Breaker（成本熔斷器）
per-task `max_retry_budget_usd` + per-plan `total_budget_usd` 雙層成本上限。超過即停止重試。

### REQ-004: Quality Gate（品質門檻）
每個 task 執行後依序通過：verify_command → lint_command（若設定）→ type_check_command（若設定）。全部通過才進入 Judge 階段。

### REQ-005: Judge Policy
plan 層級 `judge_policy`：`always` / `on_change`（git diff 非空才審）/ `never`。Judge REJECT 時，reasoning 注入 agent 的修復 prompt。

### REQ-006: 品質報告增強
ExecutionReport 新增 `quality_metrics`：驗證通過率、Judge 通過率、重試次數、每 task 重試成本。

### REQ-007: 祕密掃描
safety-hook 新增硬編碼祕密偵測（AWS key、API token、密碼模式）。

---

## Acceptance Criteria

- AC-1: Given `quality: "standard"` plan，when 解析時，then 自動展開為 verify + judge(on_change) + max_retries: 1
- AC-2: Given verify_command 失敗且 max_retries > 0，when fix loop 啟用，then stderr 注入 agent prompt 重試
- AC-3: Given fix loop 重試成本超過 max_retry_budget_usd，when 下一次重試觸發，then 停止重試並標記 failed
- AC-4: Given judge_policy=always 且 Judge REJECT，when fix loop 啟用，then reasoning 注入 agent prompt 重試
- AC-5: Given 所有 tasks 完成，when 產出 execution_report.json，then 包含 quality_metrics 欄位
- AC-6: Given task spec 含 `AKIA` 開頭字串（AWS key 模式），when safety check，then 偵測為 safety_issue
- AC-7: Given `quality: "none"` 或無 quality 欄位，when 執行，then 行為與現有完全相同（向後相容）

---

## Technical Design

### 實作分層

```
Phase A — 核心迴圈（本次實作）
├── types.ts: QualityProfile, QualityConfig, FixLoopConfig 型別
├── quality-profile.ts: profile 展開為 QualityConfig（純函式）
├── fix-loop.ts: 重試邏輯 + 成本熔斷
├── plan-resolver.ts: 整合 quality profile 解析
└── plan-resolver.test.ts + quality-profile.test.ts + fix-loop.test.ts

Phase B — 品質門檻（下次）
├── quality-gate.ts: verify + lint + type-check 執行器
├── judge.ts: judge_policy + REJECT feedback
├── orchestrator.ts: 整合 fix-loop + quality-gate + judge
└── 整合測試

Phase C — 報告 + 安全（再下次）
├── types.ts: QualityMetrics 型別
├── safety-hook.ts: 祕密掃描
├── orchestrator.ts: 品質報告輸出
└── 報告測試
```

### Phase A 資料流

```
TaskPlan { quality: "standard" }
  │
  ▼
quality-profile.ts: resolveQualityProfile("standard")
  │
  ▼ QualityConfig { verify: true, judge_policy: "on_change", max_retries: 1, ... }
  │
  ▼
plan-resolver.ts: resolvePlan() — 將 QualityConfig 附加到 ResolvedPlan
  │
  ▼ ResolvedPlan { quality: QualityConfig, ... }
```

```
fix-loop.ts: runWithFixLoop(executeFn, verifyFn, config)
  │
  ├─ attempt 1: executeFn() → verifyFn() → FAIL
  │     └─ 檢查成本 → 未超限 → 注入 error feedback → retry
  ├─ attempt 2: executeFn(feedback) → verifyFn() → PASS → ✅
  │
  └─ 或 attempt 2: 成本超限 → ❌ failed + 報告重試次數
```

---

## Dependencies

- 依賴現有 `plan-resolver.ts`、`types.ts`
- 無外部新依賴

## Risks

| 風險 | 影響 | 緩解 |
|------|------|------|
| Fix loop 燒錢 | 成本暴增 | Cost Circuit Breaker 雙層熔斷 |
| 向後相容破壞 | 舊 plan 無法執行 | 無 quality 欄位 = `none`，行為不變 |
| Quality Profile 過於僵化 | 使用者需要自訂 | 支援物件格式自訂覆寫 |

---

## Test Plan

### Phase A ✅
- [x] Unit: quality-profile.ts — 四種 profile 展開正確
- [x] Unit: quality-profile.ts — 自訂 QualityConfig 覆寫
- [x] Unit: fix-loop.ts — 成功路徑（第 1 次通過）
- [x] Unit: fix-loop.ts — 重試成功路徑（第 1 次失敗、第 2 次通過）
- [x] Unit: fix-loop.ts — 超過 max_retries 停止
- [x] Unit: fix-loop.ts — 超過 max_retry_budget_usd 停止
- [x] Unit: fix-loop.ts — feedback 正確注入
- [x] Unit: plan-resolver.ts — quality profile 解析
- [x] Unit: plan-resolver.ts — 無 quality 欄位向後相容

### Phase B ✅
- [x] Unit: quality-gate.ts — verify/lint/type_check 各步驟通過/失敗
- [x] Unit: judge.ts — shouldRunJudge policy 判斷（6 種情境）
- [x] Integration: orchestrator + fix-loop — 品質模式完整流程
- [x] Integration: orchestrator — feedback 注入驗證
- [x] Integration: orchestrator — quality_metrics 產出

### Phase C ✅
- [x] Unit: safety-hook.ts — 祕密掃描（AWS key、API token、密碼、GitHub PAT、Slack、私鑰）
- [x] Unit: plan-resolver.ts — spec 中祕密偵測
- [x] Integration: orchestrator — quality_metrics 報告（pass rate、retries、first pass rate）
- [x] Integration: orchestrator — none 模式不產出 quality_metrics
