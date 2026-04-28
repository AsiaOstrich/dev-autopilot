# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-04-28

> **Minor Release**: XSPEC-086 Phase 3/4/5a + XSPEC-090~094 — 12 個新 CLI 命令、XSPEC-090~094 全部實作完成、tests 892→1176。

### Added

#### XSPEC-086 Phase 3 — Hybrid Standards 流程拆分
- `standards/flow/git-workflow-decisions.ai.yaml` — Git 工作流程決策矩陣（branch/merge/conflict）
- `standards/flow/push-gate-sequence.ai.yaml` — push gate 執行順序定義
- `standards/flow/checkin-gate-sequence.ai.yaml` — checkin 品質閘門序列
- `standards/flow/pipeline-security-gate-sequence.ai.yaml` — 安全掃描閘門順序
- `standards/flow/verification-evidence-collection.ai.yaml` — 驗證證據收集流程
- `standards/flow/dual-phase-processing.ai.yaml` — 雙階段處理協定（Thinking + Output）

#### XSPEC-086 Phase 4 — Skills 流程 CLI 命令（10 個）
- `devap push` — push gate 序列強制執行（分支保護 + force push 偵測）
- `devap tdd` — RED→GREEN→REFACTOR 循環引導（`--test-cmd` 可設定測試命令）
- `devap checkin` — pre-commit 品質關卡（build/tests/lint 硬閘門；docs/workflow 軟閘門）
- `devap sdd` — 7-phase SDD 狀態機（DISCUSS→CREATE→REVIEW→APPROVE→IMPLEMENT→VERIFY→ARCHIVE；`--phase` 跳入任意階段）
- `devap bdd` — BDD 4-phase 循環（DISCOVERY→FORMULATION→AUTOMATION→LIVING DOCS；整合 `npx cucumber-js`）
- `devap review` — 8-category 程式碼審查（BLOCKING/IMPORTANT/SUGGESTION/QUESTION/NOTE 前綴；自動判斷 APPROVE/REQUEST_CHANGES）
- `devap atdd` — ATDD 5-phase 生命週期（WORKSHOP→DISTILLATION→DEVELOPMENT→DEMO→DONE；INVEST 驗證 + AC→Gherkin）
- `devap pr` — PR 5-step 生命週期（CREATE→REVIEW→APPROVE→MERGE→CLEANUP；diff size >400 行封鎖；整合 `gh` CLI）
- 對應 flow YAML：`.devap/flows/{tdd,checkin,sdd,bdd,review,atdd,pr}.flow.yaml`

#### XSPEC-086 Phase 5a — UDS CLI 編排移植（2 個）
- `devap hitl` — HITL CLI 閘門（`--op` 必填；`--always-require` 白名單；exit 0/1 供腳本使用）
- `devap run-intent` — intent 解析器（test/lint/build/security/format/typecheck；搜尋順序：`.devap/project.yaml` → `package.json` → `Makefile`；`--dry-run` + `--list`）

#### XSPEC-090 — Spec 合規閘門
- `devap start <type> "<intent>"` — 啟動前強制 XSPEC 存在性驗證（Genesis/Renovate/Medic/Exodus/Guardian 任務類型）

#### XSPEC-091 — HITL Gate 正式化
- `packages/core/src/hitl-gate.ts` — `runHITLGate()` + `shouldRequireHITL()`（AC-1~6 全部實作）
- 逾時（300s 預設）→ 自動 REJECTED；非 TTY 環境 → 立即失敗

#### XSPEC-092 — Token 預算管理
- `packages/core/src/token-budget.ts` — `TokenBudgetTracker`（claude-opus-4-7/sonnet-4-6/haiku-4-5 + gpt-4o/mini 定價）
- `devap status --cost` — 讀取 `.devap/history` 顯示累積成本

#### XSPEC-093 — Deploy 原語
- `packages/core/src/deploy/` — `DeployRunner` + `EnvironmentGate`（cloudflare-workers / docker-compose）
- `devap deploy <target> --env <env>` — 環境閘門 + dry-run 支援

#### XSPEC-094 — Multi-Agent 協調
- `packages/core/src/agent-pool.ts` — `AgentPool`（maxConcurrentAgents 上限 + 排隊；sequential mode 自動降級）
- `packages/core/src/memory-guard.ts` — `MemoryGuard`（spawn 前記憶體檢查，預設閾值 2048 MB）
- `packages/core/src/worktree-manager.ts` 強化 — `scheduleCleanup()` 自動清理排程

### Fixed
- `packages/core/src/index.ts` — 補上遺漏的 `AccessReader` export（導致 CLI build 失敗）

