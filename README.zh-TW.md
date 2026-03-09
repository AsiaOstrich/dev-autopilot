# dev-autopilot

[English](README.md)

Agent 無關的無人值守開發編排器。

**規劃**（互動）→ **執行**（自動）→ **審查**（互動）

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   規劃階段       │     │   執行階段        │     │   報告階段       │
│   （互動式）     │────▶│   （自動化）      │────▶│   （互動式）     │
│                  │     │                  │     │                 │
│  /sdd → /plan    │     │  DAG 編排引擎    │     │  審查報告       │
│  Spec → plan.json│     │  並行任務執行    │     │  品質指標       │
│                  │     │  安全攔截        │     │  決定下一步     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## 功能特色

- **DAG 編排** — 拓撲排序，支援並行/序列執行
- **多 Agent 支援** — 可插拔的 adapter 架構，支援 Claude、OpenCode、CLI
- **品質設定檔** — 四種內建 profile：`strict`、`standard`、`minimal`、`none`
- **Fix Loop** — 驗證失敗時自動重試，支援預算控制
- **Judge Agent** — 可選的 AI 審查機制（核准/拒絕）
- **安全攔截** — 攔截危險指令（`rm -rf`、`DROP DATABASE`、`git push --force`）
- **Claude Code Skills** — 整合 `/sdd` → `/plan` → `/orchestrate` 工作流程

## 快速開始

### 方式一：Claude Code Skill 模式（推薦）

將 dev-autopilot 的 Skills 部署到目標專案：

1. 複製 Skills 到你的專案：
   ```bash
   cp -r .claude/skills/spec-driven-dev /path/to/your-project/.claude/skills/
   cp -r .claude/skills/plan /path/to/your-project/.claude/skills/
   cp -r .claude/skills/orchestrate /path/to/your-project/.claude/skills/
   ```

2. 在 Claude Code 中執行工作流程：
   ```
   /sdd <功能名稱>              # 建立規格文件
   /plan specs/SPEC-001.md     # 從規格生成 plan.json
   /orchestrate plan.json      # 執行計畫
   ```

### 方式二：CLI 模式

```bash
# 安裝依賴
pnpm install
pnpm build

# 執行任務計畫
dev-autopilot run --plan ./specs/examples/new-project-plan.json

# 搭配選項
dev-autopilot run --plan plan.json --agent cli --parallel --dry-run
```

## 使用方式

### Skills 工作流程（`/sdd` → `/plan` → `/orchestrate`）

這是在 Claude Code 中使用 dev-autopilot 的主要方式：

1. **`/sdd <功能>`** — 撰寫規格文件，包含需求、驗收條件與測試計畫
2. **`/plan <spec.md>`** — 將規格轉換為可執行的 `plan.json`，包含任務、依賴與驗證指令
3. **`/orchestrate <plan.json>`** — 執行計畫：解析 DAG、逐層執行任務、套用品質關卡

### CLI

```bash
dev-autopilot run --plan <file> [options]
```

| 選項 | 說明 |
|------|------|
| `--plan <file>` | 任務計畫 JSON 檔案路徑（必要） |
| `--agent <type>` | 指定 agent：`claude`、`opencode` 或 `cli` |
| `--parallel` | 啟用並行執行（獨立任務同時執行） |
| `--max-parallel <n>` | 最大並行任務數 |
| `--dry-run` | 僅驗證計畫並檢查 adapter 可用性 |

### 任務計畫格式

任務計畫是定義任務及其依賴關係的 JSON 檔案：

```json
{
  "project": "my-project",
  "agent": "cli",
  "quality": "standard",
  "tasks": [
    {
      "id": "T-001",
      "title": "建立資料模型",
      "spec": "實作 User 模型，包含欄位：id、name、email",
      "verify_command": "pnpm test",
      "judge": true
    },
    {
      "id": "T-002",
      "title": "新增 API 端點",
      "spec": "建立 User CRUD 的 REST 端點",
      "depends_on": ["T-001"],
      "verify_command": "pnpm test"
    }
  ]
}
```

完整 schema 請參閱 [specs/task-schema.json](specs/task-schema.json)。

## 支援的 Agent

| Agent | Adapter 套件 | 狀態 |
|-------|-------------|------|
| Claude Code (CLI) | `@dev-autopilot/adapter-claude` | ✅ 已實作 |
| OpenCode SDK | `@dev-autopilot/adapter-opencode` | ✅ 已實作 |
| CLI（shell 指令） | `@dev-autopilot/adapter-cli` | ✅ 已實作 |
| OpenAI Codex | — | 🔵 未來 |
| Cline CLI | — | 🔵 未來 |
| Cursor API | — | 🔵 未來 |

## 架構

### 核心元件

- **Orchestrator** — 讀取任務計畫，解析 DAG 依賴，依序或並行派發任務
- **Plan Resolver** — 拓撲排序、分層群組、為子 agent 產生 CLAUDE.md
- **Quality Gate** — 依品質設定檔執行 `verify_command`、lint、型別檢查
- **Fix Loop** — 以錯誤回饋重試失敗任務，遵守預算上限
- **Judge** — AI 驅動的任務結果審查（核准/拒絕並給予回饋）
- **Safety Hook** — 掃描任務規格中的危險指令與機密資訊
- **CLAUDE.md Generator** — 為子 agent 產生含任務上下文的指令檔

### AgentAdapter 介面

```typescript
interface AgentAdapter {
  readonly name: AgentType;
  executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult>;
  isAvailable(): Promise<boolean>;
  resumeSession?(sessionId: string): Promise<void>;
}
```

## 專案結構

```
packages/
  core/            → 編排器、計畫解析器、品質關卡、Fix Loop、Judge、型別
  cli/             → CLI 入口（dev-autopilot run）
  adapter-claude/  → Claude Code CLI adapter
  adapter-opencode/→ OpenCode SDK adapter
  adapter-cli/     → Shell 指令 adapter
specs/
  task-schema.json → 任務計畫 JSON schema
  examples/        → 範例任務計畫
  SPEC-*.md        → 功能規格文件
plans/             → 產生的 plan.json 檔案
docs/research/     → 設計文件
.claude/skills/
  spec-driven-dev/ → /sdd skill
  plan/            → /plan skill
  orchestrate/     → /orchestrate skill
```

## 部署到目標專案

### 方式一：複製 Skills（推薦）

將三個 Skills 目錄複製到目標專案：

```bash
# 從 dev-autopilot repo
cp -r .claude/skills/spec-driven-dev /path/to/target/.claude/skills/
cp -r .claude/skills/plan /path/to/target/.claude/skills/
cp -r .claude/skills/orchestrate /path/to/target/.claude/skills/
```

然後在目標專案中使用 Claude Code 的 `/sdd`、`/plan`、`/orchestrate` 指令。

### 方式二：CLI 全域安裝

```bash
# 建置並全域連結
cd /path/to/dev-autopilot
pnpm install && pnpm build
pnpm -F @dev-autopilot/cli link --global

# 在任何專案中使用
cd /path/to/target
dev-autopilot run --plan plan.json --agent cli
```

## 開發

```bash
# 安裝依賴
pnpm install

# 建置所有套件
pnpm build

# 執行測試
pnpm test

# Lint 檢查
pnpm lint
```

### Python（計畫中）

Python 支援排定在未來的 milestone。詳情請參閱 [CLAUDE.md](CLAUDE.md)。

## 文件

- [可行性研究與設計](docs/research/feasibility-and-design.md)
- [任務計畫 Schema](specs/task-schema.json)
- [範例計畫](specs/examples/new-project-plan.json)

## 授權

[Apache-2.0](LICENSE)
