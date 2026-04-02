# SPEC-007 Feature: Full Hooks Strategy Engine

- **Status**: Draft
- **Author**: AsiaOstrich
- **Created**: 2026-04-01
- **Depends on**: SPEC-001 (Quality Gate), Issue #5 (PostToolUse Hook)

## Overview

將 `generateHarnessHooks()` 從僅支援 PostToolUse 擴展為完整的 Claude Code hooks 策略引擎，涵蓋 PreToolUse（安全攔截）、PostToolUse（品質檢查）、Stop（品質門檻 gate）三大事件類型。同時將現有 safety-hook.ts 的危險指令模式轉換為可生成 PreToolUse hook 腳本的機制，實現「從自建攔截到原生 hooks」的架構演化。

## Motivation

### 現狀問題

1. **safety-hook.ts 僅在 plan-resolver 階段檢查** — 靜態掃描 task spec/verify_command 中的危險指令，但無法攔截 agent 在執行期動態產生的危險操作
2. **PostToolUse 是唯一支援的 hook** — Claude Code 有 31 種 hook 事件，DevAP 僅利用其中 1 種
3. **Quality Gate 是事後驗證** — agent 完成全部工作後才跑品質檢查，浪費 token 和時間

### 期望目標

- **PreToolUse hooks** 在 agent 執行 `Bash(rm -rf *)` 前即時攔截（exit code 2 = block）
- **Stop hooks** 在 agent 結束前自動執行 verify_command，不通過則要求繼續
- **PostToolUse hooks** 維持現有 lint/type-check 即時回饋

## Requirements

### Requirement 1: 擴展 HooksConfig 支援多事件類型

系統 SHALL 支援生成 PreToolUse、PostToolUse、Stop 三種 hook 事件的配置。

#### Scenario: 完整品質策略生成

- **GIVEN** qualityConfig 為 strict 模式，含 lint_command、type_check_command、verify_command
- **WHEN** 呼叫 `generateFullHooksStrategy()`
- **THEN** 回傳的 HooksConfig 包含 PreToolUse（安全攔截）、PostToolUse（品質檢查）、Stop（品質門檻）三種 hooks

#### Scenario: minimal 品質策略只生成 PreToolUse

- **GIVEN** qualityConfig 為 minimal 模式（無 lint/type-check）
- **WHEN** 呼叫 `generateFullHooksStrategy()`
- **THEN** 回傳僅包含 PreToolUse（安全攔截，始終存在），無 PostToolUse 和 Stop

### Requirement 2: Safety Hook 轉換為 PreToolUse hook 腳本

系統 SHALL 將 safety-hook.ts 的危險指令模式轉換為 PreToolUse hook 的 shell 腳本內容。

#### Scenario: 攔截 rm -rf 指令

- **GIVEN** agent 嘗試執行 `Bash(rm -rf /)`
- **WHEN** PreToolUse hook 腳本被觸發
- **THEN** hook 回傳 exit code 2，agent 收到阻止訊息

#### Scenario: 允許安全指令

- **GIVEN** agent 嘗試執行 `Bash(pnpm test)`
- **WHEN** PreToolUse hook 腳本被觸發
- **THEN** hook 回傳 exit code 0，允許執行

### Requirement 3: Stop hook 實現品質門檻 gate

系統 SHALL 生成 Stop hook，在 agent 結束回應前自動執行 verify_command。

#### Scenario: verify_command 通過

- **GIVEN** task 有 verify_command `pnpm test`
- **WHEN** agent 完成工作並觸發 Stop hook
- **THEN** hook 執行 verify_command，通過後允許結束

#### Scenario: verify_command 失敗

- **GIVEN** task 的 verify_command 失敗
- **WHEN** Stop hook 執行驗證
- **THEN** hook 回傳結構化 JSON（`decision: "block"`），要求 agent 繼續修復

### Requirement 4: 向後相容

系統 SHALL 保持 `generateHarnessHooks()` 函式簽名不變，新增 `generateFullHooksStrategy()` 作為增強版本。

