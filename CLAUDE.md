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
- 授權：Apache-2.0

## 架構

```
Planning（互動）→ Execution（自動）→ Reporting（互動）
```

核心元件：
- **Orchestrator**：讀取 task plan，解析 DAG 依賴，依序/並行派發 task
- **AgentAdapter**：可插拔介面，每個 agent 一個 adapter
- **TaskRunner**：呼叫 adapter.executeTask()，跑 verify_command
- **ReportGenerator**：產出 execution_report.json

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
packages/core/src/         → orchestrator, task-runner, session-manager, types
packages/adapter-claude/   → Claude Agent SDK adapter
packages/adapter-opencode/ → OpenCode SDK adapter
packages/cli/              → CLI 入口 (devap run --plan <file>)
python/devap/      → Python 版（Milestone 2）
specs/                     → task-schema.json, report-schema.json, examples/
skills/                    → CLAUDE.md, AGENTS.md
docs/research/             → 完整研究文件（本檔案的詳細版）
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
- Adapter 開發指南：docs/adapter-guide.md（待建立）

## 跨產品整合策略

DevAP 在 AsiaOstrich 三層產品架構中定位為**編排執行層**：

```
UDS (標準定義) ──→ DevAP (編排執行) ──→ VibeOps (全生命週期)
  MIT + CC BY 4.0     Apache-2.0          AGPL-3.0-only
```

### 整合原則

1. **授權隔離**：DevAP 維持 Apache-2.0，不引入 AGPL 依賴
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
## Commit Message Language
Write commit messages in **bilingual** format (English + 繁體中文).
Format: `<type>(<scope>): <English>. <中文>.`

## Standards Compliance Instructions

**MUST follow** (每次都要遵守):
| Task | Standard | When |
|------|----------|------|
| Project context | [project-context-memory.ai.yaml](.standards/project-context-memory.ai.yaml) | Planning & Coding |
| Writing commits | [commit-message.ai.yaml](.standards/commit-message.ai.yaml) | Every commit |

**SHOULD follow** (相關任務時參考):
| Task | Standard | When |
|------|----------|------|
| Developer memory | [developer-memory.ai.yaml](.standards/developer-memory.ai.yaml) | Always (protocol) |
| Git workflow | [git-workflow.ai.yaml](.standards/git-workflow.ai.yaml) | Branch/merge decisions |
| Writing tests | [testing.ai.yaml](.standards/testing.ai.yaml) | When creating tests |


## Installed Standards Index

本專案採用 UDS 標準。所有規範位於 `.standards/`：

### Core (35 standards)
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
<!-- UDS:STANDARDS:END -->

---
