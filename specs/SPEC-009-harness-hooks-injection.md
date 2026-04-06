# SPEC-009 Feature: Harness Hooks Configuration Injection

- **Status**: Draft
- **Author**: AsiaOstrich
- **Created**: 2026-04-03
- **Depends on**: SPEC-007 (Full Hooks Strategy Engine)

## Overview

將 SPEC-007 生成的 hooks 配置實際注入 Claude Adapter 執行流程。`executeTask()` 在啟動 `query()` 前，根據 task 的 quality profile 動態寫入 worktree 級 `.claude/settings.json`；`quality-gate` 檢查 hook telemetry 避免重複驗證；並透過 debounce 機制防止高頻觸發拖慢 agent。

## Motivation

### 現狀問題

1. **SPEC-007 產出無消費者** — `generateFullHooksStrategy()` 和 `writeHarnessConfig()` 已實作，但 `claude-adapter.ts` 的 `executeTask()` 從未呼叫它們。hooks 配置從未寫入 worktree。
2. **品質檢查只在事後** — agent 完成全部工作後才由 Quality Gate 執行 lint/type-check，浪費 token（agent 持續在錯誤的基礎上堆疊）。
3. **重複驗證** — 若 PostToolUse hook 已在寫檔時執行 lint/type-check，Quality Gate 事後再跑一次相同指令是浪費。
4. **高頻觸發風險** — agent 連續多次 Write/Edit 同一檔案時，每次都觸發完整 lint/type-check 可能使 hook 延遲累積，拖慢整體執行。

### 期望目標

- `quality: "strict"` 的 task，agent 寫檔後即時收到 lint/type-check 回饋
- `quality: "none"` 的 task，不注入任何 PostToolUse/Stop hooks（僅保留 PreToolUse 安全攔截）
- Hook 配置僅存在於 worktree，不影響主 repo
- Quality Gate 能感知 hook 已執行的檢查，跳過重複步驟
- Debounce 機制確保同一檔案 5 秒內只觸發一次品質檢查

## Requirements

### Requirement 1: executeTask 注入 hooks 配置

系統 SHALL 在 `ClaudeAdapter.executeTask()` 呼叫 `query()` 前，根據 task 關聯的 QualityConfig 生成並寫入 hooks 配置到 worktree 的 `.claude/settings.json`。

#### Scenario: strict 模式注入完整 hooks

- **GIVEN** task 的 quality profile 為 `"strict"`，含 `lint_command: "pnpm lint"` 和 `type_check_command: "pnpm tsc --noEmit"`
- **WHEN** `executeTask()` 被呼叫
- **THEN** 在呼叫 `query()` 前，`{cwd}/.claude/settings.json` 已寫入包含 PreToolUse + PostToolUse + Stop hooks 的完整配置

#### Scenario: none 模式僅注入安全 hooks

- **GIVEN** task 的 quality profile 為 `"none"`
- **WHEN** `executeTask()` 被呼叫
- **THEN** `{cwd}/.claude/settings.json` 僅包含 PreToolUse 安全攔截 hooks，無 PostToolUse 和 Stop

#### Scenario: 無 QualityConfig 時不注入

- **GIVEN** `executeTask()` 未收到 QualityConfig（向後相容）
- **WHEN** 執行任務
- **THEN** 不建立 `.claude/settings.json`，行為與升級前一致

### Requirement 2: 執行完成後清理 hooks 配置

系統 SHALL 在 `query()` 完成（成功或失敗）後，清理 task-specific 的 `.claude/settings.json`。

#### Scenario: 正常完成清理

- **GIVEN** `executeTask()` 已寫入 hooks 配置
- **WHEN** `query()` 正常完成
- **THEN** `{cwd}/.claude/settings.json` 被刪除

#### Scenario: 異常結束仍清理

- **GIVEN** `executeTask()` 已寫入 hooks 配置
- **WHEN** `query()` 拋出異常
- **THEN** `{cwd}/.claude/settings.json` 仍被刪除（finally 保證）

### Requirement 3: QualityConfig 透過 ExecuteOptions 傳遞

系統 SHALL 擴展 `ExecuteOptions` 介面，新增 `qualityConfig` 欄位，供 Orchestrator 將已解析的品質設定傳遞給 adapter。

