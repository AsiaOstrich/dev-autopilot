# SPEC-005: Anthropic ToS 合規保護（ToS Compliance Safeguards）

**狀態**: Implemented
**建立日期**: 2026-03-22
**作者**: devap team
**前置**: 無

---

## Summary

DevAP 作為自動化編排器，透過 Claude Agent SDK 和 Claude CLI 自動派發任務給 AI Agent。根據 Anthropic 最新政策（2025-09 更新），自動化使用必須透過 **API key 認證**（Commercial Terms），而非 OAuth token（Consumer Terms）。

本 SPEC 定義 DevAP 應具備的合規保護機制，確保使用者在正確的授權條件下操作。

**核心問題**：DevAP 目前缺乏認證驗證和使用者告知，可能導致使用者在不知情的情況下違反 Anthropic ToS。

## Motivation

### 政策背景

Anthropic 有兩套條款：

| 條款 | 適用對象 | 自動化使用 |
|------|---------|-----------|
| Consumer Terms (Free/Pro/Max) | OAuth token | **禁止** bot/script 自動存取 |
| Commercial Terms (API key) | `ANTHROPIC_API_KEY` | **允許**程式化呼叫 |

Claude Code Legal and Compliance 明確規定：

> "OAuth authentication is intended **exclusively** for Claude Code and Claude.ai. Using OAuth tokens in any other product — **including the Agent SDK** — is not permitted."
>
> "Developers building products using the Agent SDK should use **API key authentication** through Claude Console."

### DevAP 現況缺口

1. CLI 啟動時無任何合規提醒
2. Adapter 不驗證認證方式（API key vs OAuth）
3. README 未說明認證要求
4. 無 plan 層級的總預算上限
5. Judge 權限模式未加說明

---

## Requirements

### REQ-001: 首次執行合規告知
DevAP CLI 首次執行時，應向使用者顯示合規提醒，使用者確認後記錄於 `~/.devap/terms-accepted`，後續不再顯示。

### REQ-002: 認證方式偵測
當 `agentType` 為 `claude` 或 `cli` 時，DevAP 應檢查 `ANTHROPIC_API_KEY` 環境變數是否存在，未設定時印出警告（不阻擋執行）。

### REQ-003: 文件告知
README 和 Adapter Guide 應包含認證要求、合規聲明和政策連結。

### REQ-004: Plan 層級預算上限
TaskPlan 支援 `max_total_budget_usd` 欄位，Orchestrator 在累計成本超過此值時停止執行。

### REQ-005: SPEC-005 合規規格
建立本文件作為合規決策的長期參考。

---

## Technical Design

### D1. 首次執行合規告知

**檔案**：`packages/cli/src/index.ts`

新增 `checkTermsAccepted()` 函式：
```typescript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

function checkTermsAccepted(): void {
  const devapDir = resolve(homedir(), ".devap");
  const markerPath = resolve(devapDir, "terms-accepted");

  if (existsSync(markerPath)) return;

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  devap — Anthropic API 使用須知                                ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                ║
║  devap 透過 AI Agent 自動執行任務。使用前請確認：              ║
║                                                                ║
║  1. 使用 Anthropic API key 認證（非 OAuth token）              ║
║     → 設定 ANTHROPIC_API_KEY 環境變數                          ║
║                                                                ║
║  2. 已閱讀並同意 Anthropic 使用條款：                          ║
║     → Commercial Terms: anthropic.com/legal/commercial-terms   ║
║     → Usage Policy: anthropic.com/legal/aup                    ║
║                                                                ║
║  3. Pro/Max 方案的 OAuth 認證僅供個人互動使用，                ║
║     不適用於自動化編排場景                                     ║
║                                                                ║
╚══════════════════════════════════════════════════════════════════╝
`);

  mkdirSync(devapDir, { recursive: true });
  writeFileSync(markerPath, new Date().toISOString());
}
```

在 `devap run` action 開頭呼叫 `checkTermsAccepted()`。
支援 `--accept-terms` flag 和 `DEVAP_ACCEPT_TERMS=1` 環境變數靜默此提醒（CI 用）。

### D2. 認證方式偵測

**檔案**：`packages/cli/src/adapter-factory.ts`

在 `createAdapter()` 中，當 agentType 為 `claude` 或 `cli` 時：

```typescript
function warnIfNoApiKey(agentType: string): void {
  if (agentType !== "claude" && agentType !== "cli") return;
  if (process.env.ANTHROPIC_API_KEY) return;

  console.warn(
    "⚠️  未偵測到 ANTHROPIC_API_KEY 環境變數。\n" +
    "   DevAP 自動化編排需使用 API key 認證（Commercial Terms）。\n" +
    "   Pro/Max OAuth token 不適用於自動化場景。\n" +
    "   → 設定方式：export ANTHROPIC_API_KEY=sk-ant-...\n" +
    "   → 詳見：https://www.anthropic.com/legal/commercial-terms\n"
  );
}
```

此為 **警告不阻擋** — 印出訊息後繼續執行。原因：
- Claude CLI 可能透過其他方式認證（如 `.claude` 設定檔）
- DevAP 不應強制要求特定認證流程
- 使用者可能在 CI 中透過其他方式注入認證

### D3. Plan 層級預算上限

**TS 型別修改** — `packages/core/src/types.ts`：

```typescript
export interface TaskPlan {
  // ... existing fields
  /** 整個 plan 的總預算上限（美元），超過即停止 */
  max_total_budget_usd?: number;
}
```

**Python 型別修改** — `python/devap/models/types.py`：

```python
class TaskPlan(BaseModel):
    # ... existing fields
    max_total_budget_usd: float | None = None
