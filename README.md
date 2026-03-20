# devap

[繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

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

### Option 1: npm Install (Recommended)

```bash
npm install -g dev-autopilot

# Install devap skills to your project
cd my-project
devap init              # Install 3 skills to ./.claude/skills/
devap init --force      # Overwrite existing skills
devap init --target /path/to/project  # Specify target path
```

Then use the skills in Claude Code:
```
/sdd <feature-name>        # Create a spec document
/plan specs/SPEC-001.md    # Generate plan.json from spec
/orchestrate plan.json     # Execute the plan
```

### Option 2: CLI Mode

```bash
npm install -g dev-autopilot

# Run a task plan
devap run --plan ./specs/examples/new-project-plan.json

# With options
devap run --plan plan.json --agent cli --parallel --dry-run
```

## Usage

### Skills Workflow (`/sdd` → `/plan` → `/orchestrate`)

This is the primary way to use devap within Claude Code:

1. **`/sdd <feature>`** — Write a specification document with requirements, acceptance criteria, and test plan
2. **`/plan <spec.md>`** — Convert the spec into an executable `plan.json` with tasks, dependencies, and verification commands
3. **`/orchestrate <plan.json>`** — Execute the plan: resolve the DAG, run tasks layer by layer, apply quality gates

### CLI

```bash
devap run --plan <file> [options]
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
| Claude Code (CLI) | `@devap/adapter-claude` | ✅ Implemented |
| OpenCode SDK | `@devap/adapter-opencode` | ✅ Implemented |
| CLI (shell commands) | `@devap/adapter-cli` | ✅ Implemented |
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
  cli/             → CLI entry point (devap run)
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

### Method 1: npm Install (Recommended)

```bash
npm install -g dev-autopilot

# Install skills to target project
cd /path/to/target
devap init
```

### Method 2: CLI with Global Install (from source)

```bash
# Build and link globally
cd /path/to/devap
pnpm install && pnpm build
pnpm -F @devap/cli link --global

# Use from any project
cd /path/to/target
devap init
devap run --plan plan.json --agent cli
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

## Ecosystem

DevAP is the **orchestration execution layer** in the AsiaOstrich three-layer product architecture:

```
UDS (What to do) → DevAP (How agents do it) → VibeOps (Full lifecycle)
```

| Layer | Product | Role | License |
|-------|---------|------|---------|
| Standards | [UDS](https://github.com/AsiaOstrich/universal-dev-standards) | Development methodology framework | MIT + CC BY 4.0 |
| Orchestration | **DevAP** | Agent-agnostic orchestration engine | Apache-2.0 |
| Lifecycle | [VibeOps](https://github.com/AsiaOstrich/vibeops360) | AI-driven software factory | AGPL-3.0-only |

- **UDS** defines *what* standards to follow → DevAP consumes UDS standards for quality gates
- **DevAP** defines *how* agents execute → VibeOps implements the `AgentAdapter` interface
- **VibeOps** provides the *runtime* → DevAP can orchestrate VibeOps as a "super agent"

The `AgentAdapter` interface is the primary integration point. VibeOps implements this interface to allow DevAP to orchestrate its 7+1 agents.

## License

[Apache-2.0](LICENSE)
