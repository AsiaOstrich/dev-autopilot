# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-03-21

### Added

#### Python 測試補齊（Phase 1）
- `test_quality_gate.py` — 多層級測試、verify 模式、lint/type_check/static_analysis、completion_criteria（required/optional）、evidence 收集、executor 例外處理
- `test_judge.py` — should_run_judge 6 種策略組合、build_judge_prompt（criteria/intent/review_stage）、parse_judge_output、_try_parse_judge_json 邊界案例
- `test_cli_adapter.py` — parse_cli_output、resolve_status、CliAdapter（is_available、execute_task、_build_prompt）
- `test_worktree_manager.py` — create、merge（--no-ff）、cleanup（含失敗處理）、cleanup_all、get_worktree
- `test_claudemd_generator.py` — acceptance_criteria/user_intent 注入、verify_command、extra_constraints、existing_claudemd 附加
- `test_plan_resolver.py` — 正常解析、驗證失敗、安全掃描、品質警告、parallel/sequential 模式判定
- `test_quality_profile.py` — profile 解析、test_policy 合併邏輯（static_analysis_command、completion_criteria）
- Python 測試案例從 48 增至 161（+113 個）

#### SPEC-004 VibeOps Adapter 實作（Phase 4）
- 新增 `@devap/adapter-vibeops` package（MIT 授權，零 AGPL 依賴）
- `VibeOpsAdapter` — 透過 HTTP REST API 整合 VibeOps 7+1 agents
  - `isAvailable()` — GET /api/health 健康檢查
  - `executeTask()` — 根據 spec 關鍵字自動路由到對應 VibeOps agent
  - `resumeSession()` — POST /api/pipeline/resume 恢復暫停的 pipeline
- `agent-mapper.ts` — spec 中英文關鍵字 → VibeOps agent 映射（planner/architect/designer/uiux/builder/reviewer/operator/evaluator）
- `types.ts` — VibeOpsAdapterConfig、VibeOpsAgentName、API 請求/回應型別
- 32 個測試案例覆蓋 adapter 與映射器

#### Python CLI 命令補齊
- `devap init` 命令 — 安裝 devap Skills 到目標專案的 .claude/skills/（支援 --force、--target）
- `devap sync-standards` 命令 — 從 UDS upstream 同步最新標準（支援 --check、--force、--target）
  - `read_manifest()` — 讀取 .standards/manifest.json
  - `fetch_latest_version()` — GitHub API releases/tags 查詢
  - `compare_semver()` — semver 版本比較
  - `execute_uds_sync()` — 透過 npx uds init 執行同步

#### Python E2E 測試
- `test_e2e.py` — 載入 specs/examples/new-project-plan.json 跑完整編排流程
  - 全部成功、部分失敗跳過依賴、safety hook 攔截、defaults 套用、並行模式、checkpoint abort、done_with_concerns 繼續、test_policy 向後相容

#### Python Adapters 補齊
- `claude_adapter.py` — 透過 claude-agent-sdk 呼叫 Claude Code，支援 session resume/fork、max_turns、max_budget_usd
- `opencode_adapter.py` — 透過 OpenCode CLI 子進程執行任務，解析 JSON 輸出
- `vibeops_adapter.py` — 透過 HTTP REST API 整合 VibeOps 7+1 agents（MIT 授權隔離）
- `test_claude_adapter.py` — is_available、build_prompt、build_options、build_result、execute_task
- `test_opencode_adapter.py` — is_available、build_prompt、build_args、execute_task（success/failure/timeout/invalid JSON）
- `test_vibeops_adapter.py` — map_spec_to_agent 映射、is_available、execute_task、resume_session、API token
- Python `__main__.py` adapter factory 擴充支援 claude、opencode（原僅支援 cli）
- Python 測試案例從 161 增至 210（+49 個）

#### 其他
- `devap sync-standards` CLI 指令 — 自動從 UDS upstream 同步最新標準（SPEC-005）
  - `--check` 模式：僅檢查版本是否落後（適合 CI，落後時 exit 1）
  - `--force` 模式：強制覆蓋本地修改
  - GitHub API 版本查詢（releases → tags fallback）
  - Skills 版本對齊檢查
- GitHub Actions `check-standards.yml` — 每週排程 + manifest 變更時自動檢查 UDS 版本
- SPEC-005: UDS 同步機制 — 記錄短期 copy-once 改善與中期 npm 包化規劃
- SPEC-004: VibeOps Adapter 整合規格
- 跨產品整合策略文件：README.md 生態定位、CLAUDE.md 整合指引
- SPEC-003 新增 Part D: VibeOps 消費者視角
- Multi-level test support (`test_levels`) — 依序執行多層級測試，任一失敗即中斷
- Claude Adapter unit tests (10 test cases)
- OpenCode Adapter unit tests (9 test cases)
- CLI adapter factory tests and plan validation tests (8 test cases)
- E2E tests for quality mode, parallel mode, checkpoint, and multi-level test scenarios
- GitHub Actions CI workflow with lint + Node 20/22 test matrix + Python 3.11/3.12/3.13 matrix
- ESLint v9 flat config (`eslint.config.mjs`)
- Python 版全部核心模組實作完成（types、orchestrator、quality-gate、judge、fix-loop、safety-hook、plan-validator、plan-resolver、quality-profile、worktree-manager、claudemd-generator）
- Python CI job（ruff + mypy strict + pytest）

### Changed
- SPEC-002 狀態從 Approved 更新為 Implemented（Phase 2 驗收完成）
- SPEC-003 Part B（devap 端）標記為 Implemented
- Python `resolve_quality_profile()` 新增 `test_policy` 參數，合併 `static_analysis_command` + `completion_criteria` 到 QualityConfig（對齊 TS 端）
- Python `resolve_plan()` 傳入 `plan.test_policy` 給 quality profile 解析
- Quality Gate 支援 `test_levels` 欄位（優先於 `verify_command`）
- 抽取 `createAdapter()` 為獨立 `adapter-factory.ts`

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

[Unreleased]: https://github.com/AsiaOstrich/dev-autopilot/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/AsiaOstrich/dev-autopilot/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/AsiaOstrich/dev-autopilot/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/AsiaOstrich/dev-autopilot/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/AsiaOstrich/dev-autopilot/releases/tag/v0.1.0
