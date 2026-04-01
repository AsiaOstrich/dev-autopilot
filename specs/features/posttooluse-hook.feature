# language: zh-TW
# Source: GitHub Issue #5 — feat(adapter-claude): PostToolUse Hook 品質檢查配置注入
# Ref: XSPEC-002 Section 2.2

Feature: PostToolUse Hook 品質檢查配置注入
  作為 devap 編排器
  我需要根據 quality profile 動態配置 PostToolUse hooks
  以便 agent 每次寫檔後獲得即時品質回饋，減少 FixLoop 觸發率

  Background:
    Given 一個 ClaudeAdapter 實例
    And 一個包含 quality 設定的 task

  # AC-1: strict 品質模式注入即時 lint/type-check hooks
  Scenario: strict 品質模式生成 PostToolUse hooks
    Given task plan 設定 quality 為 "strict"
    And qualityConfig 包含 lint_command 和 type_check_command
    When 呼叫 generateHarnessHooks(qualityConfig)
    Then 回傳的 HooksConfig 包含 PostToolUse hook
    And hook 指令包含 lint_command
    And hook 指令包含 type_check_command

  # AC-2: none 品質模式不注入 hooks
  Scenario: none 品質模式不產生 hooks
    Given task plan 設定 quality 為 "none"
    When 呼叫 generateHarnessHooks(qualityConfig)
    Then 回傳的 HooksConfig 不包含任何 hooks

  # AC-3: Hook 配置寫入 worktree 不影響主 repo
  Scenario: Hook 配置寫入 worktree 的 .claude/settings.json
    Given executeTask 在 worktree 模式下執行
    And qualityConfig 為 strict
    When adapter 執行 task
    Then .claude/settings.json 寫入 worktree 路徑下
    And 主 repo 的 .claude/settings.json 不受影響

  # AC-4: QualityGate 最終驗證仍正常運作
  Scenario: QualityGate 在 hook 已執行後仍完整驗證
    Given hook 已在寫檔時執行過 lint 檢查
    When QualityGate 執行最終驗證
    Then 仍依序執行所有品質步驟
    And 不因 hook 已檢查而跳過任何步驟

  # AC-5: 現有測試無 regression
  Scenario: 現有測試無回歸
    Given 套用所有修改後
    When 執行 adapter-claude 和 core 測試
    Then 所有既有測試仍然通過