```

**Orchestrator 修改** — `packages/core/src/orchestrator.ts` + `python/devap/orchestrator.py`：

在 task 執行迴圈中，累計 `cost_usd` 並檢查是否超過 `plan.max_total_budget_usd`：

```typescript
// 在每個 task 完成後
totalCost += result.cost_usd ?? 0;
if (plan.max_total_budget_usd && totalCost >= plan.max_total_budget_usd) {
  options.onProgress?.(`⚠️ 總成本 $${totalCost.toFixed(2)} 已達上限 $${plan.max_total_budget_usd}，停止執行`);
  // 將剩餘 tasks 標記為 skipped
  break;
}
```

**Schema 修改** — `specs/task-schema.json`：

頂層 properties 新增：
```json
"max_total_budget_usd": {
  "type": "number",
  "minimum": 0,
  "description": "Maximum total budget for the entire plan in USD"
}
```

### D4. Judge 權限模式註解

**檔案**：`packages/core/src/judge.ts` (L348)

為現有的 `--permission-mode default` 加上 JSDoc 說明：

```typescript
// Judge 使用 default 權限模式（唯讀審查），不需要 acceptEdits。
// 這是刻意的設計選擇：Judge 只讀取 diff 和 verify output，不修改檔案。
"--permission-mode", "default",
```

### D5. README 合規段落

**檔案**：`README.md`

在 `## Quick Start` 之前新增：

```markdown
## Authentication & Compliance

DevAP dispatches tasks to AI agents autonomously. This requires proper authentication:

### Required: Anthropic API Key

DevAP's automated orchestration falls under Anthropic's **Commercial Terms**. You must use an API key (not OAuth):

\```bash
export ANTHROPIC_API_KEY=sk-ant-...
\```

> **Important**: Pro/Max plan OAuth tokens are for personal interactive use only.
> Automated orchestration via DevAP requires an API key from [Claude Console](https://console.anthropic.com/).

### Applicable Policies

| Policy | Link |
|--------|------|
| Commercial Terms | https://www.anthropic.com/legal/commercial-terms |
| Usage Policy | https://www.anthropic.com/legal/aup |
| Claude Code Legal | https://code.claude.com/docs/en/legal-and-compliance |

### Cost Control

DevAP provides multiple layers of cost protection:

- **Task level**: `max_budget_usd` per task (default: $2.00)
- **Plan level**: `max_total_budget_usd` for entire plan
- **Fix Loop**: `max_retry_budget_usd` caps retry costs
- **`--dry-run`**: Validate without executing
```

### D6. Adapter Guide 更新

**檔案**：`docs/adapter-guide.md`

新增「認證與合規」章節，說明各 adapter 的認證要求：

| Adapter | 認證方式 | 環境變數 |
|---------|---------|---------|
| `claude` (Agent SDK) | API key（必須） | `ANTHROPIC_API_KEY` |
| `cli` (Claude CLI) | API key（建議） | `ANTHROPIC_API_KEY` |
| `opencode` | OpenCode 設定 | 依 OpenCode 文件 |
| `vibeops` | HTTP API token | `config.apiToken` |

### D7. Python 端對齊

所有 TS 側的修改需在 Python 側同步：

