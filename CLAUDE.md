# devap

Agent-agnostic 無人值守開發編排器。Plan → Execute → Review。

## 專案定位

TypeScript + Python monorepo，編排任意 AI coding agent 執行結構化任務。
初期支援：Claude Agent SDK、OpenCode SDK。

## 技術規格

- 語言：TypeScript (packages/)、Python (python/)
- 套件管理：pnpm workspace + pyproject.toml (hatchling)
- TS 目標：ES2022, NodeNext, strict
- Python 目標：3.11+, ruff, mypy strict
- 測試：vitest (TS), pytest + pytest-asyncio (Python)
- 授權：MIT

## 架構

```
Planning（互動）→ Execution（自動）→ Reporting（互動）
```

核心元件：
- **Orchestrator**：讀取 task plan，解析 DAG 依賴，依序/並行派發 task，產出 ExecutionReport
- **AgentAdapter**：可插拔介面，每個 agent 一個 adapter（claude / opencode / cli）
- **Quality Gate**：品質閘門（verify → lint → type-check → 多層級測試）
- **Fix Loop**：驗證失敗時自動注入錯誤回饋重試，含 cost circuit breaker
- **Judge**：獨立 Agent 審查 task 結果，APPROVE/REJECT 判定
- **Safety Hook**：危險指令偵測 + 硬編碼祕密掃描
- **Plan Validator**：JSON Schema 驗證 + DAG 合法性檢查
- **Plan Resolver**：純函式橋接層，整合驗證、分層、安全檢查

## 核心介面

### AgentAdapter (TS)
```typescript
interface AgentAdapter {
  readonly name: AgentType;
  executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult>;
  isAvailable(): Promise<boolean>;
  resumeSession?(sessionId: string): Promise<void>;
}
```

### AgentAdapter (Python)
```python
class AgentAdapter(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...
    @abstractmethod
    async def execute_task(self, task, options) -> TaskResult: ...
    @abstractmethod
    async def is_available(self) -> bool: ...
```

## 目錄結構

```
packages/core/src/         → orchestrator, quality-gate, fix-loop, judge, safety-hook, plan-validator, plan-resolver, types
packages/adapter-claude/   → Claude Agent SDK adapter
packages/adapter-cli/      → Claude CLI 子進程 adapter（零依賴）
packages/adapter-opencode/ → OpenCode SDK adapter
packages/cli/              → CLI 入口 (devap run / init / sync-standards)
python/devap/              → Python 版（Milestone 2，目前為骨架）
specs/                     → task-schema.json, test-policy-schema.json, SPEC-001~005, examples/
docs/research/             → 完整研究文件
.standards/                → UDS 標準（45 個）
.claude/skills/            → Claude Code 技能與工作流程
```

## 開發指令

```bash
# TS
pnpm install
pnpm build
pnpm test
pnpm lint

# UDS 標準同步
devap sync-standards           # 從 upstream 拉最新版
devap sync-standards --check   # 僅檢查版本（CI 用）
devap sync-standards --force   # 強制覆蓋本地修改

# Python
cd python && pip install -e ".[dev]"
pytest
ruff check .
mypy .
```

## 開發規範

- 每個 public function 必須有 JSDoc/docstring
- 所有 adapter 必須實作 AgentAdapter 介面
- Task ID 格式：T-NNN（如 T-001）
- verify_command 失敗視為 task failed
- 危險操作（rm -rf, DROP DATABASE, git push --force）必須被 Hook 攔截
- commit message 遵循 Conventional Commits

## 參考文件

- 完整研究：docs/research/feasibility-and-design.md
- Task Plan Schema：specs/task-schema.json
- Adapter 開發指南：[docs/adapter-guide.md](docs/adapter-guide.md)

## 三層產品架構

AsiaOstrich 產品線以三層架構劃分職責：

| | UDS | DevAP | VibeOps |
|---|---|---|---|
| **定位** | 標準定義層 | 編排執行層 | 全生命週期平台 |
| **回答什麼** | 「怎樣算做好」 | 「怎樣自動做」 | 「整套怎麼跑」 |
| **授權** | MIT + CC BY 4.0 | MIT | AGPL-3.0-only |
| **整合模式** | 被讀取 / 被安裝 | 被呼叫 / 被嵌入 | 呼叫下游 / 編排全流程 |

