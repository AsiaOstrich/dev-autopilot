/**
 * Evolution 模組（XSPEC-004 Phase 4.1 + 4.2 + 4.3）
 *
 * - TokenCostAnalyzer：利用執行歷史數據識別異常 token 消耗
 * - HookEfficiencyAnalyzer：讀取 telemetry.jsonl 識別低通過率 hook
 * - QualityStrategyAnalyzer：以 tag 群組分析品質策略適切性
 * 產生改進提案供人類審批。
 */

export * from "./types.js";
export { TokenCostAnalyzer } from "./token-cost-analyzer.js";
export { HookEfficiencyAnalyzer } from "./hook-efficiency-analyzer.js";
export { QualityStrategyAnalyzer } from "./quality-strategy-analyzer.js";
export {
  ProposalGenerator,
  serializeProposal,
  parseProposal,
} from "./proposal-generator.js";
export { HookEfficiencyProposalGenerator } from "./hook-efficiency-proposal-generator.js";
export { QualityStrategyProposalGenerator } from "./quality-strategy-proposal-generator.js";
export {
  ApprovalManager,
  type ConfirmApplyFn,
  type ApprovalResult,
} from "./approval-manager.js";
