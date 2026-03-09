# dev-autopilot

[繁體中文](README.zh-TW.md)

Agent-agnostic unattended development orchestrator.

**Plan** interactively → **Execute** autonomously → **Review** results.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Planning       │     │   Execution      │     │   Reporting     │
│   (Interactive)  │────▶│   (Autonomous)   │────▶│   (Interactive) │
│                  │     │                  │     │                 │
│  /sdd → /plan    │     │  DAG orchestrator│     │  Review report  │
│  Spec → plan.json│     │  Parallel tasks  │     │  Quality metrics│
│                  │     │  Safety hooks    │     │  Decide next    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Features

- **DAG Orchestration** — Topological sort with parallel/sequential execution
- **Multi-Agent Support** — Pluggable adapters for Claude, OpenCode, and CLI agents
- **Quality Profiles** — Four built-in profiles: `strict`, `standard`, `minimal`, `none`
- **Fix Loop** — Automatic retry on verification failure with budget control
- **Judge Agent** — Optional AI review of task outputs (approve/reject)
- **Safety Hooks** — Intercept dangerous commands (`rm -rf`, `DROP DATABASE`, `git push --force`)
- **Claude Code Skills** — Integrated `/sdd` → `/plan` → `/orchestrate` workflow

## Quick Start

### Option 1: Claude Code Skills (Recommended)

Use dev-autopilot as Claude Code skills in your target project:

1. Copy the skills to your project:
   ```bash
   cp -r .claude/skills/spec-driven-dev /path/to/your-project/.claude/skills/
   cp -r .claude/skills/plan /path/to/your-project/.claude/skills/
   cp -r .claude/skills/orchestrate /path/to/your-project/.claude/skills/
   ```

2. In Claude Code, run the workflow:
   ```
   /sdd <feature-name>        # Create a spec document
   /plan specs/SPEC-001.md    # Generate plan.json from spec
   /orchestrate plan.json     # Execute the plan
   ```

### Option 2: CLI Mode

```bash
# Install dependencies
pnpm install
pnpm build

# Run a task plan
dev-autopilot run --plan ./specs/examples/new-project-plan.json

# With options
dev-autopilot run --plan plan.json --agent cli --parallel --dry-run
```

## Usage

### Skills Workflow (`/sdd` → `/plan` → `/orchestrate`)

This is the primary way to use dev-autopilot within Claude Code:

1. **`/sdd <feature>`** — Write a specification document with requirements, acceptance criteria, and test plan
2. **`/plan <spec.md>`** — Convert the spec into an executable `plan.json` with tasks, dependencies, and verification commands
3. **`/orchestrate <plan.json>`** — Execute the plan: resolve the DAG, run tasks layer by layer, apply quality gates

### CLI

```bash
dev-autopilot run --plan <file> [options]
```

| Option | Description |
|--------|-------------|
| `--plan <file>` | Task plan JSON file path (required) |
| `--agent <type>` | Agent to use: `claude`, `opencode`, or `cli` |
| `--parallel` | Enable parallel execution for independent tasks |
| `--max-parallel <n>` | Max concurrent tasks |
| `--dry-run` | Validate plan and check adapter availability only |

### Task Plan Format

Task plans are JSON files defining tasks with dependencies:

```json
{
  "project": "my-project",
  "agent": "cli",
  "quality": "standard",
  "tasks": [
    {
      "id": "T-001",
      "title": "Create data model",
      "spec": "Implement the User model with fields: id, name, email",
      "verify_command": "pnpm test",
      "judge": true
    },
    {
      "id": "T-002",
      "title": "Add API endpoints",
      "spec": "Create REST endpoints for User CRUD operations",
      "depends_on": ["T-001"],
      "verify_command": "pnpm test"
    }
  ]
}
```

See [specs/task-schema.json](specs/task-schema.json) for the full schema.

## Supported Agents

| Agent | Adapter Package | Status |
|-------|----------------|--------|
| Claude Code (CLI) | `@dev-autopilot/adapter-claude` | ✅ Implemented |
| OpenCode SDK | `@dev-autopilot/adapter-opencode` | ✅ Implemented |
| CLI (shell commands) | `@dev-autopilot/adapter-cli` | ✅ Implemented |
| OpenAI Codex | — | 🔵 Future |
| Cline CLI | — | 🔵 Future |
| Cursor API | — | 🔵 Future |

## Architecture

### Core Components

- **Orchestrator** — Reads task plan, resolves DAG dependencies, dispatches tasks sequentially or in parallel
- **Plan Resolver** — Topological sort, layer grouping, CLAUDE.md generation for sub-agents
- **Quality Gate** — Runs `verify_command`, lint, and type-check per quality profile
- **Fix Loop** — Retries failed tasks with error feedback, respects budget limits
- **Judge** — AI-powered review of task outputs (approve/reject with feedback)
- **Safety Hook** — Scans task specs for dangerous commands and secrets
- **CLAUDE.md Generator** — Generates sub-agent instruction files with task context

### AgentAdapter Interface

```typescript
interface AgentAdapter {
  readonly name: AgentType;
  executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult>;
  isAvailable(): Promise<boolean>;
  resumeSession?(sessionId: string): Promise<void>;
}
```

## Project Structure

```
packages/
  core/            → Orchestrator, plan resolver, quality gate, fix loop, judge, types
  cli/             → CLI entry point (dev-autopilot run)
  adapter-claude/  → Claude Code CLI adapter
  adapter-opencode/→ OpenCode SDK adapter
  adapter-cli/     → Shell command adapter
specs/
  task-schema.json → Task plan JSON schema
  examples/        → Example task plans
  SPEC-*.md        → Feature specifications
plans/             → Generated plan.json files
docs/research/     → Design documents
.claude/skills/
  spec-driven-dev/ → /sdd skill
  plan/            → /plan skill
  orchestrate/     → /orchestrate skill
```

## Deploy to Target Project

### Method 1: Copy Skills (Recommended)

Copy the three skills directories to your target project:

```bash
# From the dev-autopilot repo
cp -r .claude/skills/spec-driven-dev /path/to/target/.claude/skills/
cp -r .claude/skills/plan /path/to/target/.claude/skills/
cp -r .claude/skills/orchestrate /path/to/target/.claude/skills/
```

Then use `/sdd`, `/plan`, and `/orchestrate` in Claude Code within the target project.

### Method 2: CLI with Global Install

```bash
# Build and link globally
cd /path/to/dev-autopilot
pnpm install && pnpm build
pnpm -F @dev-autopilot/cli link --global

# Use from any project
cd /path/to/target
dev-autopilot run --plan plan.json --agent cli
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

### Python (Planned)

Python support is planned for a future milestone. See [CLAUDE.md](CLAUDE.md) for details.

## Documentation

- [Feasibility Study & Design](docs/research/feasibility-and-design.md)
- [Task Plan Schema](specs/task-schema.json)
- [Example Plan](specs/examples/new-project-plan.json)

## License

[Apache-2.0](LICENSE)