- **UDS** — 定規矩：提供語言無關的開發標準（`.ai.yaml`），任何專案皆可安裝使用
- **DevAP** — 定協定：將標準轉化為可執行的 DAG 任務編排，搭配品質閘門與自動修復
- **VibeOps** — 跑起來：串接 7+1 agents 完成從需求到部署的完整軟體開發生命週期

## 跨產品整合策略

DevAP 在三層架構中定位為**編排執行層**：

```
UDS (標準定義) ──→ DevAP (編排執行) ──→ VibeOps (全生命週期)
  MIT + CC BY 4.0     MIT          AGPL-3.0-only
```

### 整合原則

1. **授權隔離**：DevAP 維持 MIT，不引入 AGPL 依賴
2. **Agent-agnostic**：VibeOps 是 DevAP 的消費者之一，不是唯一消費者
3. **介面驅動**：`AgentAdapter` interface 是整合點，VibeOps 實作此介面

### DevAP 在 VibeOps Pipeline 中的角色

VibeOps 可透過 Service Connector 呼叫 DevAP 的以下能力：

| 能力 | 操作 | 說明 |
|------|------|------|
| `devap.orchestrate` | run, validate, resolve | DAG 任務編排 |
| `devap.quality-gate` | check, profile | 品質閘門檢查 |
| `devap.fix-loop` | run, status | 自動修復迴圈 |

### VibeOps Adapter Pattern

VibeOps 7+1 agents 透過 `AgentAdapter` 映射為 DevAP tasks：

| VibeOps Agent | DevAP Task 映射 |
|---------------|----------------|
| Planner | T-001: 需求分析 |
| Architect | T-002: 架構決策（depends_on: T-001） |
| Designer | T-003: 規格設計（depends_on: T-002） |
| Builder | T-005: 實作（depends_on: T-003） |
| Reviewer | T-006: 品質審查（depends_on: T-005） |
| Operator | T-007: 部署（depends_on: T-006） |
| Evaluator | T-008: 評估（depends_on: T-007） |
| Guardian | 跨切面 hook |

---

# Added by Universal Dev Standards

# Claude Code 專案指南
# 由 Universal Dev Standards CLI 生成
# https://github.com/AsiaOstrich/universal-dev-standards

## 對話語言 / Conversation Language
所有回覆必須使用**繁體中文 (Traditional Chinese)**。
AI 助手應以繁體中文回覆使用者的問題與請求。

## 核心標準使用規則 / Core Standards Usage Rule
> 當驗證標準、檢查程式碼或執行任務時，**優先**讀取 `core/` 中的精簡規則（例如 `core/testing-standards.md`）。
> 只有在被明確要求提供教育內容、詳細解釋或教學時，才讀取 `core/guides/` 或 `methodologies/guides/`。
> 這確保了 Token 效率和上下文聚焦。

---

<!-- UDS:STANDARDS:START -->
<!-- WARNING: This block is managed by UDS (universal-dev-standards). DO NOT manually edit. Use 'npx uds install' or 'npx uds update' to modify. -->
<!-- WARNING: This block is managed by UDS (universal-dev-standards). DO NOT manually edit. Use 'npx uds install' or 'npx uds update' to modify. -->
## Commit Message Language
Write commit messages in **bilingual** format (English + 繁體中文).
Format: `<type>(<scope>): <English>. <中文>.`
Body MUST be bilingual: English first → blank line → Chinese second. NEVER mix languages in one paragraph.

## Standards Compliance Instructions

**MUST follow** (每次都要遵守):
| Task | Standard | When |
|------|----------|------|
| Project context | [project-context-memory.ai.yaml](.standards/project-context-memory.ai.yaml) | Planning & Coding |
| Writing commits | [commit-message.ai.yaml](.standards/commit-message.ai.yaml) | Every commit |
| Workflow gates | [workflow-enforcement.ai.yaml](.standards/workflow-enforcement.ai.yaml) | Before any workflow phase |

**SHOULD follow** (相關任務時參考):
| Task | Standard | When |
|------|----------|------|
| Developer memory | [developer-memory.ai.yaml](.standards/developer-memory.ai.yaml) | Always (protocol) |
| Git workflow | [git-workflow.ai.yaml](.standards/git-workflow.ai.yaml) | Branch/merge decisions |
| Writing tests | [testing.ai.yaml](.standards/testing.ai.yaml) | When creating tests |


## Installed Standards Index

本專案採用 UDS 標準。所有規範位於 `.standards/`：