#### Scenario: 既有呼叫不受影響

- **GIVEN** 專案已使用 `generateHarnessHooks(qualityConfig)`
- **WHEN** 升級到新版本
- **THEN** 行為與升級前完全一致

## Acceptance Criteria

- [ ] AC-1: `generateFullHooksStrategy()` 產出包含 PreToolUse + PostToolUse + Stop 的完整 hooks 配置
- [ ] AC-2: PreToolUse hook 腳本能攔截 `DANGEROUS_STRING_PATTERNS` + `DANGEROUS_REGEX_PATTERNS` 定義的所有危險指令
- [ ] AC-3: Stop hook 在有 verify_command 時執行驗證，失敗回傳 `decision: "block"`
- [ ] AC-4: quality: "none" 時仍生成 PreToolUse 安全攔截（安全永遠啟用）
- [ ] AC-5: `generateHarnessHooks()` 行為不變（向後相容）
- [ ] AC-6: 生成的腳本可獨立執行（sh -c），不依賴 DevAP runtime
- [ ] AC-7: 現有測試無 regression

## Technical Design

### 新增函式

```typescript
// adapter-claude/src/harness-config.ts

/**
 * 完整 hooks 策略配置
 */
interface FullHooksConfig {
  hooks: {
    PreToolUse?: MatcherGroup[];   // 安全攔截（Bash 工具）
    PostToolUse?: MatcherGroup[];  // 品質檢查（Write/Edit 工具）
    Stop?: MatcherGroup[];         // 品質門檻（agent 結束前）
  };
}

/**
 * 生成完整 hooks 策略
 *
 * @param qualityConfig - 品質設定
 * @param safetyPatterns - 危險指令模式（預設使用內建模式）
 * @param verifyCommand - 驗證指令（Stop hook 使用）
 */
function generateFullHooksStrategy(
  qualityConfig: QualityConfig,
  options?: {
    verifyCommand?: string;
    disableSafety?: boolean;
  },
): FullHooksConfig;
```

### PreToolUse hook 腳本生成

```bash
#!/bin/bash
# DevAP Safety Hook — PreToolUse
# 從 stdin 讀取 JSON，檢查 tool_input.command
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
if [ "$TOOL_NAME" != "Bash" ]; then exit 0; fi
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
# 危險指令檢查
if echo "$CMD" | grep -qi 'rm -rf'; then
  echo '{"decision":"block","reason":"DevAP Safety: 偵測到 rm -rf 危險操作"}' >&2
  exit 2
fi
exit 0
```

### Stop hook 腳本生成

```bash
#!/bin/bash
# DevAP Quality Gate — Stop hook
RESULT=$(cd "$PROJECT_DIR" && pnpm test 2>&1)
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "{\"decision\":\"block\",\"reason\":\"verify_command 失敗，請修復後再結束\"}"
  exit 0  # exit 0 + decision:block = 要求 agent 繼續
fi
exit 0
```

### 修改範圍

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `adapter-claude/src/harness-config.ts` | 修改 | 新增 `generateFullHooksStrategy()`、`FullHooksConfig` |
| `adapter-claude/src/safety-script-generator.ts` | 新增 | 將危險指令模式轉為 shell 腳本 |
| `core/src/safety-hook.ts` | 不變 | 保留靜態掃描作為 plan-resolver 階段的補充 |

## Test Plan

- [ ] `harness-config.test.ts` 新增 `generateFullHooksStrategy()` 測試
- [ ] `safety-script-generator.test.ts` 新增腳本生成 + 攔截邏輯測試
- [ ] 既有 `harness-config.test.ts` 無 regression
- [ ] 既有 `safety-hook.test.ts` 無 regression

## Risk

- **[中]** PreToolUse hook 腳本需要 `jq` — 應提供 fallback（pure bash JSON 解析）
- **[低]** Stop hook 的 verify_command 可能耗時長 — 需設定合理 timeout
