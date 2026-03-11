# Test Plan Template

> Inspired by ISO/IEC/IEEE 29119-3. Fields map to devap TaskPlan.

## 1. Test Plan Identifier

- **Plan ID**: TP-{project}-{version}
- **Project**: {project name} → `TaskPlan.project`
- **Version**: {version}
- **Date**: {date}

## 2. Test Scope

### In Scope
- {Feature/component to test}

### Out of Scope
- {Explicitly excluded items}

## 3. Test Levels

> Maps to `TaskPlan.defaults.test_levels`

| Level | Command | Timeout | Scope |
|-------|---------|---------|-------|
| Unit (UT) | `pnpm test:unit` | 120000ms | Single function/method |
| Integration (IT) | `pnpm test:integration` | 120000ms | Multiple components |
| System (ST) | `pnpm test:system` | 300000ms | Complete subsystem |
| E2E | `pnpm test:e2e` | 600000ms | Full user flows |

## 4. Static Analysis

> Maps to `TestPolicy.static_analysis_command`

- **Command**: `{lint/type-check/analysis command}`
- **Tools**: {ESLint, ruff, mypy, etc.}

## 5. Quality Thresholds

> Maps to `TaskPlan.quality` (QualityConfig)

| Setting | Value |
|---------|-------|
| Profile | strict / standard / minimal / none |
| Verify | true/false |
| Judge Policy | always / on_change / never |
| Max Retries | {number} |
| Max Retry Budget | ${amount} |

## 6. Test Completion Criteria

> Maps to `TestPolicy.completion_criteria`
> ISO 29119: Test Completion Criteria / Test Exit Criteria
> Agile/Scrum: Definition of Done (DoD)

| Check | Command | Required |
|-------|---------|----------|
| All tests pass | `pnpm test` | Yes |
| No lint errors | `pnpm lint` | Yes |
| Type check clean | `pnpm typecheck` | Yes |
| Static analysis clean | `{command}` | Yes |
| Documentation updated | _(Judge review)_ | No |

## 7. Test Environment

| Environment | Purpose | Mock Strategy |
|-------------|---------|---------------|
| local | UT, fast IT | In-memory mocks |
| ci | Full suite | Containerized deps |
| sit | ST | Stubbed external APIs |
| staging | E2E | No mocks |

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| {risk} | {impact} | {mitigation} |

## 9. Approval

- **Author**: {name}
- **Reviewer**: {name}
- **Approved**: {date}