#### Scenario: Orchestrator 傳遞 QualityConfig

- **GIVEN** Orchestrator 已透過 `resolveQualityProfile()` 取得 QualityConfig
- **WHEN** 呼叫 `adapter.executeTask(task, options)` 時設定 `options.qualityConfig`
- **THEN** adapter 使用此 QualityConfig 生成 hooks 配置

### Requirement 4: Quality Gate hook telemetry 去重

系統 SHALL 在 `runQualityGate()` 開始時，檢查是否有 hook telemetry 表明 lint/type-check 已被 PostToolUse hooks 執行過且通過，若是則跳過對應步驟。

#### Scenario: hook 已執行 lint，Quality Gate 跳過

- **GIVEN** PostToolUse hook 已在 agent 執行期間成功執行 `pnpm lint`（telemetry 記錄存在）
- **WHEN** `runQualityGate()` 執行到 lint 步驟
- **THEN** 跳過 lint 步驟，在 steps 中記錄 `{ name: "lint", passed: true, output: "Skipped: hook telemetry indicates pass" }`

#### Scenario: 無 telemetry 時正常執行

- **GIVEN** 無 hook telemetry（adapter 非 Claude 或 quality: "none"）
- **WHEN** `runQualityGate()` 執行到 lint 步驟
- **THEN** 正常執行 lint 指令

#### Scenario: hook 報告失敗，Quality Gate 仍執行

- **GIVEN** hook telemetry 記錄 lint 失敗
- **WHEN** `runQualityGate()` 執行到 lint 步驟
- **THEN** 仍正常執行 lint 指令（不信任失敗後的修復結果，需重新驗證）

### Requirement 5: PostToolUse hook debounce 機制

系統 SHALL 在生成的 PostToolUse hook 腳本中實作 debounce，同一檔案在 5 秒內只觸發一次品質檢查。

#### Scenario: 連續寫入同一檔案

- **GIVEN** agent 在 2 秒內對 `src/index.ts` 執行 3 次 Write
- **WHEN** 每次 Write 觸發 PostToolUse hook
- **THEN** 僅第 1 次實際執行 lint/type-check，後 2 次跳過並回傳 exit 0

#### Scenario: 不同檔案不受 debounce 影響

- **GIVEN** agent 對 `src/a.ts` 和 `src/b.ts` 各執行 1 次 Write
- **WHEN** PostToolUse hooks 被觸發
- **THEN** 兩次都實際執行品質檢查

#### Scenario: debounce 過期後重新觸發

- **GIVEN** agent 對 `src/index.ts` 執行 Write，等待 6 秒後再次 Write
- **WHEN** 第 2 次 PostToolUse hook 被觸發
- **THEN** 第 2 次實際執行品質檢查（debounce 已過期）

## Acceptance Criteria

- [ ] AC-1: `executeTask()` 在 `query()` 前寫入 hooks 配置到 `{cwd}/.claude/settings.json`
- [ ] AC-2: `quality: "strict"` 生成包含 PostToolUse lint/type-check hooks 的配置
- [ ] AC-3: `quality: "none"` 不生成 PostToolUse/Stop hooks（僅 PreToolUse 安全攔截）
- [ ] AC-4: `query()` 完成後（包含異常）清理 `.claude/settings.json`
- [ ] AC-5: `ExecuteOptions` 新增 `qualityConfig?: QualityConfig` 欄位
- [ ] AC-6: `runQualityGate()` 在有 hook telemetry 且 pass 時跳過對應步驟
- [ ] AC-7: PostToolUse hook 腳本含 debounce（5 秒 / 同一檔案）
- [ ] AC-8: 向後相容 — 不傳 `qualityConfig` 時行為不變
- [ ] AC-9: hooks 配置不影響主 repo（僅寫入 worktree 級 `.claude/`）
- [ ] AC-10: 既有測試無 regression

## Technical Design

### 架構概覽