### Core (56 standards)
- `deployment-standards.ai.yaml` - deployment-standards.ai.yaml
- `documentation-writing-standards.ai.yaml` - documentation-writing-standards.ai.yaml
- `ai-agreement-standards.ai.yaml` - ai-agreement-standards.ai.yaml
- `virtual-organization-standards.ai.yaml` - virtual-organization-standards.ai.yaml
- `security-standards.ai.yaml` - security-standards.ai.yaml
- `performance-standards.ai.yaml` - performance-standards.ai.yaml
- `accessibility-standards.ai.yaml` - accessibility-standards.ai.yaml
- `developer-memory.ai.yaml` - 開發者持久記憶
- `project-context-memory.ai.yaml` - 專案情境記憶
- `anti-hallucination.ai.yaml` - anti-hallucination.ai.yaml
- `ai-friendly-architecture.ai.yaml` - ai-friendly-architecture.ai.yaml
- `commit-message.ai.yaml` - 提交訊息格式
- `checkin-standards.ai.yaml` - checkin-standards.ai.yaml
- `spec-driven-development.ai.yaml` - spec-driven-development.ai.yaml
- `code-review.ai.yaml` - code-review.ai.yaml
- `git-workflow.ai.yaml` - Git 工作流程
- `versioning.ai.yaml` - versioning.ai.yaml
- `changelog.ai.yaml` - changelog.ai.yaml
- `testing.ai.yaml` - 測試標準
- `documentation-structure.ai.yaml` - documentation-structure.ai.yaml
- `ai-instruction-standards.ai.yaml` - ai-instruction-standards.ai.yaml
- `project-structure.ai.yaml` - project-structure.ai.yaml
- `error-codes.ai.yaml` - error-codes.ai.yaml
- `logging.ai.yaml` - logging.ai.yaml
- `test-completeness-dimensions.ai.yaml` - test-completeness-dimensions.ai.yaml
- `test-driven-development.ai.yaml` - test-driven-development.ai.yaml
- `behavior-driven-development.ai.yaml` - behavior-driven-development.ai.yaml
- `acceptance-test-driven-development.ai.yaml` - acceptance-test-driven-development.ai.yaml
- `reverse-engineering-standards.ai.yaml` - reverse-engineering-standards.ai.yaml
- `forward-derivation-standards.ai.yaml` - forward-derivation-standards.ai.yaml
- `refactoring-standards.ai.yaml` - refactoring-standards.ai.yaml
- `requirement-engineering.ai.yaml` - requirement-engineering.ai.yaml
- `requirement-checklist.md` - requirement-checklist.md
- `requirement-template.md` - requirement-template.md
- `requirement-document-template.md` - requirement-document-template.md
- `api-design-standards.ai.yaml` - api-design-standards.ai.yaml
- `database-standards.ai.yaml` - database-standards.ai.yaml
- `test-governance.ai.yaml` - test-governance.ai.yaml
- `structured-task-definition.ai.yaml` - structured-task-definition.ai.yaml
- `workflow-state-protocol.ai.yaml` - workflow-state-protocol.ai.yaml
- `workflow-enforcement.ai.yaml` - 工作流程強制執行
- `context-aware-loading.ai.yaml` - context-aware-loading.ai.yaml
- `pipeline-integration-standards.ai.yaml` - pipeline-integration-standards.ai.yaml
- `acceptance-criteria-traceability.ai.yaml` - acceptance-criteria-traceability.ai.yaml
- `change-batching-standards.ai.yaml` - change-batching-standards.ai.yaml
- `systematic-debugging.ai.yaml` - systematic-debugging.ai.yaml
- `agent-dispatch.ai.yaml` - agent-dispatch.ai.yaml
- `model-selection.ai.yaml` - model-selection.ai.yaml
- `git-worktree.ai.yaml` - git-worktree.ai.yaml
- `branch-completion.ai.yaml` - branch-completion.ai.yaml
- `verification-evidence.ai.yaml` - verification-evidence.ai.yaml
- `documentation-lifecycle.ai.yaml` - documentation-lifecycle.ai.yaml
- `ai-command-behavior.ai.yaml` - ai-command-behavior.ai.yaml
- `ai-response-navigation.ai.yaml` - ai-response-navigation.ai.yaml
- `adr-standards.ai.yaml` - adr-standards.ai.yaml
- `retrospective-standards.ai.yaml` - retrospective-standards.ai.yaml
<!-- UDS:STANDARDS:END -->

---
