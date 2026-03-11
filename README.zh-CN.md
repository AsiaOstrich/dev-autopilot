# devap

[English](README.md) | [繁體中文](README.zh-TW.md)

Agent 无关的无人值守开发编排器。

**规划**（交互）→ **执行**（自动）→ **审查**（交互）

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   规划阶段       │     │   执行阶段        │     │   报告阶段       │
│   （交互式）     │────▶│   （自动化）      │────▶│   （交互式）     │
│                  │     │                  │     │                 │
│  /sdd → /plan    │     │  DAG 编排引擎    │     │  审查报告       │
│  Spec → plan.json│     │  并行任务执行    │     │  质量指标       │
│                  │     │  安全拦截        │     │  决定下一步     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## 功能特色

- **DAG 编排** — 拓扑排序，支持并行/串行执行
- **多 Agent 支持** — 可插拔的 adapter 架构，支持 Claude、OpenCode、CLI
- **质量配置** — 四种内置 profile：`strict`、`standard`、`minimal`、`none`
- **Fix Loop** — 验证失败时自动重试，支持预算控制
- **Judge Agent** — 可选的 AI 审查机制（批准/拒绝）
- **安全拦截** — 拦截危险指令（`rm -rf`、`DROP DATABASE`、`git push --force`）
- **Claude Code Skills** — 集成 `/sdd` → `/plan` → `/orchestrate` 工作流

## 快速开始

### 方式一：npm 安装（推荐）

```bash
npm install -g dev-autopilot

# 将 devap skills 安装到你的项目
cd my-project
devap init              # 安装 3 个 skills 到 ./.claude/skills/
devap init --force      # 强制覆盖已存在的 skills
devap init --target /path/to/project  # 指定目标路径
```

然后在 Claude Code 中使用：
```
/sdd <功能名称>              # 创建规格文档
/plan specs/SPEC-001.md     # 从规格生成 plan.json
/orchestrate plan.json      # 执行计划
```

### 方式二：CLI 模式

```bash
npm install -g dev-autopilot

# 执行任务计划
devap run --plan ./specs/examples/new-project-plan.json

# 搭配选项
devap run --plan plan.json --agent cli --parallel --dry-run
```

## 使用方式

### Skills 工作流（`/sdd` → `/plan` → `/orchestrate`）

这是在 Claude Code 中使用 devap 的主要方式：

1. **`/sdd <功能>`** — 撰写规格文档，包含需求、验收条件与测试计划
2. **`/plan <spec.md>`** — 将规格转换为可执行的 `plan.json`，包含任务、依赖与验证指令
3. **`/orchestrate <plan.json>`** — 执行计划：解析 DAG、逐层执行任务、应用质量关卡

### CLI

```bash
devap run --plan <file> [options]
```

| 选项 | 说明 |
|------|------|
| `--plan <file>` | 任务计划 JSON 文件路径（必填） |
| `--agent <type>` | 指定 agent：`claude`、`opencode` 或 `cli` |
| `--parallel` | 启用并行执行（独立任务同时执行） |
| `--max-parallel <n>` | 最大并行任务数 |
| `--dry-run` | 仅验证计划并检查 adapter 可用性 |

### 任务计划格式

任务计划是定义任务及其依赖关系的 JSON 文件：

```json
{
  "project": "my-project",
  "agent": "cli",
  "quality": "standard",
  "tasks": [
    {
      "id": "T-001",
      "title": "创建数据模型",
      "spec": "实现 User 模型，包含字段：id、name、email",
      "verify_command": "pnpm test",
      "judge": true
    },
    {
      "id": "T-002",
      "title": "添加 API 端点",
      "spec": "创建 User CRUD 的 REST 端点",
      "depends_on": ["T-001"],
      "verify_command": "pnpm test"
    }
  ]
}
```

完整 schema 请参阅 [specs/task-schema.json](specs/task-schema.json)。

## 支持的 Agent

| Agent | Adapter 包 | 状态 |
|-------|-----------|------|
| Claude Code (CLI) | `@devap/adapter-claude` | ✅ 已实现 |
| OpenCode SDK | `@devap/adapter-opencode` | ✅ 已实现 |
| CLI（shell 指令） | `@devap/adapter-cli` | ✅ 已实现 |
| OpenAI Codex | — | 🔵 未来 |
| Cline CLI | — | 🔵 未来 |
| Cursor API | — | 🔵 未来 |

## 架构

### 核心组件

- **Orchestrator** — 读取任务计划，解析 DAG 依赖，按序或并行派发任务
- **Plan Resolver** — 拓扑排序、分层分组、为子 agent 生成 CLAUDE.md
- **Quality Gate** — 按质量配置执行 `verify_command`、lint、类型检查
- **Fix Loop** — 以错误反馈重试失败任务，遵守预算上限
- **Judge** — AI 驱动的任务结果审查（批准/拒绝并给出反馈）
- **Safety Hook** — 扫描任务规格中的危险指令与机密信息
- **CLAUDE.md Generator** — 为子 agent 生成含任务上下文的指令文件

### AgentAdapter 接口

```typescript
interface AgentAdapter {
  readonly name: AgentType;
  executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult>;
  isAvailable(): Promise<boolean>;
  resumeSession?(sessionId: string): Promise<void>;
}
```

## 项目结构

```
packages/
  core/            → 编排器、计划解析器、质量关卡、Fix Loop、Judge、类型
  cli/             → CLI 入口（devap run）
  adapter-claude/  → Claude Code CLI adapter
  adapter-opencode/→ OpenCode SDK adapter
  adapter-cli/     → Shell 指令 adapter
specs/
  task-schema.json → 任务计划 JSON schema
  examples/        → 示例任务计划
  SPEC-*.md        → 功能规格文档
plans/             → 生成的 plan.json 文件
docs/research/     → 设计文档
.claude/skills/
  spec-driven-dev/ → /sdd skill
  plan/            → /plan skill
  orchestrate/     → /orchestrate skill
```

## 部署到目标项目

### 方式一：npm 安装（推荐）

```bash
npm install -g dev-autopilot

# 将 skills 安装到目标项目
cd /path/to/target
devap init
```

### 方式二：CLI 全局安装（从源码）

```bash
# 构建并全局链接
cd /path/to/devap
pnpm install && pnpm build
pnpm -F @devap/cli link --global

# 在任何项目中使用
cd /path/to/target
devap init
devap run --plan plan.json --agent cli
```

## 开发

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行测试
pnpm test

# Lint 检查
pnpm lint
```

### Python（计划中）

Python 支持安排在未来的 milestone。详情请参阅 [CLAUDE.md](CLAUDE.md)。

## 文档

- [可行性研究与设计](docs/research/feasibility-and-design.md)
- [任务计划 Schema](specs/task-schema.json)
- [示例计划](specs/examples/new-project-plan.json)

## 许可证

[Apache-2.0](LICENSE)