- `python/devap/adapters/cli_adapter.py`：`is_available()` 中加入 API key 警告
- `python/devap/adapters/claude_adapter.py`：同上
- `python/devap/orchestrator.py`：`max_total_budget_usd` 檢查
- `python/devap/models/types.py`：`TaskPlan` 新增欄位

---

## Acceptance Criteria

### AC-005-001: 首次執行合規告知

```gherkin
Given 使用者首次執行 devap run
When ~/.devap/terms-accepted 不存在
Then 顯示合規告知框（含 API key 要求、政策連結）
  And 建立 ~/.devap/terms-accepted 標記檔

Given 使用者已接受過告知
When ~/.devap/terms-accepted 存在
Then 不顯示合規告知

Given CI 環境
When DEVAP_ACCEPT_TERMS=1 或 --accept-terms 被設定
Then 不顯示合規告知並自動建立標記檔
```

### AC-005-002: API key 偵測警告

```gherkin
Given agentType 為 claude 或 cli
When ANTHROPIC_API_KEY 環境變數未設定
Then 印出警告訊息（含設定方式和政策連結）
  And 繼續執行（不阻擋）

Given ANTHROPIC_API_KEY 已設定
When 建立 adapter
Then 不印出警告
```

### AC-005-003: Plan 層級預算上限

```gherkin
Given plan.max_total_budget_usd = 10.0
When 累計 task 成本達到 $10.00
Then 停止執行後續 tasks
  And 將剩餘 tasks 標記為 skipped
  And 報告中記錄 stop_reason

Given plan 未設定 max_total_budget_usd
When 所有 tasks 執行完畢
Then 行為不變（向後相容）
```

### AC-005-004: README 認證段落

```gherkin
Given 使用者閱讀 README.md
Then 能找到「Authentication & Compliance」段落
  And 段落包含 API key 設定指引
  And 段落包含 Anthropic 政策連結
  And 段落包含費用控制說明
```

### AC-005-005: 向後相容

```gherkin
Given 現有的 task plan JSON（不含 max_total_budget_usd）
When 以新版 devap 執行
Then 行為完全不變

Given 現有的 CI pipeline
When 升級 devap 版本
Then 首次提醒可透過 DEVAP_ACCEPT_TERMS=1 靜默
  And API key 警告不影響 exit code
```

---

## Test Plan

### 單元測試

- [ ] `packages/cli/src/__tests__/terms-check.test.ts`：首次提醒、已接受、CI 靜默
- [ ] `packages/cli/src/__tests__/adapter-factory.test.ts`：API key 存在/缺失的警告行為
- [ ] `packages/core/src/__tests__/orchestrator.test.ts`：`max_total_budget_usd` 預算超限
- [ ] `python/tests/test_orchestrator.py`：Python 版預算上限
- [ ] `python/tests/test_types.py`：`TaskPlan.max_total_budget_usd` 欄位
- [ ] `specs/task-schema.json`：schema 含新欄位

### 整合測試

- [ ] `devap run --plan test.json --dry-run`：確認首次提醒出現
- [ ] `DEVAP_ACCEPT_TERMS=1 devap run --plan test.json --dry-run`：確認靜默
- [ ] `ANTHROPIC_API_KEY="" devap run --plan test.json --dry-run`：確認警告出現

---

## 相依性

| 相依項 | 類型 | 說明 |
|--------|------|------|
| Anthropic Commercial Terms | 外部政策 | 定義 API key 使用條款 |
| Anthropic AUP | 外部政策 | 定義 agentic use 限制 |
| Claude Code Legal | 外部文件 | 定義 OAuth vs API key 要求 |

---

## 實作優先順序

| Phase | 任務 | 說明 |
|-------|------|------|
| 1 (P0) | README 合規段落 + CLI 首次提醒 | 最基本的使用者告知 |
| 2 (P1) | API key 偵測 + Adapter 警告 + 本 SPEC | Runtime 保護 |
| 3 (P2) | Adapter Guide + Judge 註解 + Plan 預算上限 | 完善文件與功能 |

---

## 參考來源

- [Anthropic Terms of Service](https://www.anthropic.com/terms)
- [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms)
- [Anthropic Acceptable Use Policy](https://www.anthropic.com/legal/aup)
- [Claude Code Legal and Compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Anthropic Usage Policy Update (Sept 2025)](https://www.anthropic.com/news/usage-policy-update)
