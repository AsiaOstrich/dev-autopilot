# dev-autopilot

Agent-agnostic unattended development orchestrator. Plan → Execute → Review.

**CLI command: `devap`**

## Install

```bash
npm i -g dev-autopilot
# or
npm i -g devap
```

## Usage

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

## Example

```bash
devap run --plan plan.json --agent cli --parallel --dry-run
```

## Documentation

- [GitHub](https://github.com/AsiaOstrich/dev-autopilot)
- [Full README](https://github.com/AsiaOstrich/dev-autopilot#readme)

## License

[Apache-2.0](https://github.com/AsiaOstrich/dev-autopilot/blob/main/LICENSE)
