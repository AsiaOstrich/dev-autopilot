# dev-autopilot

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
packages/cli/              → CLI 入口 (dev-autopilot run --plan <file>)
python/dev_autopilot/      → Python 版（Milestone 2）
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
