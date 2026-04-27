# DevAP Standards

Flow orchestration definitions migrated from UDS per DEC-049 (UDS/DevAP responsibility split).

## Directory Structure

```
standards/
├── flow/          ← Pure flow enforcement standards (workflow gates, phase sequencing)
└── orchestration/ ← Agent dispatch, communication protocol, execution coordination
```

## Purpose

Per [DEC-049](https://github.com/AsiaOstrich/dev-platform/blob/main/cross-project/decisions/DEC-049-uds-devap-responsibility-split.md):

| Layer | Responsibility |
|-------|---------------|
| **UDS** | Activity definition — what the activity is, quality standards |
| **DevAP** | Flow orchestration — how steps connect, how gates are enforced |

Standards in this directory are the **executable** flow definitions. The corresponding conceptual standards remain in UDS `core/` as human-readable references.

## Migration Status (XSPEC-086 Phase 2)

| Standard | Status | UDS Stub |
|----------|--------|----------|
| `flow/workflow-enforcement.ai.yaml` | ✅ Migrated (2026-04-27) | Deprecated stub in UDS 5.4.0 |
