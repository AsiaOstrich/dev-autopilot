# ATDD 追蹤表：Issue #4 — CLAUDE.md 注入增強

> Source: GitHub Issue #4
> Ref: XSPEC-002 Section 1.2

## AC ↔ 測試追蹤矩陣

| AC | 驗收條件 | BDD 場景 | TDD 測試 | 狀態 |
|----|---------|----------|---------|------|
| AC-1 | strict quality → 品質要求 section | `Scenario: strict 品質模式注入品質要求` | `[AC-1] qualityConfig 為 strict 時注入品質要求 section` | ⬜ RED |
| AC-1 | 無 quality → 無品質要求 | `Scenario: 無 qualityConfig 時不注入品質要求` | `[AC-1] 無 qualityConfig 時不注入品質要求 section` | ⬜ RED |
| AC-1 | minimal quality → 仍有品質要求 | — | `[AC-1] qualityConfig 僅有 verify 時仍注入品質要求` | ⬜ RED |
| AC-2 | 所有 plan → Harness 提示 | `Scenario: 始終注入 Harness 提示` | `[AC-2] 無 qualityConfig 時仍注入 Harness 提示` | ⬜ RED |
| AC-2 | 有 quality → 也有 Harness | — | `[AC-2] 有 qualityConfig 時也注入 Harness 提示` | ⬜ RED |
| AC-2 | Harness 含 Quality Gate 提醒 | — | `[AC-2] Harness 提示包含 Quality Gate 驗證提醒` | ⬜ RED |
| AC-3 | 總行數 ≤ 200 | `Scenario: 完整內容不超過 200 行` | `[AC-3] 完整內容不超過 200 行` | ⬜ RED |
| AC-4 | 新增測試通過 | `Scenario: 新增測試涵蓋所有新功能` | 本表所有 TDD 測試 | ⬜ RED |
| AC-5 | 無 regression | `Scenario: 現有測試無回歸` | 既有 7 個測試 | ✅ GREEN |

## 驗證指令

```bash
cd packages/core && npm test
```

## Section 順序規格

```
## Task: T-XXX - ...
## 你的角色
## 任務規格
## 驗收條件          ← (若有)
## 使用者意圖         ← (若有)
## 約束
## 品質要求           ← (若有 qualityConfig) [NEW]
## Harness 提示       ← (始終注入) [NEW]
## 專案原始指引       ← (若有 existingClaudeMdPath)
```
