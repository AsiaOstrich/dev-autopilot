# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `devap sync-standards` CLI 指令 — 自動從 UDS upstream 同步最新標準（SPEC-005）
  - `--check` 模式：僅檢查版本是否落後（適合 CI，落後時 exit 1）
  - `--force` 模式：強制覆蓋本地修改
  - GitHub API 版本查詢（releases → tags fallback）
  - Skills 版本對齊檢查
- GitHub Actions `check-standards.yml` — 每週排程 + manifest 變更時自動檢查 UDS 版本
- SPEC-005: UDS 同步機制 — 記錄短期 copy-once 改善與中期 npm 包化規劃
- Unit tests for sync-standards command (16 test cases)
- SPEC-004: VibeOps Adapter — 定義 VibeOps 7+1 agents 如何透過 AgentAdapter 被 DevAP 編排
- 跨產品整合策略文件：README.md 生態定位、CLAUDE.md 整合指引
- SPEC-003 新增 Part D: VibeOps 消費者視角（UDS → DevAP → VibeOps 測試品質流）
- AgentAdapter JSDoc 補充 VibeOps 實作指引
- Multi-level test support (`test_levels`) — run unit/integration/e2e tests in sequence with short-circuit on failure
- Claude Adapter unit tests (10 test cases)
- OpenCode Adapter unit tests (9 test cases)
- CLI adapter factory tests and plan validation tests (8 test cases)
- E2E tests for quality mode, parallel mode, checkpoint, and multi-level test scenarios
- GitHub Actions CI workflow with lint + Node 20/22 test matrix
- ESLint v9 flat config (`eslint.config.mjs`)

### Changed
- Quality Gate now supports `test_levels` field (takes precedence over `verify_command`)
- Extract `createAdapter()` from CLI into standalone `adapter-factory.ts` for testability

## [0.1.3] - 2026-03-11

### Added
- `devap init` CLI command — one-command installation of devap skills to target project
  - Installs 3 skills: `plan`, `orchestrate`, `dev-workflow-guide`
  - `--force` flag to overwrite existing skills
  - `--target <dir>` to specify target project path
- `prepublishOnly` script to bundle skills into npm package
- Unit tests for init command (4 test cases)

## [0.1.2] - 2026-03-11

### Added
- UDS (Universal Dev Standards) integration with 25 standard definitions
- Skills: audit-assistant, dev-workflow-guide
- Traditional Chinese translations for all skills
- npm publish configuration and tsup build setup
- zh-CN README

### Changed
- Rename CLI from dev-autopilot to devap
- Rewrite README with zh-TW translation
- Update CLAUDE.md with UDS standards compliance instructions

## [0.1.0] - 2026-03-10

### Added
- Milestone 1 Foundation POC: Orchestrator, TaskRunner, PlanValidator
- Quality enforcement system: QualityGate, Judge, FixLoop, SafetyHook
- Agent adapters: Claude Agent SDK, OpenCode SDK, CLI adapter
- WorktreeManager for isolated task execution
- CLAUDE.md generator for agent context
- DAG-based task dependency resolution
- 150 unit tests across core and adapter packages
- CLI entry point (`devap run --plan <file>`)
- Research documentation and feasibility design

[Unreleased]: https://github.com/AsiaOstrich/dev-autopilot/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/AsiaOstrich/dev-autopilot/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/AsiaOstrich/dev-autopilot/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/AsiaOstrich/dev-autopilot/releases/tag/v0.1.0
