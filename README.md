# dev-autopilot

Agent-agnostic unattended development orchestrator.

**Plan** interactively → **Execute** autonomously → **Review** results.

## Architecture

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

## Supported Agents

| Agent | SDK | Status |
|-------|-----|--------|
| Claude Agent SDK | `claude-agent-sdk` | 🟢 Planned |
| OpenCode SDK | `@opencode-ai/sdk` | 🟢 Planned |
| OpenAI Codex | `@openai/codex` | 🔵 Future |
| Cline CLI | `cline` | 🔵 Future |
| Cursor API | Background Agents API | 🔵 Future |

## Quick Start

### TypeScript
```bash
pnpm install
pnpm -F @dev-autopilot/cli start --plan ./specs/examples/new-project-plan.json
```

### Python
```bash
cd python
pip install -e ".[dev]"
python -m dev_autopilot --plan ./specs/examples/new-project-plan.json
```

## Core Concepts

- **Task Plan**: JSON file defining tasks, dependencies, and verification commands
- **Adapter**: Pluggable interface to any AI coding agent
- **Session Bridge**: Share sessions between interactive planning and autonomous execution
- **Safety Guard**: Hooks to intercept dangerous operations

## Documentation

- [Feasibility Study & Design](docs/research/feasibility-and-design.md)
- [Task Plan Format](specs/task-schema.json)

## License

Apache-2.0
