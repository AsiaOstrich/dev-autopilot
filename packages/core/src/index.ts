export * from "./types.js";
export { validatePlan } from "./plan-validator.js";
export { orchestrate, topologicalSort, topologicalLayers, mergeDefaults } from "./orchestrator.js";
export { createDefaultSafetyHook, detectDangerousCommand, detectHardcodedSecrets, normalizeSecurityDecision, checkFlowGate, FLOW_GATED_COMMANDS, type CommitGateCheckResult, type FlowState } from "./safety-hook.js";
export { CircuitBreaker, CircuitOpenError, type CircuitBreakerConfig, type CircuitBreakerState } from "./circuit-breaker.js";
export { WorktreeManager, type WorktreeInfo } from "./worktree-manager.js";
export { generateClaudeMd, writeClaudeMd, type ClaudeMdOptions } from "./claudemd-generator.js";
export { runJudge, runDualStageJudge, shouldRunJudge, buildJudgePrompt, parseJudgeOutput, type JudgeResult, type JudgeVerdict, type JudgeOptions, type CriteriaResult } from "./judge.js";
export { runQualityGate, checkAgentsMdSync, checkFrontendDesignCompliance, type QualityGateResult, type QualityGateStep, type QualityGateOptions, type ShellExecutor, type HookTelemetry, type FrontendDesignCheckResult } from "./quality-gate.js";
export { resolvePlan, type PlanResolverOptions } from "./plan-resolver.js";
export { resolveQualityProfile, checkQualityWarnings } from "./quality-profile.js";
export { runFixLoop, buildStructuredFeedback, computeErrorFingerprint, isStuck, getMaxRetries, type ExecuteResult, type FixLoopCallbacks } from "./fix-loop.js";
export { parseTelemetryJsonl } from "./telemetry-parser.js";
export { TokenCostAnalyzer, ProposalGenerator, HookEfficiencyAnalyzer, HookEfficiencyProposalGenerator, QualityStrategyAnalyzer, QualityStrategyProposalGenerator, DriftDetector, ApprovalManager, serializeProposal, parseProposal } from "./evolution/index.js";
export type { EvolutionConfig, AnalyzerConfig, QualityStrategyConfig, DriftDetectionConfig, AnalysisResult, HookEfficiencyAnalysisResult, HookEfficiencyIssue, QualityStrategyAnalysisResult, QualityStrategyIssue, QualityStrategySignal, DriftAnalysisResult, DriftItem, DriftType, GroupKey, GroupStats, Outlier, Proposal, ProposalMeta, ProposalStatus, ProposalImpact, ProposalTarget, AnalysisLogEntry, ConfirmApplyFn, ApprovalResult } from "./evolution/index.js";
export { LocalStorageBackend } from "./execution-history/index.js";
// SPEC-015: 打包框架
export { loadRecipe, resolveConfig, executeTarget, interpolateCommand, orchestratePackaging } from "./packaging/index.js";
export type { PackagingTarget, PackagingConfig, Recipe, RecipeStep, PackagingResult, OrchestrateOptions } from "./packaging/index.js";
// XSPEC-047: 分支漂移偵測
export { checkBranchDrift, type BranchDriftResult, type BranchDriftStatus, type BranchDriftConfig } from "./branch-drift.js";
// XSPEC-046: 恢復食譜註冊表
export { RecoveryRegistry, DEFAULT_RECIPES } from "./recovery-registry.js";
// XSPEC-057: Multi-Plan Support
export { loadPlan, listPlans, PlanNotFoundError, MultiPlanFileRequiresPlanFlagError } from "./plan-loader.js";
// XSPEC-087: 統一流程定義模型
export { FlowParser, GateHandler, FlowExecutor, type StepHandlerMap } from "./flow/index.js";
// XSPEC-093: Deploy 原語
export {
  DeployRunner,
  checkReleaseTagExistsAsync,
  checkStagingRequired,
  requireProdHITL,
  getCurrentVersion,
  type DeployRunnerOptions,
  type GateCheckResult,
  type DeployTargetType,
  type EnvironmentConfig,
  type DeployConfig,
  type DeployState,
  type DeployResult,
  type HealthCheckResult,
  type DeployShellExecutor,
  type DeployHttpChecker,
  type DeployCommandResult,
} from "./deploy/index.js";
// XSPEC-092: Token 預算管理
export {
  TokenBudgetTracker,
  checkTokenBudget,
  DEFAULT_PRICING,
  type TokenRecord,
  type ModelPricing,
  type TokenBudgetConfig,
  type TokenTotals,
  type TokenBudgetCheckStatus,
  type TokenBudgetCheckResult,
} from "./token-budget.js";
// XSPEC-091: HITL Gate 正式化
export {
  runHITLGate,
  shouldRequireHITL,
  type HITLDecision,
  type HITLGateOptions,
  type HITLAuditRecord,
  type HITLGateResult,
  type HITLConfig,
} from "./hitl-gate.js";
// XSPEC-094: Multi-Agent 協調（Phase 1 + Phase 2）
export {
  MemoryGuard,
  type MemoryGuardConfig,
  type MemoryCheckResult,
  type MemoryProvider,
} from "./memory-guard.js";
export {
  AgentPool,
  type AgentPoolConfig,
  type SpawnDecision,
  type SpawnResult,
  type AgentPoolState,
} from "./agent-pool.js";
export {
  ConflictDetector,
  type ConflictCheck,
  type FileLockInfo,
} from "./conflict-detector.js";
export {
  ResultMerger,
  type AgentTaskResult,
  type MergeResult,
  type MergeShellExecutor,
  type ResultMergerOptions,
} from "./result-merger.js";
// XSPEC-090: Spec 合規閘門
export {
  checkSpecGate,
  type XspecStatus,
  type SpecGateMode,
  type SpecMatch,
  type SpecGateOptions,
  type SpecGateResult,
} from "./spec-gate.js";
// XSPEC-089: Release 流程（version bump + CHANGELOG + Platform Adapter + ReleaseFlow runner）
export {
  VersionBumper,
  bumpVersion,
  ChangelogUpdater,
  inferDistTag,
  NpmPlatformAdapter,
  PipPlatformAdapter,
  CargoPlatformAdapter,
  ReleaseFlow,
  type BumpLevel,
  type VersionFileSpec,
  type VersionBumpPlan,
  type ChangelogUpdatePlan,
  type Platform,
  type PlatformAdapter,
  type PublishOptions,
  type PublishResult,
  type ReleaseStep,
  type ReleaseFlowOptions,
  type PipPublishOptions,
  type CargoPublishOptions,
} from "./release/index.js";
