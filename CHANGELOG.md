# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

[0.1.2]: https://github.com/AsiaOstrich/dev-autopilot/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/AsiaOstrich/dev-autopilot/releases/tag/v0.1.0