```
Orchestrator
  │
  ├── resolveQualityProfile(plan) → QualityConfig
  │
  └── adapter.executeTask(task, { ...options, qualityConfig })
        │
        ├── generateFullHooksStrategy(qualityConfig, { verifyCommand })
        │     → FullHooksConfig
        │
        ├── writeHarnessConfig(config, cwd)
        │     → {cwd}/.claude/settings.json
        │
        ├── query({ prompt, options })   ← Claude Agent SDK
        │
        └── cleanupHarnessConfig(cwd)    ← finally block
              → 刪除 {cwd}/.claude/settings.json
```

### 修改範圍

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `packages/core/src/types.ts` | 修改 | `ExecuteOptions` 新增 `qualityConfig?: QualityConfig` |
| `packages/adapter-claude/src/claude-adapter.ts` | 修改 | `executeTask()` 注入 hooks 配置 + finally 清理 |
| `packages/adapter-claude/src/harness-config.ts` | 修改 | 新增 `cleanupHarnessConfig()`、debounce 腳本生成 |
| `packages/core/src/quality-gate.ts` | 修改 | `runQualityGate()` 新增 hook telemetry 去重邏輯 |
| `packages/core/src/quality-gate.ts` | 修改 | `QualityGateOptions` 新增 `hookTelemetry?: HookTelemetry` |

### ExecuteOptions 擴展

```typescript
// packages/core/src/types.ts
export interface ExecuteOptions {
  cwd: string;
  sessionId?: string;
  forkSession?: boolean;
  onProgress?: (message: string) => void;
  modelTier?: ModelTier;
  /** 品質設定（由 Orchestrator 傳入，adapter 用於生成 hooks） */
  qualityConfig?: QualityConfig;
}
```

### executeTask 修改

```typescript
// packages/adapter-claude/src/claude-adapter.ts
async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
  const startTime = Date.now();

  // Phase 1: 注入 hooks 配置
  const hooksWritten = await this.injectHarnessHooks(task, options);

  try {
    const prompt = this.buildPrompt(task);
    const sdkOptions = this.buildOptions(task, options);

    // ... existing query logic ...

    return this.buildResult(task, sessionId, resultMessage, startTime);
  } catch (error) {
    // ... existing error handling ...
  } finally {
    // Phase 3: 清理 hooks 配置
    if (hooksWritten) {
      await cleanupHarnessConfig(options.cwd);
    }
  }
}

private async injectHarnessHooks(task: Task, options: ExecuteOptions): Promise<boolean> {
  if (!options.qualityConfig) return false;

  const config = generateFullHooksStrategy(options.qualityConfig, {
    verifyCommand: task.verify_command,
  });

  await writeHarnessConfig(config, options.cwd);
  return true;
}
```

### cleanupHarnessConfig

```typescript
// packages/adapter-claude/src/harness-config.ts
export async function cleanupHarnessConfig(targetDir: string): Promise<void> {
  const settingsPath = join(targetDir, ".claude", "settings.json");
  try {
    await unlink(settingsPath);
  } catch {
    // 檔案不存在或已清理，忽略
  }
}
```

### Debounce 腳本機制

在生成的 PostToolUse hook 腳本中，使用檔案系統時戳實作 debounce：

```bash
#!/bin/bash
# DevAP PostToolUse Hook — Lint (with debounce)
DEBOUNCE_DIR="/tmp/devap-hooks-debounce"
mkdir -p "$DEBOUNCE_DIR"

# 從 stdin 讀取 hook input 取得檔案路徑
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [ -z "$FILE_PATH" ]; then exit 0; fi

# Debounce：檢查同一檔案 5 秒內是否已觸發
HASH=$(echo "$FILE_PATH" | md5sum | cut -d' ' -f1)
STAMP_FILE="$DEBOUNCE_DIR/$HASH"
NOW=$(date +%s)

if [ -f "$STAMP_FILE" ]; then
  LAST=$(cat "$STAMP_FILE")
  DIFF=$((NOW - LAST))
  if [ "$DIFF" -lt 5 ]; then
    exit 0  # Debounced — skip
  fi
fi
echo "$NOW" > "$STAMP_FILE"

# 執行品質檢查
pnpm lint 2>&1
```

### Hook Telemetry 去重

