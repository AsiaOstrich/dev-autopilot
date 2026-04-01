# language: zh-TW
# Source: GitHub Issue #6 — feat(worktree): 並行 Task Worktree 環境配置增強
# Ref: XSPEC-002 Section 2.3

Feature: 並行 Task Worktree 環境配置增強
  作為 devap 編排器
  我需要每個 worktree 攜帶 task-specific 的 CLAUDE.md 和 hooks 配置
  以便並行 task 各自有獨立的 Harness 環境

  Background:
    Given 一個 WorktreeManager 實例
    And 專案根目錄為有效 git repo

  # AC-1: 並行 task 各自有獨立 CLAUDE.md
  Scenario: 並行 task 各自在獨立 worktree 中有獨立 CLAUDE.md
    Given 2 個無依賴的並行 task T-001 和 T-002
    And 各自有不同的 generated_prompt 內容
    When 呼叫 setupTaskEnvironment() 為各 task 設定環境
    Then T-001 的 worktree 中有 CLAUDE.md 且內容包含 T-001 的 prompt
    And T-002 的 worktree 中有 CLAUDE.md 且內容包含 T-002 的 prompt
    And 兩份 CLAUDE.md 內容不同

  # AC-2: Worktree 清理後不留殘餘
  Scenario: 清理後 worktree 目錄不存在
    Given task T-001 已建立 worktree 並完成環境設定
    When 呼叫 cleanup("T-001")
    Then worktree 路徑的目錄已不存在
    And .claude/settings.json 不存在於該路徑

  # AC-3: 現有測試無 regression
  Scenario: 現有 worktree-manager 測試無回歸
    Given 套用所有修改後
    When 執行 packages/core 測試
    Then 既有 8 個 worktree-manager 測試全部通過