### Tests
- 總測試數：892 → 1176（+284）
  - core: 892（持平）
  - CLI: 126 → 150（+24 Phase 4/5a 命令）
  - adapter-claude: 84；adapter-vibeops: 32；adapter-cli: 9；adapter-opencode: 9

## [0.3.0] - 2026-04-27

> **Minor Release**: XSPEC-086 Phase 0/1/2/6/7 — 統一流程模型、commit 閘門、release 命令、8 個 UDS 流程標準遷移至 DevAP、全專案安裝（dev-platform/VibeOps/UDS dogfooding）。

### Added

#### Standards Repository（XSPEC-086 Phase 2）
- `standards/flow/` — 4 個純流程標準，從 UDS 遷移至 DevAP 成為 canonical 位置
  - `workflow-enforcement.ai.yaml` — SDD/TDD/BDD/commit 各階段可執行閘門定義（canonical）
  - `workflow-state-protocol.ai.yaml` — `.workflow-state/` 狀態機協定、event log 格式、轉換規則
  - `change-batching-standards.ai.yaml` — PENDING→READY→MERGED 狀態機、threshold 策略（count/score/time）、atomicity 規則
  - `pipeline-integration-standards.ai.yaml` — 6-stage pipeline 模型（PLAN/SPEC/DERIVE/BUILD/REVIEW/CHECKIN）、toggle 設定合約
- `standards/orchestration/` — 3 個編排標準，從 UDS 遷移至 DevAP 成為 canonical 位置
  - `agent-dispatch.ai.yaml` — sub-agent 派遣、並行協調、DONE/BLOCKED/NEEDS_CONTEXT 狀態協定
  - `agent-communication-protocol.ai.yaml` — 8-code 統一狀態協定、Envelope 必填欄位、hook exit code 規範
  - `execution-history.ai.yaml` — L1/L2/L3 分層存取、`.execution-history/` 目錄結構、保留策略、敏感資料 redaction
- `standards/flow/branch-completion.ai.yaml` — 4 選項完成流程（merge/pr/keep/discard）、前置條件檢查、BC-001~BC-004 規則
- `standards/README.md` — standards/ 目錄說明（flow/ + orchestration/ 區分原則）
- `.devap/release-config.json` — 定義版本同步檔案列表 + CHANGELOG 路徑（devap release 依賴）

#### Unified Flow Model（XSPEC-087 / XSPEC-086 Phase 0）
- `FlowParser`：解析 flow YAML 為 FlowDefinition，驗證 gate 類型（HUMAN_CONFIRM/AUTO/SKIP）
- `GateHandler`：gate 執行與狀態記錄（PASSED/BLOCKED/SKIPPED）
- `FlowExecutor`：步驟序列執行 + 錯誤處理 + GateHandler 整合
- 27 個 unit tests（flow-parser/gate-handler/flow-executor）

#### Commit Flow Gate（XSPEC-088 / XSPEC-086 Phase 1）
- `checkFlowGate()`：runtime 攔截未完成閘門的 git commit 嘗試
- `devap commit`：三步 commit 流程命令（generate → HUMAN_CONFIRM → execute）
- `.devap/flows/commit.flow.yaml`：commit 流程定義
- 4 個 integration tests

#### Release Command（XSPEC-089 / XSPEC-086 Phase 6）
- `VersionBumper`：atomic 版本號更新 + rollback（所有 versionFiles 或全部回滾）
- `ChangelogUpdater`：將 [Unreleased] 移至 [version] + 更新日期
- `ReleaseFlow` runner：整合 VersionBumper + ChangelogUpdater + git tag
- `NpmPlatformAdapter`：`gh release create` + dist-tag 自動推斷（latest/next/beta）
- `PipPlatformAdapter`：`python -m build` + `twine upload`
- `CargoPlatformAdapter`：`cargo publish`
- CLI：`devap release --bump <major|minor|patch> [--dry-run|--platform npm|pip|cargo|--skip-confirm]`

#### Cross-Project Installation（XSPEC-086 Phase 7）
- DevAP 安裝至 dev-platform（dogfooding — commit gate 保護規劃流程）
- DevAP 安裝至 VibeOps
- DevAP 安裝至 UDS（dogfooding — `devap release` 取代 `scripts/bump-version.sh`）

#### Harness Engineering — Phase 1, 2 & 3（#4, #5, #6, SPEC-007）
- CLAUDE.md 注入增強 — 品質要求與 Harness 提示 sections 自動注入 sub-agent prompt（#4）
  - `ClaudeMdOptions` 新增 `qualityConfig` 欄位
  - strict 品質模式注入 lint/type-check/judge/retry 等品質檢查細節
  - 所有 task 始終注入 Harness 提示（Quality Gate 驗證提醒）
