# DevAP 使用說明

> Agent-agnostic 無人值守開發編排器。Plan → Execute → Review。

DevAP 將軟體開發任務拆分為結構化的 DAG（有向無環圖），交給 AI agent 自動執行，並透過品質閘門、自動修復與獨立審查確保產出品質。

---

## 目錄

1. [快速開始](#1-快速開始)
2. [核心概念](#2-核心概念)
3. [撰寫 Task Plan](#3-撰寫-task-plan)
4. [Claude Code Skills 工作流程](#4-claude-code-skills-工作流程)
5. [CLI 指令參考](#5-cli-指令參考)
6. [品質配置](#6-品質配置)
7. [成本管控](#7-成本管控)
8. [並行執行與隔離](#8-並行執行與隔離)
9. [安全機制](#9-安全機制)
10. [常見場景食譜（Cookbook）](#10-常見場景食譜cookbook)
11. [Adapter 開發指南](#11-adapter-開發指南)
12. [故障排除](#12-故障排除)
13. [最佳實踐](#13-最佳實踐)
- [附錄 A：Task Plan Schema 完整參考](#附錄-atask-plan-schema-完整參考)
- [附錄 B：ExecutionReport 格式參考](#附錄-bexecutionreport-格式參考)
- [附錄 C：術語表](#附錄-c術語表)

---

## 1. 快速開始

### 前置條件

- Node.js 18+
- pnpm（或 npm）
- `ANTHROPIC_API_KEY` 環境變數（從 [Claude Console](https://console.anthropic.com/) 取得）

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 安裝

```bash
npm install -g dev-autopilot
```

安裝後即可使用 `devap` 指令。

### 初始化目標專案

進入你的專案目錄，安裝 devap 的 Claude Code Skills：

```bash
cd my-project
devap init
```

這會在 `.claude/skills/` 下安裝三個 skill：`/plan`、`/orchestrate`、`/dev-workflow-guide`。

### 方式 A：Claude Code Skills 工作流程（推薦）

在 Claude Code 中依序執行：

```
# 1. 從需求生成 task plan
/plan "建立一個 Express + TypeScript 的 Todo API，含 CRUD 和輸入驗證"

# 2. 執行 task plan
/orchestrate plans/todo-api-plan.json
```

執行完成後查看報告：

```bash
cat execution_report.json
```

關注三個關鍵數字：`succeeded`（成功）、`failed`（失敗）、`skipped`（跳過）。

### 方式 B：CLI 模式

```bash
# 先驗證 plan（不實際執行）
devap run --plan plan.json --dry-run

# 確認無誤後執行
devap run --plan plan.json --agent cli
```

### 接下來

- 想了解原理 → [第 2 章：核心概念](#2-核心概念)
- 想自己寫 plan → [第 3 章：撰寫 Task Plan](#3-撰寫-task-plan)
- 想看完整範例 → [第 10 章：Cookbook](#10-常見場景食譜cookbook)

---

## 2. 核心概念

### 三階段工作流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Planning   │ ──→ │  Execution  │ ──→ │  Reporting  │
│  （互動）    │     │  （自動）    │     │  （互動）    │
│             │     │             │     │             │
│ 撰寫 Spec   │     │ DAG 拓撲排序 │     │ 查看報告    │
│ 生成 Plan   │     │ Agent 執行   │     │ 審閱結果    │
│ 審核 Plan   │     │ 品質閘門     │     │ 決定下一步  │
└─────────────┘     └─────────────┘     └─────────────┘
```

- **Planning**：你（人類）定義要做什麼。可以手寫 plan.json，也可以用 `/plan` skill 從 Spec 自動生成。
- **Execution**：devap 自動完成。依照 DAG 依賴順序派發任務給 AI agent，執行品質檢查、自動修復。
- **Reporting**：你審閱 `execution_report.json`，決定是否接受結果或需要調整。

### Task Plan 實例解讀

以下是一個真實的 plan.json（來自 `specs/examples/new-project-plan.json`）：

```json
{
  "project": "example-todo-api",
  "agent": "claude",
  "defaults": {
    "max_turns": 30,
    "max_budget_usd": 2.0,
    "allowed_tools": ["Read", "Write", "Edit", "Bash"]
  },
  "tasks": [
    {
      "id": "T-001",
      "title": "初始化專案結構",
      "spec": "建立 Node.js + Express + TypeScript 專案骨架，含 tsconfig、package.json、src/ 目錄",
      "depends_on": [],
      "verify_command": "pnpm build",
      "max_turns": 10,
      "max_budget_usd": 0.5
    },
    {
      "id": "T-002",
      "title": "建立 DB schema",
      "spec": "使用 Drizzle ORM 建立 todos 表：id (uuid), title (text), completed (boolean), created_at (timestamp)",
      "depends_on": ["T-001"],
      "verify_command": "pnpm build && pnpm test -- --grep schema",
      "fork_session": true
    },
    {
      "id": "T-003",
      "title": "實作 CRUD API",
      "spec": "實作 GET /todos, POST /todos, PATCH /todos/:id, DELETE /todos/:id",
      "depends_on": ["T-002"],
      "verify_command": "pnpm test -- --grep api",
      "max_turns": 30,
      "max_budget_usd": 2.0
    },
    {
      "id": "T-004",
      "title": "加入輸入驗證",
      "spec": "使用 zod 驗證所有 API 輸入，錯誤回傳 400 + 結構化 error message",
      "depends_on": ["T-003"],
      "verify_command": "pnpm test -- --grep validation"
    },
    {
      "id": "T-005",
      "title": "加入 E2E 測試",
      "spec": "使用 supertest 撰寫完整 CRUD 流程的 E2E 測試",
      "depends_on": ["T-004"],
      "verify_command": "pnpm test"
    }
  ]
}
```

重點拆解：

| 欄位 | 說明 |
|------|------|
| `project` | 專案名稱，用於報告識別 |
| `agent` | 預設使用的 AI agent（`claude` / `opencode` / `cli`） |
| `defaults` | 所有 task 共用的預設值，task 可個別覆寫 |
| `tasks[].id` | 任務 ID，格式 `T-NNN`（如 `T-001`） |
| `tasks[].spec` | **任務規格** — agent 的主要輸入，寫得越詳盡、執行越精確 |
| `tasks[].depends_on` | 依賴的前置任務 ID，形成 DAG |
| `tasks[].verify_command` | 完成後執行的驗證指令，exit code 0 = 通過 |

### defaults 繼承機制

Task 未設定的欄位會自動繼承 `defaults`：

```
plan.defaults.max_turns = 30       ← 全域預設
task.max_turns = 10                ← task 覆寫，優先使用
task.max_budget_usd = (未設定)     ← 繼承 defaults: 2.0
```

### DAG 分層與拓撲排序

上面的範例是線性鏈（T-001 → T-002 → T-003 → T-004 → T-005），但 DAG 也可以扇出：

```
        T-001
       /     \
    T-002   T-003     ← 同層，可並行
       \     /
        T-004         ← 等 T-002 和 T-003 都完成
```

devap 使用 Kahn's algorithm 對 DAG 做拓撲排序，將 task 分成多「層」。同層的 task 彼此無依賴，啟用 `--parallel` 時可同時執行。

### AgentAdapter

devap 透過 `AgentAdapter` 介面支援多種 AI agent：

| Adapter | 說明 | 適用場景 |
|---------|------|---------|
| `claude` | Claude Agent SDK | 需要 SDK 級控制的自動化場景 |
| `cli` | `claude -p` 子進程 | 零額外依賴，本機有 Claude CLI 即可 |
| `opencode` | OpenCode SDK | 使用 OpenCode 生態系 |

用 `--agent` flag 或 plan.json 的 `agent` 欄位指定。

### 雙重執行架構：CLI 模式 vs. Skill 模式

DevAP 有兩條截然不同的執行路徑，共用同一份 plan.json：

```
                    Task Plan (JSON)
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
      CLI 模式                Skill 模式
      devap run               /orchestrate
              │                     │
              ▼                     ▼
      AgentAdapter            Claude Code
      subprocess              Agent tool
      (claude -p)             (原生多 agent)
              │                     │
              ▼                     ▼
      execution_report.json   execution_report.json
```

**CLI 模式（`devap run`）**：每個 task 透過 `AgentAdapter` 啟動獨立子進程（如 `claude -p --output-format json`）。devap 自己管理進程生命週期、worktree、並行排程。

**Skill 模式（`/orchestrate`）**：直接利用 Claude Code 內建的 **Agent tool** 派發子 agent。每個 task 是一個獨立的子 agent，在 `isolation: "worktree"` 中並行執行。**不經過 AgentAdapter**。

| | CLI 模式 (`devap run`) | Skill 模式 (`/orchestrate`) |
|---|---|---|
| **執行機制** | AgentAdapter subprocess | Claude Code Agent tool |
| **並行方式** | `Promise.all()` 批次 | 同訊息多個 Agent tool（原生並行） |
| **隔離方式** | WorktreeManager（程式化） | `isolation: "worktree"`（宣告式） |
| **Prompt 品質** | 簡單拼接 task.spec | `generated_prompt`（含完整專案 context） |
| **適用場景** | CI/CD、外部腳本、非 Claude Code 環境 | Claude Code 互動開發（推薦） |

**選擇建議**：
- 在 Claude Code 中開發 → 用 `/orchestrate`（Skill 模式），直接享有原生多 agent 並行和更豐富的 context
- 在 CI/CD pipeline 或外部腳本 → 用 `devap run`（CLI 模式），不依賴 Claude Code 環境

### 品質三位一體

```
Agent 執行 task
       │
       ▼
┌─────────────┐    失敗    ┌──────────┐
│ Quality Gate│ ────────→ │ Fix Loop │ ──→ 重試（含結構化回饋）
│ verify/lint │           │ 次數+預算 │
│ type-check  │           │ 雙重限制  │
└──────┬──────┘           └──────────┘
       │ 通過
       ▼
┌─────────────┐    REJECT  ┌──────────┐
│   Judge     │ ────────→ │ Fix Loop │
│ AI 審查 AI  │           └──────────┘
│ APPROVE/    │
│ REJECT      │
└─────────────┘
```

- **Quality Gate**：執行 `verify_command`（或 `test_levels`），加上可選的 lint、type-check
- **Fix Loop**：驗證失敗時自動注入錯誤回饋重試，受 `max_retries` 和 `max_retry_budget_usd` 雙重限制
- **Judge Agent**：獨立的 AI 審查者，檢查 spec 合規性和程式碼品質

詳見 [第 6 章：品質配置](#6-品質配置)。

### 安全機制

devap 內建 Safety Hook，自動掃描 task spec 和 verify_command：
- **危險指令攔截**：`rm -rf`、`DROP DATABASE`、`git push --force` 等
- **祕密掃描**：AWS Key、API token、硬編碼密碼等

被攔截的 task 會標記為 `failed`，不會執行。

### 成本模型

三層預算控制，任一層觸頂即停止：

| 層級 | 欄位 | 說明 |
|------|------|------|
| Task 級 | `max_budget_usd` | 單一 task 的成本上限 |
| Plan 級 | `max_total_budget_usd` | 整個 plan 的累積成本上限 |
| Retry 級 | `max_retry_budget_usd` | Fix Loop 重試的成本上限 |

---

## 3. 撰寫 Task Plan

### 欄位速查表

#### 頂層欄位

| 欄位 | 必填 | 型別 | 預設值 | 說明 |
|------|:----:|------|--------|------|
| `project` | ✅ | string | — | 專案名稱 |
| `agent` | | string | `"claude"` | 預設 agent |
| `defaults` | | object | — | 所有 task 的預設值 |
| `tasks` | ✅ | array | — | 任務列表（至少一個） |
| `quality` | | string \| object | `"none"` | 品質 profile 或自訂設定 |
| `max_parallel` | | number | — | 最大並行任務數 |
| `max_total_budget_usd` | | number | — | 整個 plan 的預算上限 |
| `test_policy` | | object | — | 測試策略（金字塔比例、完成準則） |
| `session_id` | | string | — | 規劃階段的 session ID |

#### defaults 欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `max_turns` | number | 預設最大回合數 |
| `max_budget_usd` | number | 預設最大預算（美元） |
| `allowed_tools` | string[] | 預設允許的工具列表 |
| `verify_command` | string | 預設驗證指令 |
| `test_levels` | TestLevel[] | 預設多層級測試 |

#### Task 欄位

| 欄位 | 必填 | 型別 | 說明 |
|------|:----:|------|------|
| `id` | ✅ | string | 任務 ID，格式 `T-NNN` |
| `title` | ✅ | string | 任務標題 |
| `spec` | ✅ | string | 任務規格說明（agent 的主要輸入） |
| `depends_on` | | string[] | 依賴的前置任務 ID |
| `agent` | | string | 此 task 使用的 agent（覆寫頂層） |
| `verify_command` | | string | 驗證指令 |
| `test_levels` | | TestLevel[] | 多層級測試（優先於 verify_command） |
| `max_turns` | | number | 最大回合數 |
| `max_budget_usd` | | number | 最大預算 |
| `allowed_tools` | | string[] | 允許的工具 |
| `fork_session` | | boolean | 是否隔離 session（預設 true） |
| `judge` | | boolean | 是否啟用 Judge 審查 |
| `acceptance_criteria` | | string[] | 驗收條件（給 Judge 用） |
| `user_intent` | | string | 使用者意圖（為什麼需要此功能） |
| `model_tier` | | string | 建議模型等級：`fast` / `standard` / `capable` |

#### TestLevel 結構

```json
{
  "name": "unit",              // "unit" | "integration" | "system" | "e2e"
  "command": "pnpm test:unit", // 執行指令
  "timeout_ms": 60000          // 逾時（預設 120000）
}
```

### 依賴關係設計

#### 線性鏈

最簡單的結構，每個 task 依賴前一個：

```
T-001 → T-002 → T-003
```

```json
{ "id": "T-002", "depends_on": ["T-001"] },
{ "id": "T-003", "depends_on": ["T-002"] }
```

#### 扇出（Fan-out）

一個 task 完成後，多個獨立 task 同時開始：

```
        T-001
       /  |  \
  T-002 T-003 T-004
```

```json
{ "id": "T-002", "depends_on": ["T-001"] },
{ "id": "T-003", "depends_on": ["T-001"] },
{ "id": "T-004", "depends_on": ["T-001"] }
```

#### 菱形合流（Diamond）

多個 task 合流到一個：

```
  T-001   T-002
     \     /
      T-003
```

```json
{ "id": "T-003", "depends_on": ["T-001", "T-002"] }
```

#### 常見錯誤

- **循環依賴**：T-001 → T-002 → T-001 — 驗證時會報錯
- **不存在的依賴**：`depends_on: ["T-999"]` — 引用不存在的 task ID

### spec 寫作要訣

spec 是 agent 執行任務的**唯一輸入**，寫得越精確，agent 的產出越好。

**模糊（不好）：**

```json
"spec": "實作使用者認證"
```

**精確（好）：**

```json
"spec": "實作使用者認證模組：\n1. 使用 bcrypt (rounds=12) 雜湊密碼\n2. JWT access token (HS256, 15min 過期)\n3. POST /auth/login 接受 { email, password }，回傳 { token }\n4. POST /auth/register 接受 { email, password, name }\n5. 中間件 authMiddleware 從 Authorization: Bearer <token> 解碼\n6. 所有密碼欄位不得出現在 response 中"
```

**原則**：agent 拿到 spec 就能直接開始寫 code，不需要額外查閱或猜測。

### verify_command 設計

**單一指令**（簡單場景）：

```json
"verify_command": "pnpm build && pnpm test"
```

**多層級測試**（需要分層驗證時，優先於 verify_command）：

```json
"test_levels": [
  { "name": "unit", "command": "pnpm test:unit", "timeout_ms": 30000 },
  { "name": "integration", "command": "pnpm test:integration", "timeout_ms": 60000 }
]
```

**針對單一 task 過濾測試**（避免跑全部測試）：

```json
"verify_command": "pnpm test -- --grep 'auth|login'"
```

### acceptance_criteria 與 user_intent

這兩個欄位供 Judge Agent 審查時使用：

```json
{
  "id": "T-003",
  "title": "實作搜尋功能",
  "spec": "...",
  "user_intent": "使用者需要快速找到歷史訂單，目前只能手動翻頁效率太低",
  "acceptance_criteria": [
    "搜尋結果在 200ms 內回傳",
    "支援模糊搜尋（部分關鍵字匹配）",
    "空結果顯示友善提示而非空白頁面",
    "搜尋輸入有 XSS 防護"
  ]
}
```

每條 acceptance_criteria 必須是**可觀察、可驗證**的。

---

## 4. Claude Code Skills 工作流程

### `/plan` — 從 Spec 生成 task plan

四種輸入模式：

```bash
# 1. 從 Spec 檔案生成
/plan specs/SPEC-001-user-auth.md

# 2. 從 OpenSpec 變更目錄
/plan openspec/changes/add-search

# 3. 從文字描述
/plan "建立一個 REST API，支援使用者 CRUD 和 JWT 認證"

# 4. 互動模式（自動偵測）
/plan
```

`/plan` 會自動：
1. 偵測 Spec 格式（自有格式 / SpecKit / OpenSpec）
2. 讀取 CLAUDE.md 和 package.json 了解專案語境
3. 將 Spec 的 Phase 拆成 Task，推斷依賴關係
4. 根據專案語言推導 verify_command
5. 輸出 `plans/<spec-name>-plan.json`

**Task 切分原則**：
- 單一職責：一個 task 做一件事
- 30 turns 內可完成
- 可獨立驗證（有 verify_command）
- 每個 Phase 完成後系統應可編譯

### `/orchestrate` — 執行 task plan

```bash
/orchestrate plans/SPEC-001-plan.json
```

**注意**：`/orchestrate` 使用 Skill 模式（見[雙重執行架構](#雙重執行架構cli-模式-vs-skill-模式)），直接利用 Claude Code 的 Agent tool 派發子 agent，**不經過 AgentAdapter**。每個 task 作為獨立子 agent 在 worktree 中執行，同層 tasks 自動並行。

執行流程：
1. 使用 plan-resolver 解析計畫，產出 `ResolvedPlan`（含每個 task 的 `generated_prompt`）
2. 檢查安全問題（safety_issues）
3. 逐層執行：同層 tasks 在同一訊息中啟動多個 Agent tool（自動並行），依賴失敗則後續 cascade skip
4. 啟動 Judge 審查（若設定）
5. 產出 execution_report.json + 控制台摘要

加上 `--dry-run` 只解析不執行：

```bash
/orchestrate plans/SPEC-001-plan.json --dry-run
```

### `/dev-workflow-guide` — 開發工作流程指南

八大開發階段與對應指令：

| 階段 | 適用指令 |
|------|---------|
| 需求分析 | `/plan`（需求模式） |
| 規格撰寫 | `/sdd` |
| 計畫生成 | `/plan`（Spec 模式） |
| 實作執行 | `/orchestrate` |
| 品質審查 | 自動（Quality Gate + Judge） |
| 重構 | `/orchestrate`（strict profile） |
| 測試補充 | `/orchestrate`（含 test_levels） |
| 部署 | CI/CD 整合 |

### 端到端 workflow 範例

```bash
# Step 1: 撰寫規格
/sdd user-authentication

# Step 2: 從規格生成計畫
/plan specs/SPEC-001-user-authentication.md

# Step 3: 審閱計畫（人工確認 task 拆分是否合理）
cat plans/SPEC-001-user-authentication-plan.json

# Step 4: 執行計畫
/orchestrate plans/SPEC-001-user-authentication-plan.json

# Step 5: 查看報告
cat execution_report.json
```

---

## 5. CLI 指令參考

### `devap run`

執行 task plan。

```bash
devap run --plan <file> [options]
```

| Flag | 說明 | 預設 |
|------|------|------|
| `--plan <file>` | Task plan JSON 檔案路徑 | **必填** |
| `--agent <type>` | 指定 agent：`claude` / `opencode` / `cli` | plan.agent 或 `claude` |
| `--parallel` | 啟用並行模式（同層 tasks 並行執行） | 序列模式 |
| `--max-parallel <n>` | 最大並行任務數 | 無限制 |
| `--dry-run` | 只驗證 plan + 檢查 adapter 可用性 | — |
| `--accept-terms` | 靜默合規提醒（等同 `DEVAP_ACCEPT_TERMS=1`） | — |

**執行流程**：

```
載入 plan.json → 驗證（JSON Schema + DAG）→ 選擇 adapter → 檢查可用性
  → [dry-run 停止] 或 → 編排執行 → 輸出 execution_report.json
```

**範例**：

```bash
# 驗證 plan
devap run --plan plan.json --dry-run

# 用 CLI adapter 序列執行
devap run --plan plan.json --agent cli

# 並行執行，最多 3 個同時
devap run --plan plan.json --parallel --max-parallel 3

# CI 環境靜默執行
devap run --plan plan.json --accept-terms
```

### `devap init`

安裝 devap 的 Claude Code Skills 到目標專案。

```bash
devap init [options]
```

| Flag | 說明 | 預設 |
|------|------|------|
| `--force` | 強制覆蓋已存在的 skills | — |
| `--target <dir>` | 指定目標專案路徑 | 當前目錄 |

安裝的 Skills：

| Skill | 指令 | 用途 |
|-------|------|------|
| plan | `/plan` | 從 Spec 或文字生成 plan.json |
| orchestrate | `/orchestrate` | 執行 task plan |
| dev-workflow-guide | `/dev-workflow-guide` | 開發工作流程指南 |

### `devap sync-standards`

從 UDS upstream 同步最新標準到 `.standards/` 目錄。

```bash
devap sync-standards [options]
```

| Flag | 說明 | 預設 |
|------|------|------|
| `--check` | 僅檢查版本是否落後（CI 用），落後時 exit 1 | — |
| `--force` | 強制覆蓋本地修改 | — |
| `--target <dir>` | 指定目標專案路徑 | 當前目錄 |

```bash
# 一般同步
devap sync-standards

# CI 中檢查（不同步，只檢查）
devap sync-standards --check

# 強制覆蓋本地修改
devap sync-standards --force
```

### 退出碼

| Exit Code | 意義 |
|-----------|------|
| 0 | 成功（所有 task 通過或 dry-run 完成） |
| 1 | 失敗（plan 驗證失敗、task 執行失敗、adapter 不可用） |

---

## 6. 品質配置

### 四種 Quality Profile

在 plan.json 的 `quality` 欄位指定：

```json
{ "quality": "standard" }
```

| Profile | verify | Judge 策略 | 最大重試 | 重試預算 | 適用場景 |
|---------|:------:|-----------|:--------:|:--------:|---------|
| `strict` | ✅ | always（每個 task 都審查） | 2 | $2.00 | 正式功能開發 |
| `standard` | ✅ | on_change（有改動時審查） | 1 | $1.00 | 日常開發 |
| `minimal` | ✅ | never | 0 | $0.00 | 簡單任務 |
| `none` | ❌ | never | 0 | $0.00 | 快速原型、測試 |

未設定 `quality` 時預設為 `none`（向後相容）。

### 自訂品質配置

除了使用預設 profile，也可以用物件自訂：

```json
{
  "quality": {
    "verify": true,
    "lint_command": "pnpm lint",
    "type_check_command": "pnpm tsc --noEmit",
    "judge_policy": "on_change",
    "max_retries": 2,
    "max_retry_budget_usd": 3.0,
    "static_analysis_command": "pnpm lint",
    "completion_criteria": [
      { "name": "所有測試通過", "command": "pnpm test", "required": true },
      { "name": "覆蓋率 > 80%", "command": "pnpm test:coverage", "required": false }
    ]
  }
}
```

### Quality Gate 執行順序

```
verify_command (或 test_levels: unit → integration → system → e2e)
       │
       ▼
  lint_command（若設定）
       │
       ▼
  type_check_command（若設定）
       │
       ▼
  static_analysis_command（若設定）
       │
       ▼
  completion_criteria（逐項檢查）
```

第一個失敗即停止，進入 Fix Loop。

### Fix Loop 機制

Fix Loop 在驗證失敗或 Judge REJECT 時自動重試：

1. **第 1 次失敗** → Root Cause Investigation（根因調查）
2. **第 2 次失敗** → Pattern Analysis（模式分析）
3. **第 3+ 次失敗** → Architecture Questioning（停止猜測，質疑架構）

**雙重限制**（先觸發的先停）：
- `max_retries`：最大重試次數
- `max_retry_budget_usd`：重試成本上限

### Judge Agent

Judge 是獨立的 AI 審查者，執行雙階段審查：

1. **Spec Compliance**：實作是否符合 task spec 和 acceptance_criteria
2. **Code Quality**：程式碼品質、測試覆蓋、架構一致性

Judge 輸出 `APPROVE` 或 `REJECT`，REJECT 會觸發 Fix Loop。

### Test Policy

```json
{
  "test_policy": {
    "pyramid_ratio": { "unit": 70, "integration": 20, "system": 7, "e2e": 3 },
    "completion_criteria": [
      { "name": "All tests passing", "command": "pnpm test", "required": true }
    ],
    "static_analysis_command": "pnpm lint"
  }
}
```

`pyramid_ratio` 是測試金字塔建議比例（經驗值，非強制）。`completion_criteria` 中有 `command` 的項目會自動驗證，沒有的交由 Judge 審查。

### 選擇建議

| 你的場景 | 建議 profile |
|---------|-------------|
| 快速原型 / PoC | `none` |
| 日常 feature 開發 | `standard` |
| 正式功能 / 重構 | `strict` |
| 簡單修正 / 文件更新 | `minimal` |

---

## 7. 成本管控

### 三層預算機制

```json
{
  "max_total_budget_usd": 10.0,        // Plan 級：整個 plan 最多花 $10
  "quality": {
    "max_retry_budget_usd": 2.0         // Retry 級：每個 task 重試最多花 $2
  },
  "defaults": {
    "max_budget_usd": 3.0               // Task 級：每個 task 最多花 $3
  }
}
```

任一層觸頂即停止：
- **Task 級**觸頂 → 該 task 停止
- **Retry 級**觸頂 → 停止重試，回報最後結果
- **Plan 級**觸頂 → 剩餘 tasks 全部標記為 `skipped`

### max_turns 控制

限制 agent 的對話回合數，間接控制成本：

```json
{
  "defaults": { "max_turns": 30 },
  "tasks": [
    { "id": "T-001", "max_turns": 10, "..." : "..." }
  ]
}
```

### model_tier 分級

建議 agent 使用不同等級的模型：

| 等級 | 適用場景 | 成本 |
|------|---------|------|
| `fast` | 單一檔案、明確 spec 的機械性實作 | 低 |
| `standard` | 多檔案整合、需要判斷力 | 中 |
| `capable` | 架構設計、審查、除錯 | 高 |

```json
{ "id": "T-001", "model_tier": "fast", "spec": "新增一個常數定義檔..." }
```

### 從報告讀取成本

```bash
cat execution_report.json | jq '.summary.total_cost_usd'
cat execution_report.json | jq '.tasks[] | {task_id, cost_usd, retry_cost_usd}'
```

### 成本最佳化技巧

1. **先 `--dry-run`**：確認 plan 正確再執行，避免浪費
2. **spec 越精確，花費越少**：agent 不需要猜測，用更少的 turns 完成
3. **善用 `model_tier`**：機械性任務用 `fast`，省下預算給需要判斷力的 task
4. **針對性 verify_command**：`pnpm test -- --grep auth` 比 `pnpm test` 更快
5. **控制 `max_turns`**：簡單 task 設 10，複雜的再給 30-50

---

## 8. 並行執行與隔離

### DAG 分層並行

啟用 `--parallel` 後，devap 將 DAG 分成多層，同層 tasks 用 `Promise.all()` 並行執行：

```bash
devap run --plan plan.json --parallel --max-parallel 4
```

```
第 1 層：T-001                    （1 個 task）
第 2 層：T-002, T-003, T-004     （3 個 task 同時執行）
第 3 層：T-005                    （等第 2 層全部完成）
```

`max_parallel` 控制同時執行的上限。未設定時無限制（取決於同層 task 數量）。

### 並行 vs. 序列的取捨

| | 並行 | 序列 |
|---|---|---|
| 速度 | 快（同層同時跑） | 慢（逐一執行） |
| 資源 | 較高（多個 agent 同時運行） | 較低 |
| 除錯 | 日誌交錯，較難追蹤 | 線性日誌，容易追蹤 |
| 建議 | 任務間獨立性高、趕時間 | 首次執行、除錯中 |

### Git Worktree 隔離

每個 task 在獨立的 git worktree 中執行，避免檔案衝突：

```
原始目錄
  ├── .git/worktrees/T-001/   ← T-001 的獨立副本
  ├── .git/worktrees/T-002/   ← T-002 的獨立副本
  └── ...
```

生命週期：`create` → `execute` → `merge`（成功時）→ `cleanup`

### fork_session

`fork_session: true`（預設）讓每個 task 在隔離的 agent session 中執行，不共享上下文。設為 `false` 可讓 task 接續前一個 session。

---

## 9. 安全機制

### 危險指令攔截

devap 掃描 task 的 `spec` 和 `verify_command`，攔截以下操作：

| 危險操作 | 說明 |
|---------|------|
| `rm -rf` | 遞迴強制刪除 |
| `drop database` | 刪除資料庫 |
| `git push --force` / `git push -f` | 強制推送 |
| `chmod 777` | 開放所有權限 |
| `mkfs.` | 格式化磁碟 |
| `> /dev/sda` | 覆寫磁碟 |
| `dd if=` | 低階磁碟操作 |
| `curl ... \| sh/bash` | 下載並執行腳本 |
| `wget ... \| sh/bash` | 下載並執行腳本 |

被攔截的 task 會立即標記為 `failed`，錯誤訊息會說明攔截原因。

### 硬編碼祕密掃描

| 掃描項目 | 模式 |
|---------|------|
| AWS Access Key ID | `AKIA` 開頭，20 字元 |
| AWS Secret Access Key | `aws_secret_access_key=...` |
| API Key | `api_key=...`（20+ 字元） |
| 硬編碼密碼 | `password='...'`、`pwd='...'` 等 |
| GitHub Token | `ghp_` 開頭 |
| Slack Token | `xox` 開頭 |
| 私鑰 | `-----BEGIN PRIVATE KEY-----` |

### Anthropic ToS 合規

首次執行 `devap run` 時會顯示合規提醒：
- DevAP 自動化編排屬於 Anthropic Commercial Terms
- 需使用 API key（非 Pro/Max OAuth token）
- 確認後記錄於 `~/.devap/terms-accepted`，後續不再顯示
- 可用 `--accept-terms` 或 `DEVAP_ACCEPT_TERMS=1` 靜默

---

## 10. 常見場景食譜（Cookbook）

### 場景 A：全新專案（從零開始）

從空目錄建立完整的 Express + TypeScript Todo API。

```json
{
  "project": "todo-api",
  "agent": "claude",
  "defaults": {
    "max_turns": 30,
    "max_budget_usd": 2.0,
    "allowed_tools": ["Read", "Write", "Edit", "Bash"]
  },
  "tasks": [
    {
      "id": "T-001",
      "title": "初始化專案骨架",
      "spec": "建立 Node.js + Express + TypeScript 專案：\n1. pnpm init\n2. 安裝 express, typescript, @types/express, tsx, vitest\n3. tsconfig.json (ES2022, NodeNext, strict)\n4. src/index.ts 建立基本 Express server (port 3000)\n5. package.json scripts: build, dev, test",
      "verify_command": "pnpm build",
      "max_turns": 10,
      "max_budget_usd": 0.5
    },
    {
      "id": "T-002",
      "title": "建立資料模型",
      "spec": "使用 Drizzle ORM 建立 todos 表：id (uuid, PK), title (text, not null), completed (boolean, default false), created_at (timestamp, default now)",
      "depends_on": ["T-001"],
      "verify_command": "pnpm build && pnpm test -- --grep schema"
    },
    {
      "id": "T-003",
      "title": "實作 CRUD API",
      "spec": "實作 RESTful API：\n- GET /todos → 列出全部\n- POST /todos → 建立（body: { title }）\n- PATCH /todos/:id → 更新（body: { title?, completed? }）\n- DELETE /todos/:id → 刪除\n每個端點回傳適當的 HTTP status code",
      "depends_on": ["T-002"],
      "verify_command": "pnpm test -- --grep api"
    },
    {
      "id": "T-004",
      "title": "加入輸入驗證",
      "spec": "使用 zod 驗證所有 API 輸入：\n- POST: title 必填、字串、長度 1-200\n- PATCH: 至少一個欄位\n驗證失敗回傳 400 + { error: string, details: ZodError }",
      "depends_on": ["T-003"],
      "verify_command": "pnpm test -- --grep validation"
    },
    {
      "id": "T-005",
      "title": "E2E 測試",
      "spec": "使用 supertest 撰寫完整 CRUD 流程測試：建立 → 列出 → 更新 → 刪除 → 確認刪除",
      "depends_on": ["T-004"],
      "verify_command": "pnpm test"
    }
  ]
}
```

```bash
devap run --plan todo-api-plan.json --agent cli
```

### 場景 B：既有專案新增功能

在已有 codebase 上新增使用者認證模組，使用扇出 + 合流的 DAG：

```json
{
  "project": "my-existing-app",
  "agent": "claude",
  "quality": "standard",
  "defaults": {
    "max_turns": 30,
    "max_budget_usd": 2.0
  },
  "tasks": [
    {
      "id": "T-001",
      "title": "建立 User model",
      "spec": "在 src/models/ 新增 user.ts：id, email (unique), password_hash, name, created_at。使用既有的 Drizzle ORM 設定。",
      "verify_command": "pnpm build"
    },
    {
      "id": "T-002",
      "title": "實作認證 service",
      "spec": "在 src/services/auth.ts 實作：\n- register(email, password, name): 用 bcrypt 雜湊密碼，建立 user\n- login(email, password): 驗證密碼，簽發 JWT (HS256, 15min)\n- verifyToken(token): 解碼驗證",
      "depends_on": ["T-001"],
      "verify_command": "pnpm test -- --grep auth.service"
    },
    {
      "id": "T-003",
      "title": "實作認證 middleware",
      "spec": "在 src/middleware/auth.ts 實作 Express middleware：\n- 從 Authorization: Bearer <token> 取得 token\n- 用 auth service 驗證\n- 成功時設定 req.user\n- 失敗回傳 401",
      "depends_on": ["T-001"],
      "verify_command": "pnpm test -- --grep auth.middleware"
    },
    {
      "id": "T-004",
      "title": "實作認證 API 路由",
      "spec": "在 src/routes/auth.ts：\n- POST /auth/register\n- POST /auth/login\n整合 auth service 和既有的 error handling",
      "depends_on": ["T-002", "T-003"],
      "verify_command": "pnpm test -- --grep auth.routes",
      "judge": true,
      "acceptance_criteria": [
        "註冊後可用同一帳密登入",
        "重複 email 註冊回傳 409",
        "密碼錯誤回傳 401",
        "response 中不包含 password 或 password_hash"
      ]
    }
  ]
}
```

DAG 結構：

```
        T-001
       /     \
    T-002   T-003     ← 同層，可並行
       \     /
        T-004         ← 合流，等兩者完成
```

```bash
devap run --plan auth-plan.json --parallel
```

### 場景 C：重構 / 修 bug

搭配 `strict` profile，先測試後改動：

```json
{
  "project": "my-app-refactor",
  "agent": "claude",
  "quality": "strict",
  "defaults": {
    "max_turns": 30,
    "max_budget_usd": 3.0
  },
  "tasks": [
    {
      "id": "T-001",
      "title": "補充現有測試",
      "spec": "為 src/services/payment.ts 的 processPayment() 補充測試：\n- 正常付款流程\n- 餘額不足\n- 無效卡號\n- 重複交易\n確保重構前測試覆蓋率 > 80%",
      "verify_command": "pnpm test -- --grep payment",
      "acceptance_criteria": [
        "覆蓋所有公開方法",
        "包含邊界條件測試",
        "不依賴外部服務（mock HTTP）"
      ]
    },
    {
      "id": "T-002",
      "title": "重構 payment service",
      "spec": "將 processPayment() 的 300 行拆分為：\n- validatePayment(): 驗證輸入\n- executeCharge(): 呼叫支付閘道\n- recordTransaction(): 寫入交易紀錄\n保持所有既有測試通過",
      "depends_on": ["T-001"],
      "verify_command": "pnpm test",
      "judge": true,
      "acceptance_criteria": [
        "所有既有測試不修改即通過",
        "每個新函式 < 50 行",
        "公開 API 簽名不變"
      ]
    }
  ]
}
```

### 場景 D：CI/CD 整合

GitHub Actions workflow 範例：

```yaml
# .github/workflows/devap.yml
name: DevAP Execution
on:
  workflow_dispatch:
    inputs:
      plan_file:
        description: 'Task plan JSON file path'
        required: true

jobs:
  execute:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install devap
        run: npm install -g dev-autopilot

      - name: Execute plan
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          devap run \
            --plan ${{ inputs.plan_file }} \
            --agent cli \
            --accept-terms \
            --parallel

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: execution-report
          path: execution_report.json
```

重點：
- `--accept-terms`：CI 中必須靜默合規提醒
- `if: always()`：即使 devap 失敗也上傳報告
- `ANTHROPIC_API_KEY` 存在 GitHub Secrets

---

## 11. Adapter 開發指南

### AgentAdapter 介面

所有 adapter 必須實作以下介面：

```typescript
interface AgentAdapter {
  /** agent 類型名稱 */
  readonly name: AgentType;

  /**
   * 執行單一任務
   * @param task - 要執行的任務
   * @param options - 執行選項（cwd, sessionId, forkSession, onProgress, modelTier）
   * @returns 任務執行結果
   */
  executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult>;

  /**
   * 檢查此 agent 是否可用
   * @returns 是否可用
   */
  isAvailable(): Promise<boolean>;

  /**
   * 恢復指定 session（可選）
   * @param sessionId - 要恢復的 session ID
   */
  resumeSession?(sessionId: string): Promise<void>;
}
```

### TaskResult 回傳格式

```typescript
interface TaskResult {
  task_id: string;                        // 必填
  status: TaskStatus;                     // 必填：success | failed | done_with_concerns | needs_context | blocked
  session_id?: string;                    // 建議填：用於 resume
  cost_usd?: number;                      // 建議填：成本追蹤
  duration_ms?: number;                   // 建議填：耗時追蹤
  error?: string;                         // 失敗時的錯誤訊息
  concerns?: string[];                    // done_with_concerns 時的疑慮
  needed_context?: string;                // needs_context 時需要的資訊
  block_reason?: string;                  // blocked 時的原因
  verification_evidence?: VerificationEvidence[];  // 驗證證據
}
```

TaskStatus 含義：

| Status | 意義 | 後續行為 |
|--------|------|---------|
| `success` | 正常完成 | 繼續後續依賴 |
| `done_with_concerns` | 完成但有疑慮 | 繼續後續依賴 + 記錄 concerns |
| `failed` | 執行失敗 | 觸發 Fix Loop |
| `needs_context` | 需要更多上下文 | 觸發 Fix Loop + 注入回饋 |
| `blocked` | 無法完成 | 觸發 Fix Loop，建議升級或拆分 |
| `skipped` | 依賴失敗跳過 | Orchestrator 自動設定 |
| `timeout` | 逾時 | 視為失敗 |

### 現有 adapter 原始碼導覽

| Adapter | 路徑 | 特點 |
|---------|------|------|
| adapter-cli | `packages/adapter-cli/src/cli-adapter.ts` | **推薦參考**。零外部依賴，使用 `claude -p` 子進程，程式碼最簡單 |
| adapter-claude | `packages/adapter-claude/src/claude-adapter.ts` | Claude Agent SDK 整合，支援 streaming |
| adapter-opencode | `packages/adapter-opencode/src/opencode-adapter.ts` | Client/Server 架構，透過 HTTP API |

### 從零實作一個 Adapter

以下是最小可用的 adapter 實作：

```typescript
import type { AgentAdapter, AgentType, ExecuteOptions, Task, TaskResult } from "@devap/core";

export class MyAgentAdapter implements AgentAdapter {
  readonly name: AgentType = "cli"; // 或自訂 "myagent" as AgentType

  async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
    const startTime = Date.now();
    options.onProgress?.(`[${task.id}] 開始執行：${task.title}`);

    try {
      // 你的 agent 執行邏輯
      const result = await this.callMyAgent(task.spec, options.cwd);

      return {
        task_id: task.id,
        status: "success",
        session_id: result.sessionId,
        cost_usd: result.cost,
        duration_ms: Date.now() - startTime,
      };
    } catch (error) {
      return {
        task_id: task.id,
        status: "failed",
        duration_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    // 檢查你的 agent 是否可用
    try {
      // 例如：檢查 CLI 是否安裝、SDK 是否可達
      return true;
    } catch {
      return false;
    }
  }

  private async callMyAgent(spec: string, cwd: string) {
    // 實作你的 agent 呼叫邏輯
    return { sessionId: "session-123", cost: 0.1 };
  }
}
```

### 註冊 Adapter

在 `packages/cli/src/adapter-factory.ts` 中註冊：

```typescript
import { MyAgentAdapter } from "./my-agent-adapter.js";

export function createAdapter(agentType: string): AgentAdapter {
  switch (agentType) {
    case "claude": return new ClaudeAdapter();
    case "cli": return new CliAdapter();
    case "opencode": return new OpenCodeAdapter();
    case "myagent": return new MyAgentAdapter();
    default: throw new Error(`不支援的 agent: ${agentType}`);
  }
}
```

### 測試 Adapter

```typescript
import { describe, it, expect } from "vitest";
import { MyAgentAdapter } from "./my-agent-adapter.js";

describe("MyAgentAdapter", () => {
  const adapter = new MyAgentAdapter();

  it("should report availability", async () => {
    const available = await adapter.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("should execute a task", async () => {
    const result = await adapter.executeTask(
      { id: "T-001", title: "Test", spec: "Do something" },
      { cwd: process.cwd() },
    );
    expect(result.task_id).toBe("T-001");
    expect(["success", "failed"]).toContain(result.status);
  });
});
```

---

## 12. 故障排除

### 安裝問題

**`devap: command not found`**

```bash
# 確認安裝位置
npm list -g dev-autopilot

# 確認 npm global bin 在 PATH 中
npm config get prefix
# 確保 <prefix>/bin 在 $PATH
```

**`devap init` 失敗：找不到 skills 來源**

skills 隨 npm 套件一起安裝。確認 `dev-autopilot` 已正確安裝：

```bash
npm install -g dev-autopilot
```

### Plan 驗證失敗

**「依賴圖存在循環」**

檢查 `depends_on` 是否形成環路：

```json
// 錯誤：T-001 → T-002 → T-001
{ "id": "T-001", "depends_on": ["T-002"] },
{ "id": "T-002", "depends_on": ["T-001"] }
```

**「Task ID 格式不符」**

ID 必須符合 `T-NNN` 格式：`T-001`、`T-002`、...、`T-999`。

**「缺少必填欄位」**

每個 task 必須有 `id`、`title`、`spec`。頂層必須有 `project` 和 `tasks`。

### 執行時錯誤

**「agent 不可用」**

```bash
# 檢查 Claude CLI 是否安裝
claude --version

# 檢查 API key
echo $ANTHROPIC_API_KEY
```

**Task 逾時**

增加 `max_turns` 或 `test_levels[].timeout_ms`：

```json
{ "max_turns": 50 }
{ "test_levels": [{ "name": "integration", "command": "...", "timeout_ms": 300000 }] }
```

**「Plan 總預算上限已達到」**

剩餘 tasks 被標記為 `skipped`。調高 `max_total_budget_usd` 或減少 task 數量。

### 品質門檻問題

**verify_command 在本地通過但 devap 中失敗**

檢查工作目錄（cwd）問題。devap 在專案根目錄執行 verify_command，確保指令不依賴特定子目錄。

**lint 指令找不到**

確保 `lint_command` 中使用的工具已安裝且在 PATH 中：

```json
// 使用 npx 確保能找到
{ "lint_command": "npx eslint src/" }
```

### 並行 / Worktree 問題

**Worktree merge 衝突**

多個 tasks 修改同一檔案時可能衝突。解法：
1. 調整 `depends_on` 讓衝突的 tasks 序列執行
2. 或不使用 worktree 隔離

**Worktree 殘留**

若 devap 異常中斷，可能留下 worktree：

```bash
git worktree list
git worktree prune
```

---

## 13. 最佳實踐

### Plan 設計原則

1. **單一職責**：一個 task 做一件事。「建立 User model + 實作 API + 寫測試」應拆成三個 tasks。
2. **30 turns 可完成**：如果一個 task 太大，agent 會在 max_turns 限制內完不成。拆小一點。
3. **spec 夠詳盡**：agent 拿到 spec 就能直接開始寫 code。包含檔案路徑、函式名稱、資料結構、錯誤處理規則。
4. **每個 Phase 可編譯**：即使只完成前幾個 tasks，專案也應該能 build。

### 品質策略選擇

| 階段 | 建議 |
|------|------|
| 新專案起步 | `standard` — 品質與速度的平衡 |
| 功能穩定後 | `strict` — 確保不退化 |
| 快速原型 | `minimal` 或 `none` — 速度優先 |
| 重構 | `strict` + 先補測試 — 確保行為不變 |

### 成本效率

1. **先 dry-run 再執行** — 避免因 plan 錯誤浪費預算
2. **spec 越精確花費越少** — 減少 agent 的探索和猜測
3. **善用 model_tier** — 機械性任務用 `fast`，把預算留給需要判斷力的 task
4. **控制 max_turns** — 簡單 task 設 10，避免 agent 無意義地消耗回合

### 團隊協作

1. **plan.json 納入版控** — 讓團隊成員能復現相同的執行結果
2. **`devap sync-standards`** — 定期同步，保持團隊標準一致
3. **Execution Report 作為 review 輔助** — 搭配 PR 一起提交，讓 reviewer 了解 AI 做了什麼
4. **共用 defaults** — 在 plan 層級設定團隊共用的 max_turns、allowed_tools，減少重複

---

## 附錄 A：Task Plan Schema 完整參考

完整的 JSON Schema 定義位於 `specs/task-schema.json`。

### AgentType

```
"claude" | "opencode" | "codex" | "cline" | "cursor" | "cli"
```

### TaskStatus

```
"success" | "failed" | "skipped" | "timeout" | "done_with_concerns" | "needs_context" | "blocked"
```

### QualityProfileName

```
"strict" | "standard" | "minimal" | "none"
```

### ModelTier

```
"fast" | "standard" | "capable"
```

### JudgePolicy

```
"always" | "on_change" | "never"
```

### TestLevelName

```
"unit" | "integration" | "system" | "e2e"
```

### CheckpointPolicy

```
"after_each_layer" | "after_critical" | "never"
```

---

## 附錄 B：ExecutionReport 格式參考

```json
{
  "summary": {
    "total_tasks": 5,
    "succeeded": 4,
    "failed": 1,
    "skipped": 0,
    "done_with_concerns": 0,
    "needs_context": 0,
    "blocked": 0,
    "total_cost_usd": 3.45,
    "total_duration_ms": 125000
  },
  "tasks": [
    {
      "task_id": "T-001",
      "status": "success",
      "session_id": "session-abc123",
      "cost_usd": 0.52,
      "duration_ms": 8500,
      "verification_passed": true,
      "retry_count": 0,
      "judge_verdict": "APPROVE"
    },
    {
      "task_id": "T-002",
      "status": "success",
      "cost_usd": 0.93,
      "duration_ms": 15200,
      "verification_passed": true,
      "retry_count": 1,
      "retry_cost_usd": 0.41
    },
    {
      "task_id": "T-003",
      "status": "failed",
      "cost_usd": 2.00,
      "duration_ms": 45000,
      "verification_passed": false,
      "retry_count": 2,
      "retry_cost_usd": 1.50,
      "error": "max_retries: Quality Gate 失敗 — pnpm test exit code 1"
    }
  ],
  "quality_metrics": {
    "verification_pass_rate": 0.80,
    "judge_pass_rate": 0.80,
    "total_retries": 3,
    "total_retry_cost_usd": 1.91,
    "safety_issues_count": 0,
    "first_pass_rate": 0.60
  }
}
```

### 欄位說明

**summary**：

| 欄位 | 說明 |
|------|------|
| `total_tasks` | 總任務數 |
| `succeeded` | 成功數 |
| `failed` | 失敗數（含 timeout） |
| `skipped` | 跳過數（依賴失敗或預算超限） |
| `done_with_concerns` | 完成但有疑慮 |
| `needs_context` | 需要更多上下文 |
| `blocked` | 被阻塞 |
| `total_cost_usd` | 總成本（美元） |
| `total_duration_ms` | 總耗時（毫秒） |

**quality_metrics**（僅品質模式）：

| 欄位 | 說明 |
|------|------|
| `verification_pass_rate` | 驗證通過率（0-1） |
| `judge_pass_rate` | Judge 通過率（0-1） |
| `total_retries` | 總重試次數 |
| `total_retry_cost_usd` | 總重試成本 |
| `safety_issues_count` | 安全問題數 |
| `first_pass_rate` | 首次通過率（無需重試即成功） |

---

## 附錄 C：術語表

| 術語 | 說明 |
|------|------|
| **DAG** | Directed Acyclic Graph（有向無環圖），描述任務間的依賴關係 |
| **Layer** | DAG 拓撲排序後的「層」，同層 tasks 無相互依賴，可並行 |
| **Task** | 單一可執行的開發任務，包含 spec、依賴、驗證指令 |
| **Task Plan** | 完整的任務計畫（plan.json），包含所有 tasks 和設定 |
| **Spec** | 任務規格說明，agent 執行任務的主要輸入 |
| **Agent** | AI coding agent（如 Claude），實際執行開發任務 |
| **Adapter** | AgentAdapter 實作，連接 devap 與特定 agent |
| **Quality Gate** | 品質閘門，執行 verify/lint/type-check 等驗證 |
| **Fix Loop** | 自動修復迴圈，失敗時注入回饋重試 |
| **Judge** | 獨立的 AI 審查者，審查 task 結果是否符合 spec |
| **Safety Hook** | 安全鉤子，攔截危險操作和硬編碼祕密 |
| **Worktree** | Git worktree，為每個 task 提供隔離的工作副本 |
| **Checkpoint** | 層間暫停點，讓使用者決定 continue/abort/retry |
| **UDS** | Universal Dev Standards，語言無關的開發標準 |
| **VibeOps** | 全生命週期開發平台，devap 的上層消費者之一 |
