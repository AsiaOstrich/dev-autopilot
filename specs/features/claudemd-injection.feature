# language: zh-TW
# Source: GitHub Issue #4 — feat(claudemd): CLAUDE.md 注入增強
# Ref: XSPEC-002 Section 1.2

Feature: CLAUDE.md 注入增強 — 品質要求與 Harness 提示
  作為 devap 編排器
  我需要在生成的 CLAUDE.md 中注入品質要求和 Harness 提示
  以便 sub-agent 知道完成後會被怎麼驗證，並善用 Harness 工具鏈

  Background:
    Given 一個包含至少一個 task 的 task plan

  # AC-1: 含 quality: "strict" 的 task plan 生成的 CLAUDE.md 包含品質要求 section
  Scenario: strict 品質模式注入品質要求
    Given task plan 設定 quality 為 "strict"
    And qualityConfig 包含 verify, lint_command, type_check_command
    When 呼叫 generateClaudeMd()
    Then 輸出包含 "## 品質要求" section
    And section 內容列出 verify, lint, type-check 的具體指令

  Scenario: 無 qualityConfig 時不注入品質要求
    Given task plan 未設定 quality 或 qualityConfig 為 undefined
    When 呼叫 generateClaudeMd()
    Then 輸出不包含 "## 品質要求" section

  # AC-2: 所有 task plan 的 CLAUDE.md 包含 Harness 提示 section
  Scenario: 始終注入 Harness 提示
    Given 任意 task plan（無論有無 quality 設定）
    When 呼叫 generateClaudeMd()
    Then 輸出包含 "## Harness 提示" section
    And section 提醒 agent 執行結果會被 Quality Gate 驗證

  # AC-3: 生成的 CLAUDE.md 不超過 200 行
  Scenario: 完整內容不超過 200 行
    Given task 包含所有可選欄位（acceptance_criteria, user_intent, verify_command）
    And qualityConfig 為 strict 模式（含所有指令）
    And extraConstraints 包含 5 條約束
    And existingClaudeMdPath 指向 50 行的既有 CLAUDE.md
    When 呼叫 generateClaudeMd()
    Then 輸出總行數 <= 200

  # AC-4: 新增測試案例並通過
  Scenario: 新增測試涵蓋所有新功能
    Given claudemd-generator.test.ts 包含 AC-1~3 的測試案例
    When 執行 npm test
    Then 所有新增測試通過

  # AC-5: 現有測試無 regression
  Scenario: 現有測試無回歸
    Given 套用所有修改後
    When 執行 npm test
    Then 所有既有測試仍然通過