- PostToolUse Hook 配置生成器 — 根據 QualityConfig 動態產生 Claude Code hooks（#5）
  - `generateHarnessHooks()` 將 lint/type-check 指令轉為 PostToolUse hooks
  - `writeHarnessConfig()` 寫入 worktree 的 `.claude/settings.json`
  - hooks 僅在 Write/Edit/NotebookEdit 工具觸發，quality: "none" 時不注入
- Worktree 環境配置增強 — 並行 task 各自攜帶獨立 Harness 環境（#6）
  - `WorktreeManager.setupTaskEnvironment()` 寫入 task-specific CLAUDE.md + hooks
  - `WorktreeHooksConfig` 輕量介面避免 core ↔ adapter 跨套件依賴
- BDD 場景與 ATDD 追蹤矩陣（3 個 `.feature` + 3 個 ATDD 表）
- Full Hooks Strategy Engine（SPEC-007）— 將 hook 系統從 PostToolUse-only 擴展為完整三事件策略
  - PreToolUse hook：執行期即時攔截危險指令（rm -rf、DROP DATABASE 等），exit code 2 block
  - Stop hook：agent 結束前自動執行 verify_command，失敗則 decision:block 要求繼續修復
  - `generateFullHooksStrategy()` 統一生成三種 hook 配置
  - `generatePreToolUseScript()` 生成可獨立執行的 shell 腳本（jq + pure-bash fallback）
  - 安全攔截始終啟用（即使 quality: "none"），`generateHarnessHooks()` 向後相容

#### Execution History Repository（SPEC-008 Phase 1, 2 & 3）
- 執行歷史持久化 — 每次 task 執行自動產出結構化 artifacts，供後續 agent 從歷史學習
  - `HistoryWriter`：6+1 artifact 生成（task-description、code-diff、test-results、execution-log、token-usage、final-status、error-analysis）
  - `SensitiveDataRedactor`：5 類內建 pattern + 自訂 pattern，所有內容寫入前自動 redact
  - `LocalStorageBackend`：檔案 I/O + 路徑穿越防護
  - L2 manifest + L1 index 自動更新，run number 三位數零填充遞增
- Orchestrator 整合 — `TaskPlan.execution_history.enabled` opt-in 啟用
  - `DiffCapture`：捕獲 task 前後 git diff（含新增檔案），非 git repo 安靜回傳空
  - `LogCollector`：包裝 onProgress 收集結構化日誌，同時轉發原始 callback
  - 未啟用時行為完全不變（向後相容）
- Reader + Retention — 分層讀取 API 與自動保留管理
  - `HistoryReader`：L1 readIndex / L2 readTaskManifest / L3 readArtifact 三層讀取
  - `RetentionManager`：超過 max_runs_per_task 時刪除最舊 L3（保留 L1/L2 索引）
  - stale task 自動歸檔（超過 archive_threshold_days 移至 index-archive.json）
  - reactivate 機制（已歸檔 task 有新 run 時移回 index）

#### Standards & Compliance
- ExecutionReport 新增 `standards_effectiveness` 回饋欄位（UDS SPEC-SELFDIAG-001）（#2）
- QualityGate 新增 AGENTS.md 合規檢查 — 偵測 `.standards/` 與 AGENTS.md 的 drift（#1）
- Envelope Adapter 實作 UDS Agent Communication Protocol
- Anthropic ToS 合規保護機制（SPEC-005）— API key 偵測、首次告知、預算上限
- CLI 模式 adapter 整合完整行為規範 prompt（generated_prompt）

#### Documentation & Tools
- 新增面向開發工程師的完整使用說明（`docs/usage-guide.md`）
- 新增 observability-assistant、runbook-assistant、slo-assistant 技能

### Changed
- UDS 標準同步至 5.1.0-beta.3
- Agent Communication Protocol 標準重新命名（agent-communication → agent-communication-protocol）
- SPEC-005 修正編號衝突並補齊 status metadata

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
- `devap sync-standards` CLI 指令 — 自動從 UDS upstream 同步最新標準（SPEC-006）
  - `--check` 模式：僅檢查版本是否落後（適合 CI，落後時 exit 1）
  - `--force` 模式：強制覆蓋本地修改
  - GitHub API 版本查詢（releases → tags fallback）
  - Skills 版本對齊檢查
- GitHub Actions `check-standards.yml` — 每週排程 + manifest 變更時自動檢查 UDS 版本
- SPEC-006: UDS 同步機制 — 記錄短期 copy-once 改善與中期 npm 包化規劃
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
