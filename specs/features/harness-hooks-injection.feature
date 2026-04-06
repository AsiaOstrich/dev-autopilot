# language: zh-TW
# Source: SPEC-009 — Harness Hooks Configuration Injection
# Ref: SPEC-007 (Full Hooks Strategy Engine)

Feature: Harness Hooks 配置注入
  作為 devap 編排器
  我需要在 executeTask 執行前根據 quality profile 動態注入 hooks 配置到 worktree
  以便 agent 寫檔時獲得即時品質回饋，且事後 QualityGate 不重複驗證

  Background:
    Given 一個 ClaudeAdapter 實例
    And 一個包含 quality 設定的 task

  # ==========================================================
  # Requirement 1: executeTask 注入 hooks 配置
  # ==========================================================

  # AC-1: executeTask 在 query() 前寫入 hooks 配置
  # AC-2: strict 模式生成 PostToolUse lint/type-check hooks
  Scenario: strict 模式注入完整 hooks 配置
    Given task plan 設定 quality 為 "strict"
    And qualityConfig 包含 lint_command "pnpm lint" 和 type_check_command "pnpm tsc --noEmit"
    When 呼叫 executeTask()
    Then 在 query() 被呼叫前 {cwd}/.claude/settings.json 已存在
    And settings.json 包含 PreToolUse 安全攔截 hooks
    And settings.json 包含 PostToolUse lint/type-check hooks
    And settings.json 包含 Stop 品質門檻 hooks

  # AC-3: none 模式不生成 PostToolUse/Stop hooks
  Scenario: none 模式僅注入安全 hooks
    Given task plan 設定 quality 為 "none"
    When 呼叫 executeTask()
    Then {cwd}/.claude/settings.json 僅包含 PreToolUse 安全攔截 hooks
    And settings.json 不包含 PostToolUse hooks
    And settings.json 不包含 Stop hooks

  # AC-8: 向後相容
  Scenario: 無 QualityConfig 時不注入
    Given executeTask 未收到 qualityConfig
    When 呼叫 executeTask()
    Then 不建立 {cwd}/.claude/settings.json
    And query() 正常被呼叫

  # ==========================================================
  # Requirement 2: 執行完成後清理 hooks 配置
  # ==========================================================

  # AC-4: query() 完成後清理
  Scenario: 正常完成後清理 hooks 配置
    Given executeTask 已寫入 hooks 配置到 {cwd}/.claude/settings.json
    When query() 正常完成
    Then {cwd}/.claude/settings.json 被刪除

  # AC-4: 異常結束仍清理
  Scenario: query() 拋出異常仍清理 hooks 配置
    Given executeTask 已寫入 hooks 配置到 {cwd}/.claude/settings.json
    When query() 拋出異常
    Then {cwd}/.claude/settings.json 仍被刪除

  # ==========================================================
  # Requirement 3: QualityConfig 透過 ExecuteOptions 傳遞
  # ==========================================================

  # AC-5: ExecuteOptions 新增 qualityConfig 欄位
  Scenario: Orchestrator 傳遞 QualityConfig 給 adapter
    Given Orchestrator 已透過 resolveQualityProfile() 取得 QualityConfig
    When 呼叫 adapter.executeTask(task, { qualityConfig })
    Then adapter 使用此 QualityConfig 生成 hooks 配置

  # ==========================================================
  # Requirement 4: Quality Gate hook telemetry 去重
  # ==========================================================

  # AC-6: hook telemetry pass 時跳過
  Scenario: hook 已執行 lint 且通過，Quality Gate 跳過 lint
    Given hookTelemetry 記錄 lint_passed 為 true
    When runQualityGate() 執行到 lint 步驟
    Then 跳過 lint 步驟
    And steps 中記錄 passed: true, output: "Skipped: hook telemetry indicates pass"

  # AC-6: 無 telemetry 時正常執行
  Scenario: 無 hook telemetry 時正常執行 lint
    Given 未傳入 hookTelemetry
    When runQualityGate() 執行到 lint 步驟
    Then 正常執行 lint 指令

  # AC-6: telemetry 報告失敗時仍執行
  Scenario: hook telemetry 報告 lint 失敗時 Quality Gate 仍執行
    Given hookTelemetry 記錄 lint_passed 為 false
    When runQualityGate() 執行到 lint 步驟
    Then 正常執行 lint 指令（不信任失敗後的修復結果）

  # ==========================================================
  # Requirement 5: PostToolUse hook debounce 機制
  # ==========================================================

  # AC-7: debounce 5 秒
  Scenario: 連續寫入同一檔案觸發 debounce
    Given agent 在 2 秒內對 src/index.ts 執行 3 次 Write
    When 每次 Write 觸發 PostToolUse hook
    Then 僅第 1 次實際執行品質檢查
    And 後 2 次跳過並回傳 exit 0

  # AC-7: 不同檔案不受 debounce 影響
  Scenario: 不同檔案不受 debounce 影響
    Given agent 對 src/a.ts 和 src/b.ts 各執行 1 次 Write
    When PostToolUse hooks 被觸發
    Then 兩次都實際執行品質檢查

  # AC-7: debounce 過期重新觸發
  Scenario: debounce 過期後重新觸發
    Given agent 對 src/index.ts 執行 Write 並等待 6 秒
    When 再次對 src/index.ts 執行 Write
    Then 第 2 次實際執行品質檢查

  # ==========================================================
  # AC-9 & AC-10: 隔離性與回歸
  # ==========================================================

  # AC-9: hooks 配置不影響主 repo
  Scenario: hooks 配置僅存在於 worktree
    Given executeTask 在 worktree 路徑 /tmp/wt-001 執行
    And qualityConfig 為 strict
    When adapter 執行 task
    Then /tmp/wt-001/.claude/settings.json 存在
    And 主 repo 的 .claude/settings.json 不受影響

  # AC-10: 既有測試無 regression
  Scenario: 既有測試無 regression
    Given 套用所有 SPEC-009 修改後
    When 執行 pnpm test
    Then harness-config.test.ts 所有測試通過
    And quality-gate.test.ts 所有測試通過
    And claude-adapter.test.ts 所有測試通過
    And orchestrator.test.ts 所有測試通過
