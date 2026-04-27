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
