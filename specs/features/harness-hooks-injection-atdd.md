# ATDD 追蹤表：SPEC-009 — Harness Hooks Configuration Injection

> Source: SPEC-009
> Depends on: SPEC-007 (Full Hooks Strategy Engine)

## AC ↔ 測試追蹤矩陣

| AC | 驗收條件 | BDD 場景 | TDD 測試 | 檔案 | 狀態 |
|----|---------|----------|---------|------|------|
| AC-1 | executeTask 在 query() 前寫入 hooks | `Scenario: strict 模式注入完整 hooks 配置` | `[AC-1] executeTask 有 qualityConfig 時應在 query 前呼叫 writeHarnessConfig` | hooks-injection.test.ts | GREEN |
| AC-2 | strict → PostToolUse lint/type-check | 同上 | `[AC-2] strict 模式應將包含 PostToolUse hooks 的配置傳給 writeHarnessConfig` | hooks-injection.test.ts | GREEN |
| AC-2 | writeHarnessConfig 支援 FullHooksConfig | — | `[AC-2] writeHarnessConfig 應支援 FullHooksConfig` | hooks-injection-cleanup.test.ts | GREEN |
| AC-3 | none → 無 PostToolUse/Stop | `Scenario: none 模式僅注入安全 hooks` | `[AC-3] none 模式不應生成 PostToolUse 和 Stop hooks` | hooks-injection.test.ts | GREEN |
| AC-4 | query() 完成後清理 settings.json | `Scenario: 正常完成後清理 hooks 配置` | `[AC-4] query 正常完成後應呼叫 cleanupHarnessConfig` | hooks-injection.test.ts | GREEN |
| AC-4 | query() 拋錯仍清理 | `Scenario: query() 拋出異常仍清理` | `[AC-4] query 拋錯後應仍呼叫 cleanupHarnessConfig` | hooks-injection.test.ts | GREEN |
| AC-4 | cleanupHarnessConfig 正常刪除 | — | `[AC-4] cleanupHarnessConfig 應刪除 settings.json` | hooks-injection-cleanup.test.ts | GREEN |
| AC-4 | cleanupHarnessConfig 冪等 | — | `[AC-4] cleanupHarnessConfig 檔案不存在時不應拋錯` | hooks-injection-cleanup.test.ts | GREEN |
| AC-5 | ExecuteOptions 新增 qualityConfig | `Scenario: Orchestrator 傳遞 QualityConfig` | `[AC-5] ExecuteOptions 應接受 qualityConfig 欄位` | hooks-injection.test.ts | GREEN |
| AC-6 | hookTelemetry lint pass → 跳過 | `Scenario: hook 已執行 lint 且通過` | `[AC-6] hookTelemetry.lint_passed 為 true 時應跳過 lint` | quality-gate-telemetry.test.ts | GREEN |
| AC-6 | 無 telemetry → 正常執行 | `Scenario: 無 hook telemetry 時正常執行` | `[AC-6] 無 hookTelemetry 時應正常執行 lint` | quality-gate-telemetry.test.ts | GREEN |
| AC-6 | telemetry lint fail → 仍執行 | `Scenario: hook telemetry 報告 lint 失敗` | `[AC-6] hookTelemetry.lint_passed 為 false 時應仍執行 lint` | quality-gate-telemetry.test.ts | GREEN |
| AC-6 | hookTelemetry type_check pass → 跳過 | — | `[AC-6] hookTelemetry.type_check_passed 為 true 時應跳過 type_check` | quality-gate-telemetry.test.ts | GREEN |
| AC-6 | lint + type_check 都 passed → 都跳過 | — | `[AC-6] hookTelemetry lint 和 type_check 都 passed 時應都跳過` | quality-gate-telemetry.test.ts | GREEN |
| AC-7 | debounce 同一檔案 5 秒 | `Scenario: 連續寫入同一檔案觸發 debounce` | `[AC-7] debounce 腳本應包含時戳比對邏輯` | hooks-injection-debounce.test.ts | GREEN |
| AC-7 | 不同檔案不受 debounce | `Scenario: 不同檔案不受 debounce 影響` | `[AC-7] debounce 應基於檔案路徑 hash` | hooks-injection-debounce.test.ts | GREEN |
| AC-7 | debounce 間隔 5 秒 | — | `[AC-7] debounce 間隔應為 5 秒` | hooks-injection-debounce.test.ts | GREEN |
| AC-7 | debounce 隔離路徑 | — | `[AC-7] debounce 目錄應使用 /tmp 下的隔離路徑` | hooks-injection-debounce.test.ts | GREEN |
| AC-8 | 向後相容 | `Scenario: 無 QualityConfig 時不注入` | `[AC-8] 不傳 qualityConfig 時不應呼叫 writeHarnessConfig` | hooks-injection.test.ts | GREEN |
| AC-8 | 向後相容 query 正常 | 同上 | `[AC-8] 不傳 qualityConfig 時 query 仍正常呼叫` | hooks-injection.test.ts | GREEN |
| AC-9 | hooks 不影響主 repo | `Scenario: hooks 配置僅存在於 worktree` | `[AC-9] writeHarnessConfig 應以 cwd 作為 targetDir` | hooks-injection.test.ts | GREEN |
| AC-9 | 寫入指定 targetDir | 同上 | `[AC-9] writeHarnessConfig 應寫入指定的 targetDir` | hooks-injection-cleanup.test.ts | GREEN |
| AC-10 | 既有測試無 regression | `Scenario: 既有測試無 regression` | 既有所有 test suites | 全部 *.test.ts | GREEN |

## 產出/修改檔案

### 實作檔案（待修改）

| 檔案 | 類型 | 說明 |
|------|------|------|
| `packages/core/src/types.ts` | 修改 | `ExecuteOptions` 新增 `qualityConfig?: QualityConfig` |
| `packages/adapter-claude/src/claude-adapter.ts` | 修改 | `executeTask()` hooks 注入 + finally 清理 |
| `packages/adapter-claude/src/harness-config.ts` | 修改 | `cleanupHarnessConfig()`, debounce 腳本, `writeHarnessConfig()` 支援 FullHooksConfig |
| `packages/core/src/quality-gate.ts` | 修改 | `HookTelemetry` 介面, `QualityGateOptions` 擴展, telemetry 去重邏輯 |

### TDD 測試骨架（已生成）

| 檔案 | AC 涵蓋 | 說明 |
|------|---------|------|
| `packages/adapter-claude/src/hooks-injection.test.ts` | AC-1,2,3,4,5,8,9 | executeTask hooks 注入/清理/向後相容 |
| `packages/adapter-claude/src/hooks-injection-cleanup.test.ts` | AC-2,4,9 | cleanupHarnessConfig + writeHarnessConfig FullHooksConfig |
| `packages/adapter-claude/src/hooks-injection-debounce.test.ts` | AC-7 | debounce 腳本結構驗證 |
| `packages/core/src/quality-gate-telemetry.test.ts` | AC-6 | QualityGate hookTelemetry 去重 |

### BDD 場景

| 檔案 | 說明 |
|------|------|
| `specs/features/harness-hooks-injection.feature` | 15 個 Gherkin 場景，對應全部 10 個 AC |

## 驗證指令

```bash
# 單元測試
pnpm test

# 單獨驗證
cd packages/adapter-claude && pnpm test
cd packages/core && pnpm test
```