```typescript
// packages/core/src/quality-gate.ts

/** Hook telemetry 記錄 */
export interface HookTelemetry {
  /** lint hook 最後一次執行結果 */
  lint_passed?: boolean;
  /** type_check hook 最後一次執行結果 */
  type_check_passed?: boolean;
}

export interface QualityGateOptions {
  cwd: string;
  shellExecutor: ShellExecutor;
  onProgress?: (message: string) => void;
  /** Hook telemetry（若有，跳過已通過的步驟） */
  hookTelemetry?: HookTelemetry;
}
```

在 `runQualityGate()` 的 lint/type-check 步驟前加入：

```typescript
// lint_command（兩種模式都執行）
if (qualityConfig.lint_command) {
  if (options.hookTelemetry?.lint_passed) {
    steps.push({
      name: "lint",
      command: qualityConfig.lint_command,
      passed: true,
      output: "Skipped: hook telemetry indicates pass",
    });
  } else {
    // ... existing lint execution ...
  }
}
```

### writeHarnessConfig 擴展

現有 `writeHarnessConfig()` 僅處理 `HooksConfig`（只有 PostToolUse），需擴展支援 `FullHooksConfig`：

```typescript
export async function writeHarnessConfig(
  config: HooksConfig | FullHooksConfig,
  targetDir: string,
): Promise<void> {
  const hooks = "hooks" in config ? config.hooks : undefined;
  if (!hooks || Object.keys(hooks).length === 0) return;

  const claudeDir = join(targetDir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  const settingsPath = join(claudeDir, "settings.json");
  const settings = { hooks };
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}
```

## Test Plan

### 單元測試

- [ ] `harness-config.test.ts` — `cleanupHarnessConfig()` 正常刪除 / 不存在不拋錯
- [ ] `harness-config.test.ts` — `writeHarnessConfig()` 支援 `FullHooksConfig`
- [ ] `harness-config.test.ts` — debounce 腳本包含正確的時戳邏輯
- [ ] `claude-adapter.test.ts` — `executeTask()` 有 qualityConfig 時寫入 + 清理
- [ ] `claude-adapter.test.ts` — `executeTask()` 無 qualityConfig 時不寫入
- [ ] `claude-adapter.test.ts` — `query()` 拋錯時仍清理（finally）
- [ ] `quality-gate.test.ts` — 有 `hookTelemetry.lint_passed` 時跳過 lint
- [ ] `quality-gate.test.ts` — 無 telemetry 時正常執行
- [ ] `quality-gate.test.ts` — telemetry 報告 lint 失敗時仍執行

### 整合測試

- [ ] 端到端：Orchestrator → ClaudeAdapter → hooks 寫入 → 清理
- [ ] 向後相容：不傳 qualityConfig 的既有呼叫行為不變

### 回歸測試

- [ ] 既有 `harness-config.test.ts` 無 regression
- [ ] 既有 `quality-gate.test.ts` 無 regression
- [ ] 既有 `orchestrator.test.ts` 無 regression

## Implementation Tasks

| Task | 說明 | 依賴 |
|------|------|------|
| T-001 | 擴展 `ExecuteOptions` 新增 `qualityConfig` | - |
| T-002 | 實作 `cleanupHarnessConfig()` | - |
| T-003 | 擴展 `writeHarnessConfig()` 支援 `FullHooksConfig` | - |
| T-004 | 修改 `executeTask()` — hooks 注入 + finally 清理 | T-001, T-002, T-003 |
| T-005 | 實作 debounce 腳本生成 | - |
| T-006 | 新增 `HookTelemetry` 介面與 QualityGate 去重邏輯 | - |
| T-007 | 撰寫單元測試 | T-001 ~ T-006 |
| T-008 | 撰寫整合測試 | T-007 |

## Risk

- **[中]** Debounce 使用 `/tmp` — 不同 task 可能衝突 → 使用 task-specific 子目錄 `/tmp/devap-hooks-{taskId}/`
- **[中]** Hook telemetry 來源未定 — Claude Agent SDK 目前不回傳 hook 執行記錄 → Phase 1 可改用「讀取 debounce stamp 檔案」作為簡易 telemetry
- **[低]** `settings.json` 已存在使用者自訂設定 → 應 merge 而非覆蓋（Phase 2 改進）
- **[低]** `jq` 未安裝的環境 — debounce 腳本需 fallback（SPEC-007 已列此風險）
