# devap 研究與設計文件

> 研究日期：2026-03-04
> 狀態：Phase 0 — 研究完成，待實作
> 授權：Apache-2.0

---

## 目錄

1. [專案概述](#1-專案概述)
2. [核心可行性驗證](#2-核心可行性驗證)
3. [競品分析](#3-競品分析)
4. [架構決策](#4-架構決策)
5. [Monorepo 結構](#5-monorepo-結構)
6. [核心介面設計](#6-核心介面設計)
7. [Task Plan 格式](#7-task-plan-格式)
8. [編排引擎設計](#8-編排引擎設計)
9. [驗證與安全機制](#9-驗證與安全機制)
10. [成本估算](#10-成本估算)
11. [授權選擇](#11-授權選擇)
12. [實施路線圖](#12-實施路線圖)
13. [風險矩陣](#13-風險矩陣)
14. [附錄：Repo 設定指南](#附錄a-github-repo-設定指南)

---

## 1. 專案概述

### 定位

Agent-agnostic 無人值守開發編排器。

### 三段式架構

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Planning       │     │   Execution      │     │   Reporting     │
│   (Interactive)  │────▶│   (Autonomous)   │────▶│   (Interactive) │
│                  │     │                  │     │                 │
│  Claude Code     │     │  Agent SDK/CLI   │     │  Resume session │
│  OpenCode TUI    │     │  Headless mode   │     │  Review report  │
│  Any agent chat  │     │  Hooks + verify  │     │  Decide next    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**Plan** interactively → **Execute** autonomously → **Review** results.

---

## 2. 核心可行性驗證

### 2.1 Session 跨模式共享

Claude Agent SDK 底層即為 Claude Code CLI 的封裝，兩者共享相同 session 儲存：

- 儲存位置：`~/.claude/projects/<project-hash>/`，格式 `.jsonl`
- 對話模式產生的 `session_id` 可直接被 SDK 的 `resume` 參數使用
- SDK resume 自動載入完整對話歷史與上下文

**驗證路徑**：
```
Claude Code 對話 → 產出 session_id
                        ↓
            SDK query(resume=session_id) → 接續同一上下文
                        ↓
            claude --resume <session_id> → 回到對話模式
```

**結論**：✅ 完全可行，Session 統一，跨模式切換有原生支援。

**來源**：Anthropic 官方文件 platform.claude.com/docs/en/agent-sdk/sessions

### 2.2 各層能力評估

| 層級 | 可行性 | 關鍵能力 |
|------|--------|---------|
| 規劃層（對話模式） | ✅ 天然適合 | Spec 討論、任務拆解、架構決策、驗收條件定義 |
| 執行層（Agent SDK） | ✅ 功能完整 | 自動 agent loop、14+ 工具、context 自動壓縮、subagent、session fork |
| 驗證層（嵌入執行） | ✅ 內建機制 | Hook 攔截 + verify_command + file checkpointing |
| 回報層（對話模式） | ✅ resume 可用 | 結構化報告 + session resume 排查 |

### 2.3 SDK 核心能力清單

| 能力 | 狀態 | 說明 |
|------|------|------|
| 自動 agent loop | ✅ | 無需手寫 stop_reason 判斷 |
| 14+ 內建工具 | ✅ | Read, Write, Edit, Bash, Glob, Grep, WebSearch 等 |
| Context 自動壓縮 | ✅ | 接近上限時自動 compact，並重讀 CLAUDE.md |
| Subagent（子代理） | ✅ | 獨立 context window，可並行（僅一層深度） |
| Session 持久化 | ✅ | 儲存至磁碟，可恢復 |
| Session Fork | ✅ | 從同一起點分支探索不同方案 |
| File Checkpointing | ✅ | 修改前備份，可回滾 |
| MCP Server 整合 | ✅ | 自訂工具透過 allowedTools 接入 |
| Hooks（Python） | ✅ | 權限回呼、工具執行前後攔截 |
| 結構化輸出 | ✅ | output_format 指定 JSON schema |
| 成本控制 | ✅ | max_budget_usd 限制單次執行成本 |
| 回合限制 | ✅ | max_turns 防止無限迴圈 |

---

## 3. 競品分析

### 3.1 競品比較總表

| 工具 | 模型鎖定 | Headless/SDK | Session Resume | Subagent | 適合度 |
|------|---------|-------------|---------------|----------|--------|
| **Claude Agent SDK** | Claude only | ✅ Python/TS SDK | ✅ 原生 | ✅ 原生 | ⭐⭐⭐ 最適合 |
| **OpenCode SDK** | 模型無關 | ✅ HTTP API + CLI | ✅ 原生 | ✅ 可用 | ⭐⭐⭐ 最適合 |
| **OpenAI Codex** | OpenAI only | ✅ MCP server 模式 | ⚠️ threadId | ✅ Agents SDK | ⭐⭐ 適合 |
| **Cursor Background Agents** | 多模型 | ✅ Beta API | ❌ PR-based | ❌ | ⭐ 有限 |
| **Cline** | 多模型 | ⚠️ CLI -y flag | ❌ | ❌ | ⭐ 需自建 |
| **Aider** | 多模型 | ⚠️ 可腳本化 | ❌ | ❌ | ⭐ 單任務 |
| **Windsurf** | 多模型 | ❌ 無 API | ❌ | ❌ | ✗ 不適合 |

### 3.2 Claude Agent SDK

**優勢**：
- Session resume + fork，原生 subagent（獨立 context window）
- Hooks（PreToolCall/PostToolCall）、File checkpointing
- max_budget_usd、max_turns、auto-compact
- Anthropic 官方維護，成熟度最高

**限制**：鎖定 Claude 模型

**來源**：Anthropic 官方文件、PyPI claude-agent-sdk、GitHub anthropics/claude-agent-sdk-python

### 3.3 OpenCode SDK（sst/opencode）

**優勢**：
- **模型無關**（OpenAI/Anthropic/Google/Bedrock/OpenRouter）
- Client/Server 架構，`opencode serve` headless server
- `@opencode-ai/sdk` type-safe client，session resume
- Plugin 系統（hook before/after tool call，自訂 compaction）
- `opencode run` 非互動模式
- GitHub Agent、ACP（Agent Client Protocol）支援
- 100K+ stars，250 萬月活開發者

**限制**：社群驅動，成熟度中等

**注意**：舊版 Go 實作（opencode-ai/opencode）已於 2025/9 歸檔，現為 TypeScript 重寫版本

**來源**：github.com/sst/opencode、opencode.ai/docs

### 3.4 OpenAI Codex + Agents SDK

**優勢**：
- MCP server 模式，可被 Agents SDK 編排
- 25 小時連續運行實測（GPT-5.3-Codex，1300 萬 token，3 萬行程式碼）
- Cloud 環境隔離執行 + 自動測試
- 多 agent 協作（Game Designer → Game Developer 工作流）

**限制**：
- 鎖定 OpenAI 模型
- Session 透過 threadId 管理，需自建跨階段銜接
- Cloud Codex 以 PR 為產出，非 session 接續

**來源**：openai.com/codex、Codex CLI features 官方文件、DevDay 2025 案例

### 3.5 Cursor Background Agents

**優勢**：
- 程式化 API（Beta），最多 256 並行 agent
- Cloud Agent 在隔離 VM 運行，可錄影 demo
- 30% Cursor 內部 PR 由 agent 產出

**限制**：
- PR-based 工作流，非 session 接續模式
- API 仍為 Beta
- 不適合三段式架構

**來源**：Cursor 官方文件 docs.cursor.com、Background Agents API Beta 公告（2026-02-24）

### 3.6 不適合工具

| 工具 | 原因 |
|------|------|
| Cline | 無原生 session resume/subagent，需自建編排層 |
| Aider | 無正式 SDK/session/subagent，僅適合單一 task |
| Windsurf | 無 headless、無 API、無程式化接口 |
| OpenClaw | 通用 AI 助理（WhatsApp/Telegram），非編程專用；CVE-2026-25253（CVSS 8.8）安全問題 |

---

## 4. 架構決策

### 決策記錄

| 決策項 | 選擇 | 理由 |
|--------|------|------|
| 定位 | Agent-agnostic 通用編排器 | 避免鎖定單一 agent，彈性最大 |
| 初期支援 | Claude Agent SDK + OpenCode SDK | 一個最成熟，一個模型無關 |
| Repo 名稱 | `devap` | 不含特定 agent 名稱 |
| 語言 | TypeScript + Python monorepo | 兩大 AI 生態系主要語言 |
| 授權 | Apache-2.0 | 專利保護、修改標示（詳見第 11 節） |
| 套件管理 | pnpm workspace + pyproject.toml | TS 業界標準 + Python 現代標準 |

---

## 5. Monorepo 結構

```
devap/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # Lint + Test (TS & Python)
│   │   └── release.yml               # Semantic release
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── packages/                          # ── TypeScript packages ──
│   ├── core/                          # 核心編排引擎
│   │   ├── src/
│   │   │   ├── orchestrator.ts
│   │   │   ├── task-runner.ts
│   │   │   ├── session-manager.ts
│   │   │   ├── report-generator.ts
│   │   │   └── types.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── adapter-claude/                # Claude Agent SDK adapter
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── claude-adapter.ts
│   │   └── package.json
│   ├── adapter-opencode/              # OpenCode SDK adapter
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── opencode-adapter.ts
│   │   └── package.json
│   └── cli/                           # CLI 入口
│       ├── src/
│       │   └── index.ts
│       └── package.json
├── python/                            # ── Python packages ──
│   ├── devap/
│   │   ├── __init__.py
│   │   ├── orchestrator.py
│   │   ├── adapters/
│   │   │   ├── __init__.py
│   │   │   ├── base.py               # AgentAdapter 抽象基類
│   │   │   ├── claude_adapter.py
│   │   │   └── opencode_adapter.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── task.py
│   │   │   └── report.py
│   │   └── hooks/
│   │       ├── __init__.py
│   │       └── safety_guard.py
│   ├── pyproject.toml
│   └── tests/
│       ├── test_orchestrator.py
│       └── test_adapters.py
├── specs/                             # ── Spec 模板 ──
│   ├── task-schema.json
│   ├── report-schema.json
│   └── examples/
│       ├── new-project-plan.json
│       └── maintenance-plan.json
├── skills/                            # ── Agent Skills/指令 ──
│   ├── CLAUDE.md
│   ├── AGENTS.md
│   └── coding-standards.md
├── docs/
│   ├── architecture.md
│   ├── adapter-guide.md
│   ├── task-format.md
│   └── research/
│       └── this-file.md               # 本文件
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── package.json                       # Monorepo root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── LICENSE                            # Apache-2.0
└── README.md
```

---

## 6. 核心介面設計

### 6.1 TypeScript — AgentAdapter

```typescript
// packages/core/src/types.ts

export type AgentType = "claude" | "opencode" | "codex" | "cline" | "cursor";

export interface AgentAdapter {
  readonly name: AgentType;
  executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult>;
  isAvailable(): Promise<boolean>;
  resumeSession?(sessionId: string): Promise<void>;
}

export interface Task {
  id: string;               // "T-001"
  title: string;
  spec: string;
  depends_on?: string[];
  agent?: AgentType;
  verify_command?: string;
  max_turns?: number;
  max_budget_usd?: number;
  allowed_tools?: string[];
  fork_session?: boolean;
}

export interface TaskResult {
  task_id: string;
  session_id?: string;
  status: "success" | "failed" | "skipped" | "timeout";
  cost_usd?: number;
  duration_ms?: number;
  verification_passed?: boolean;
  error?: string;
}

export interface ExecuteOptions {
  cwd: string;
  sessionId?: string;
  forkSession?: boolean;
  onProgress?: (message: string) => void;
}

export interface ExecutionReport {
  summary: {
    total_tasks: number;
    succeeded: number;
    failed: number;
    skipped: number;
    total_cost_usd: number;
    total_duration_ms: number;
  };
  tasks: TaskResult[];
}
```

### 6.2 Python — AgentAdapter

```python
# python/devap/adapters/base.py

from abc import ABC, abstractmethod
from devap.models.task import Task, TaskResult, ExecuteOptions


class AgentAdapter(ABC):
    """所有 Agent adapter 的抽象基類"""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def execute_task(self, task: Task, options: ExecuteOptions) -> TaskResult: ...

    @abstractmethod
    async def is_available(self) -> bool: ...

    async def resume_session(self, session_id: str) -> None:
        raise NotImplementedError(f"{self.name} does not support session resume")
```

---

## 7. Task Plan 格式

### JSON Schema（簡化）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DevAutopilot Task Plan",
  "type": "object",
  "required": ["project", "tasks"],
  "properties": {
    "project": { "type": "string" },
    "session_id": { "type": "string" },
    "agent": { "enum": ["claude", "opencode", "codex", "cline", "cursor"] },
    "defaults": {
      "type": "object",
      "properties": {
        "max_turns": { "type": "integer", "default": 30 },
        "max_budget_usd": { "type": "number", "default": 2.0 },
        "allowed_tools": { "type": "array", "items": { "type": "string" } }
      }
    },
    "tasks": {
      "type": "array",
      "items": {
        "required": ["id", "title", "spec"],
        "properties": {
          "id": { "type": "string", "pattern": "^T-[0-9]{3}$" },
          "title": { "type": "string" },
          "spec": { "type": "string" },
          "depends_on": { "type": "array", "items": { "type": "string" } },
          "verify_command": { "type": "string" },
          "fork_session": { "type": "boolean", "default": true }
        }
      }
    }
  }
}
```

### 範例

```json
{
  "project": "my-project",
  "session_id": "<planning-session-id>",
  "agent": "claude",
  "defaults": {
    "max_turns": 30,
    "max_budget_usd": 2.0,
    "allowed_tools": ["Read", "Write", "Edit", "Bash"]
  },
  "tasks": [
    {
      "id": "T-001",
      "title": "建立 DB schema",
      "spec": "根據 SPEC.md 第 3 節建立 PostgreSQL schema",
      "depends_on": [],
      "verify_command": "npm run migrate && npm test -- --grep schema",
      "fork_session": true
    },
    {
      "id": "T-002",
      "title": "實作 CRUD API",
      "depends_on": ["T-001"],
      "spec": "根據 SPEC.md 第 4 節實作 REST API",
      "verify_command": "npm test -- --grep api",
      "max_turns": 30,
      "max_budget_usd": 2.0
    }
  ]
}
```

---

## 8. 編排引擎設計

### 核心流程

```
載入 task_plan.json
       ↓
  解析依賴圖（DAG）
       ↓
  ┌─ 取出無依賴或依賴已完成的 task
  │       ↓
  │   選擇 adapter（Claude / OpenCode / ...）
  │       ↓
  │   fork session → 執行 task → 跑 verify_command
  │       ↓
  │   記錄結果（success / failed / skipped）
  │       ↓
  └── 還有 task？→ 回到頂部
       ↓
  產出 execution_report.json
```

### Python 編排器參考實作

```python
import asyncio, json
from claude_agent_sdk import query, ClaudeAgentOptions

async def execute_task(task, project_session_id):
    results = []
    session_id = None

    async for message in query(
        prompt=f"執行任務：{task['spec']}\n驗收條件：{task['verify_command']}",
        options=ClaudeAgentOptions(
            resume=project_session_id,
            fork_session=True,
            allowed_tools=task.get("allowed_tools", ["Read", "Write", "Edit", "Bash"]),
            max_turns=task.get("max_turns", 30),
            max_budget_usd=task.get("max_budget_usd", 2.0),
            permission_mode="acceptEdits",
            setting_sources=["project"],
        )
    ):
        if hasattr(message, 'type'):
            if message.type == "system" and message.subtype == "init":
                session_id = message.session_id
            elif message.type == "result":
                results.append({
                    "task_id": task["id"],
                    "session_id": session_id,
                    "status": message.subtype,
                    "cost_usd": message.total_cost_usd,
                })
    return results

async def run_pipeline(task_file):
    with open(task_file) as f:
        plan = json.load(f)

    completed = {}
    report = []

    for task in plan["tasks"]:
        deps_met = all(
            completed.get(dep, {}).get("status") == "success"
            for dep in task.get("depends_on", [])
        )
        if not deps_met:
            report.append({"task_id": task["id"], "status": "skipped", "reason": "dependency_failed"})
            continue

        result = await execute_task(task, plan["session_id"])
        completed[task["id"]] = result[-1] if result else {"status": "error"}
        report.extend(result)

    with open("execution_report.json", "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    return report
```

### Subagent 並行策略

```python
# 對無依賴關係的 task，可用 subagent 並行
options = ClaudeAgentOptions(
    allowed_tools=["Read", "Write", "Edit", "Bash", "Task"],
    agents={
        "implementer": {
            "description": "實作程式碼的專家",
            "tools": ["Read", "Write", "Edit", "Bash"],
        },
        "tester": {
            "description": "撰寫和執行測試的專家",
            "tools": ["Read", "Write", "Bash", "Grep"],
        },
    }
)
```

**注意**：Subagent 不能再生成 subagent（僅一層深度）。

---

## 9. 驗證與安全機制

### 驗證流程（嵌入執行層）

```
Task 執行 → 程式碼修改 → verify_command（lint + test + build）
                                    ↓ 通過 → 下一個 task
                                    ↓ 失敗 → retry 或暫停
```

### 安全守門 Hook

```python
async def permission_callback(tool_name, input_data, context):
    if tool_name == "Bash":
        cmd = input_data.get("command", "")
        dangerous = ["rm -rf", "DROP DATABASE", "git push --force",
                      "chmod 777", "curl | sh", "wget | bash"]
        if any(d in cmd for d in dangerous):
            return {"type": "deny", "message": f"禁止執行: {cmd}"}
    return {"type": "allow"}
```

### Execution Report 格式

```json
{
  "summary": {
    "total_tasks": 5,
    "succeeded": 4,
    "failed": 1,
    "skipped": 0,
    "total_cost_usd": 6.50,
    "total_duration_seconds": 340
  },
  "tasks": [
    {
      "task_id": "T-001",
      "status": "success",
      "session_id": "abc-123",
      "cost_usd": 1.20,
      "verification_passed": true
    },
    {
      "task_id": "T-002",
      "status": "failed",
      "session_id": "def-456",
      "cost_usd": 2.10,
      "verification_passed": false,
      "error": "Test api.users.create failed: expected 201 got 500"
    }
  ]
}
```

---

## 10. 成本估算

基於 API 定價（Sonnet 4.5 為例）：

| 場景 | 預估 Turns | 預估成本/Task |
|------|-----------|-------------|
| 簡單檔案修改 | 5-10 | $0.10-0.30 |
| 模組實作 | 15-30 | $0.50-2.00 |
| 複雜重構 | 30-50 | $2.00-5.00 |
| 含 Subagent 並行 | 20-40×N | $1.00-5.00×N |

> ⚠️ **不確定標示**：上述為粗估，實際成本取決於 codebase 大小、prompt 複雜度、model 選擇（Opus vs Sonnet）。建議 POC 時用 `max_budget_usd` 收集實際數據。

---

## 11. 授權選擇

### 為何選 Apache-2.0（而非 MIT）

| 面向 | MIT | Apache-2.0 |
|------|-----|-----------|
| 專利授權 | ❌ 未明確 | ✅ 貢獻者自動授予專利許可 |
| 修改標示 | ❌ 無要求 | ✅ 修改須標示（利於除錯） |
| 商標保護 | ❌ 無 | ✅ 防止未授權使用專案名 |
| 業界先例 | 小型專案 | Kubernetes, TensorFlow, OpenTelemetry |

**對 Agent 生態系的意義**：
- 貢獻者不能事後用專利告使用者（專利反擊條款）
- Adapter 貢獻需標示修改，利於品質追蹤
- 防止第三方以 `devap` 名義發布未經授權的分發

### 授權變更可行性（若已有 MIT 版本）

- 唯一貢獻者：✅ 零風險，直接改
- 有外部貢獻者：需每位同意，或透過 CLA 預先授權
- 舊版本授權不變：已發布的 MIT 版本永久有效

**建議**：新 repo 直接用 Apache-2.0，避免日後變更成本。

---

## 12. 實施路線圖

### Milestone 1: Foundation (POC) — 1-2 週

- [ ] 初始化 monorepo（pnpm workspace + pyproject.toml）
- [ ] 定義 AgentAdapter 介面（TS + Python）
- [ ] 實作 Task Plan JSON schema + 驗證
- [ ] 實作 Claude Agent SDK adapter（TS）
- [ ] 實作 OpenCode SDK adapter（TS）
- [ ] 實作核心 Orchestrator（dependency resolution + sequential execution）
- [ ] 實作 Execution Report 產出
- [ ] CLI 入口（`devap run --plan <file>`）
- [ ] 安全守門 Hook（危險操作攔截）
- [ ] 端到端 POC 測試（小型專案）

### Milestone 2: Python Parity — 2-3 週

- [ ] Python Claude + OpenCode adapter
- [ ] Python Orchestrator + CLI

### Milestone 3: Advanced Features — 2-4 週

- [ ] Session bridge（對話 ↔ SDK）
- [ ] Subagent 並行執行
- [ ] Git branch 隔離（每 task 一個 branch）
- [ ] CI/CD 整合（GitHub Actions）
- [ ] 成本追蹤 dashboard

### Milestone 4: 持續優化

- [ ] 根據實際數據調整 max_turns / max_budget_usd
- [ ] 優化 Skill 內容減少幻覺
- [ ] 探索 Subagent 並行策略
- [ ] 評估 1M context beta 效益

---

## 13. 風險矩陣

| 風險 | 嚴重度 | 緩解方案 |
|------|--------|---------|
| Context rot（200K window 有效率約 50-60%） | 高 | fork_session 隔離每個 task；subagent 分散 context |
| Token 消耗快（並行 subagent 加倍消耗） | 高 | max_budget_usd 設上限；監控 total_cost_usd |
| 幻覺/偏離 spec | 高 | 每 task 結束跑 verify_command；Hooks 攔截危險操作 |
| Session 歷史不可程式化讀取 | 中 | 目前需手動解析 .jsonl（GitHub Issue #109 已提需求） |
| SDK 仍在快速演進（0.1.x → 0.2.x） | 中 | 鎖定版本；關注 breaking changes |
| 1M context beta 尚未 GA | 低 | 先用 200K，靠 compact + fork 管理 |

### 總結評估

| 評估項目 | 可行性 | 風險 |
|---------|--------|------|
| Session 跨模式共享 | ✅ 已確認 | 低 |
| 規劃層（對話） | ✅ 天然適合 | 低 |
| 執行層（SDK） | ✅ 功能完整 | 中 |
| 驗證層（嵌入執行） | ✅ Hook + verify | 中 |
| 回報層（對話） | ✅ resume 可用 | 低 |
| 新專案適用性 | ✅ 適合 | 中 |
| 維護專案適用性 | ✅ 適合 | 中高 |
| SDK 穩定度 | ⚠️ Alpha/Beta | 中 |
| 成本可控性 | ✅ 有內建機制 | 中 |

**最終結論**：架構技術上完全可行，Anthropic 工具鏈已提供所需原語。主要風險在「做得多好」——取決於 spec 品質、測試覆蓋率、及 Skill/CLAUDE.md 規範設計。

---

## 附錄A: GitHub Repo 設定指南

### Repo 基本設定

| 欄位 | 值 |
|------|---|
| Repository name | `devap` |
| Description | Agent-agnostic unattended development orchestrator |
| Visibility | Private |
| License | Apache-2.0 |
| Default branch | `main` |

### Topics

```
ai-agent, development-automation, orchestrator, claude-code, opencode,
unattended-development, spec-driven, monorepo, typescript, python
```

### Branch Protection & Settings

| 設定項 | 建議值 |
|--------|--------|
| Branch protection | Require PR + 1 approval for `main` |
| Merge strategy | Squash merge |
| Auto-delete head branches | ✅ |
| Wiki | ❌（用 docs/ 目錄） |
| Projects | ✅（追蹤 Milestone 1-4） |
| Secrets | `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY` |

### 核心設定檔

**pnpm-workspace.yaml**
```yaml
packages:
  - "packages/*"
```

**tsconfig.base.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**python/pyproject.toml**
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "devap"
version = "0.1.0"
description = "Agent-agnostic unattended development orchestrator"
requires-python = ">=3.11"
license = "Apache-2.0"
dependencies = [
    "claude-agent-sdk>=0.1.0",
    "pydantic>=2.0",
    "rich>=13.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.24", "ruff>=0.8", "mypy>=1.13"]

[project.scripts]
devap = "devap.__main__:main"

[tool.ruff]
target-version = "py311"
line-length = 100
```

---

*資訊來源：Anthropic 官方文件（platform.claude.com, docs.claude.com, code.claude.com）、PyPI claude-agent-sdk、GitHub anthropics/claude-agent-sdk-python、opencode.ai/docs、github.com/sst/opencode、OpenAI Codex 文件、Cursor Background Agents API 文件*

*SDK 版本參考：claude-agent-sdk 0.1.44（Python）、@anthropic-ai/claude-agent-sdk 0.2.x（TypeScript）*
