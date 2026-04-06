# language: zh-TW
# [Source] SPEC-010 Telemetry Unification (DevAP)
# [Derived] 從 SPEC-010 的 5 個 AC 推導 5 個 BDD 場景

Feature: Telemetry 統一 — Harness Hook 資料彙整
  作為 DevAP 使用者
  我希望 ExecutionReport 包含 harness hook 的 telemetry 統計
  以便我能從單一報告了解 UDS 標準的整體遵循狀況

  Background:
    Given orchestrator 已完成任務執行
    And buildReport() 準備彙整報告

  # [Derived] AC-1: HarnessHookData 型別存在且可選
  Scenario: StandardsEffectivenessReport 包含可選的 harness_hook_data 欄位
    Given 現有的 StandardsEffectivenessReport 介面
    When 查看 harness_hook_data 欄位
    Then 該欄位型別為 HarnessHookData 或 undefined
    And 不影響現有 StandardsEffectivenessReport 的其他欄位

  # [Derived] AC-2: telemetry.jsonl 存在時正確彙總
  Scenario: telemetry.jsonl 存在且有效時彙總統計正確
    Given ".standards/telemetry.jsonl" 存在且包含以下有效事件:
      | standard_id    | passed | duration_ms |
      | testing        | true   | 1200        |
      | testing        | false  | 800         |
      | commit-message | true   | 50          |
    When buildReport() 被呼叫
    Then standards_effectiveness.harness_hook_data.total_executions 為 3
    And pass_count 為 2，fail_count 為 1
    And pass_rate 為 0.6667（近似值）
    And avg_duration_ms 為 683.33（近似值）
    And by_standard 包含 "testing" 群組（executions=2, pass_rate=0.5）
    And by_standard 包含 "commit-message" 群組（executions=1, pass_rate=1.0）

  # [Derived] AC-3: telemetry.jsonl 不存在時為 undefined
  Scenario: telemetry.jsonl 不存在時 harness_hook_data 為 undefined
    Given ".standards/telemetry.jsonl" 不存在
    When buildReport() 被呼叫
    Then standards_effectiveness.harness_hook_data 為 undefined
    And 其餘報告欄位不受影響

  # [Derived] AC-4: 無效行被跳過
  Scenario: telemetry.jsonl 包含無效行時跳過並繼續
    Given ".standards/telemetry.jsonl" 包含以下內容:
      """
      {"standard_id":"testing","passed":true,"duration_ms":100}
      THIS IS NOT JSON
      {"standard_id":"testing","passed":false,"duration_ms":200}
      """
    When buildReport() 被呼叫
    Then harness_hook_data.total_executions 為 2
    And 無效行被靜默跳過
    And 不拋出例外

  # [Derived] AC-5: 無 regression
  Scenario: 無 telemetry 檔案時報告結構不變
    Given 專案未使用 UDS harness hooks
    And ".standards/telemetry.jsonl" 不存在
    When orchestrator 完成執行並呼叫 buildReport()
    Then ExecutionReport 結構與變更前完全相同
    And 現有測試套件全數通過
