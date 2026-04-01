# ATDD 追蹤表：Issue #5 — PostToolUse Hook 品質檢查配置注入

> Source: GitHub Issue #5
> Ref: XSPEC-002 Section 2.2

## AC ↔ 測試追蹤矩陣

| AC | 驗收條件 | BDD 場景 | TDD 測試 | 檔案 | 狀態 |
|----|---------|----------|---------|------|------|
| AC-1 | strict → 即時 lint/type-check | `Scenario: strict 品質模式生成 PostToolUse hooks` | `[AC-1] 應生成包含 PostToolUse hook 的配置` | harness-config.test.ts | ⬜ RED |
| AC-1 | hook 含 lint_command | 同上 | `[AC-1] hook 指令應包含 lint_command` | harness-config.test.ts | ⬜ RED |
| AC-1 | hook 含 type_check_command | 同上 | `[AC-1] hook 指令應包含 type_check_command` | harness-config.test.ts | ⬜ RED |
| AC-1 | hook 限定寫檔工具 | 同上 | `[AC-1] hook 應僅在寫檔工具觸發` | harness-config.test.ts | ⬜ RED |
| AC-1 | 部分品質設定 | — | `[AC-1] 僅有 lint_command 時只生成 lint hook` | harness-config.test.ts | ⬜ RED |
| AC-2 | none → 不注入 hooks | `Scenario: none 品質模式不產生 hooks` | `[AC-2] 無 lint/type-check 時回傳空 hooks` | harness-config.test.ts | ⬜ RED |
| AC-2 | verify-only 不生成 | — | `[AC-2] verify-only 設定不生成 PostToolUse hooks` | harness-config.test.ts | ⬜ RED |
| AC-3 | 寫入 worktree settings | `Scenario: Hook 配置寫入 worktree` | `[AC-3] 應寫入 worktree 下的 .claude/settings.json` | harness-config.integration.test.ts | ⬜ RED |
| AC-3 | 不影響主 repo | 同上 | `[AC-3] 不應影響主 repo` | harness-config.integration.test.ts | ⬜ RED |
| AC-3 | 無 hooks 不建立 | — | `[AC-3] 無 hooks 時不建立 settings.json` | harness-config.integration.test.ts | ⬜ RED |
| AC-4 | QualityGate 仍正常 | `Scenario: QualityGate 仍完整驗證` | 既有 quality-gate.test.ts（29 tests） | quality-gate.test.ts | ✅ GREEN |
| AC-5 | 無 regression | `Scenario: 現有測試無回歸` | 既有 claude-adapter.test.ts（10 tests） | claude-adapter.test.ts | ✅ GREEN |

## 新增檔案

| 檔案 | 類型 | 說明 |
|------|------|------|
| `packages/adapter-claude/src/harness-config.ts` | 新增 | `generateHarnessHooks()`, `writeHarnessConfig()` |
| `packages/adapter-claude/src/harness-config.test.ts` | 新增 | AC-1, AC-2 單元測試 |
| `packages/adapter-claude/src/harness-config.integration.test.ts` | 新增 | AC-3 整合測試 |

## 型別定義（預期）

```typescript
// harness-config.ts
interface HookEntry {
  command: string;
  matcher: { tool_name: string } | { tool_name: RegExp };
}

interface HooksConfig {
  hooks?: {
    PostToolUse?: HookEntry[];
  };
}

function generateHarnessHooks(qualityConfig: QualityConfig): HooksConfig;
async function writeHarnessConfig(config: HooksConfig, targetDir: string): Promise<void>;
```

## 驗證指令

```bash
cd packages/adapter-claude && npm test
cd packages/core && npm test
```
