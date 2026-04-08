# language: zh-TW
# [Source] DEC-011 Stigmergic 間接協調模式落地
# [Derived] 從 DEC-011 的 14 個 AC 推導 BDD 場景

Feature: Stigmergic 間接協調 — ActivationPredicate 動態條件觸發
  作為 DevAP 使用者
  我希望 DAG 任務支援動態激活條件
  以便任務能根據前置任務的度量或狀態動態決定是否執行

  Background:
    Given 一個有效的 task plan
    And orchestrator 已初始化

  # ========================================
  # R1: STIGMERGY.md 架構文件
  # ========================================

  # [Derived] AC-011-001
  Scenario: STIGMERGY.md 存在且包含必要區段
    Given DEC-011 實作完成
    When 讀取 "docs/STIGMERGY.md"
    Then 文件包含「共享狀態媒介」區段
    And 文件包含所有 7 個 TaskStatus 值的語義定義
    And 文件包含「與直接訊息傳遞的區別」區段

  # ========================================
  # R2: ActivationPredicate 型別定義
  # ========================================

  # [Derived] AC-011-002
  Scenario: Task 介面包含 optional activationPredicate 欄位
    Given 現有的 Task 介面
    When 檢查 activationPredicate 欄位
    Then 該欄位型別為 ActivationPredicate 或 undefined
    And 不影響現有 Task 介面的其他欄位

  # [Derived] AC-011-010（向後相容 - 型別層面）
  Scenario: 不設定 activationPredicate 的 task 可正常使用
    Given 一個不含 activationPredicate 的 task:
      | id    | title      | spec        |
      | T-001 | 基本任務   | 執行基本操作 |
    When 將此 task 加入 plan
    Then plan 驗證通過
    And task 行為與先前完全相同

  # ========================================
  # R3: Plan Validator 語義驗證
  # ========================================

  # [Derived] AC-011-003
  Scenario: threshold 類型缺少必要欄位時驗證失敗
    Given 一個 task 的 activationPredicate 為:
      """json
      { "type": "threshold", "metric": "fail_rate", "description": "失敗率檢查" }
      """
    When 執行 validatePlan()
    Then 回傳 valid 為 false
    And errors 包含 "threshold 類型必須同時提供 metric、operator、value"

  Scenario: threshold 類型三欄位齊全時驗證通過
    Given 一個 task 的 activationPredicate 為:
      """json
      { "type": "threshold", "metric": "fail_rate", "operator": ">", "value": 0.3, "description": "失敗率超過 30%" }
      """
    When 執行 validatePlan()
    Then 該 predicate 不產生驗證錯誤

  # [Derived] AC-011-004
  Scenario: state_flag 類型引用不存在的 taskId 時驗證失敗
    Given 一個 task 的 activationPredicate 為:
      """json
      { "type": "state_flag", "taskId": "T-999", "expectedStatus": "failed", "description": "T-999 失敗時觸發" }
      """
    And plan 中不存在 task ID "T-999"
    When 執行 validatePlan()
    Then 回傳 valid 為 false
    And errors 包含 "activationPredicate 引用不存在的 Task: T-999"

  Scenario: state_flag 類型引用有效 taskId 時驗證通過
    Given plan 包含 task "T-001" 和 "T-002"
    And T-002 的 activationPredicate 為:
      """json
      { "type": "state_flag", "taskId": "T-001", "expectedStatus": "failed", "description": "T-001 失敗時觸發" }
      """
    When 執行 validatePlan()
    Then 該 predicate 不產生驗證錯誤

  # [Derived] AC-011-005
  Scenario: custom 類型包含危險指令時驗證失敗
    Given 一個 task 的 activationPredicate 為:
      """json
      { "type": "custom", "command": "rm -rf /", "description": "清除後重建" }
      """
    When 執行 validatePlan()
    Then 回傳 valid 為 false
    And errors 包含危險指令偵測訊息

  Scenario: custom 類型安全指令驗證通過
    Given 一個 task 的 activationPredicate 為:
      """json
      { "type": "custom", "command": "test -f coverage.json", "description": "coverage 存在" }
      """
    When 執行 validatePlan()
    Then 該 predicate 不產生驗證錯誤

  # [Derived] AC-011-013（回歸）
  Scenario: 無 activationPredicate 的 plan 驗證向後相容
    Given 一個不含任何 activationPredicate 的有效 plan
    When 執行 validatePlan()
    Then 回傳 valid 為 true
    And 行為與修改前完全相同

  # ========================================
  # R4: JSON Schema 更新
  # ========================================

  # [Derived] AC-011-006
  Scenario: JSON Schema 正確驗證 activationPredicate 結構
    Given 一個 task 的 activationPredicate type 為 "invalid_type"
    When 執行 JSON Schema 驗證
    Then schema 驗證失敗
    And 錯誤訊息指出 type 值不在允許清單中

  # ========================================
  # R5: Orchestrator 評估邏輯
  # ========================================

  # [Derived] AC-011-007
  Scenario: threshold 條件不滿足時 task 被 skip
    Given task T-002 依賴 T-001
    And T-002 的 activationPredicate 為:
      """json
      { "type": "threshold", "metric": "fail_rate", "operator": ">", "value": 0.3, "description": "失敗率超過 30% 才觸發" }
      """
    And T-001 已完成，結果 metrics 為 { "fail_rate": 0.1 }
    When orchestrator 執行 T-002
    Then T-002 狀態為 "skipped"
    And error 包含 "activation predicate not met: 失敗率超過 30% 才觸發"

  Scenario: threshold 條件滿足時 task 正常執行
    Given task T-002 依賴 T-001
    And T-002 的 activationPredicate 為:
      """json
      { "type": "threshold", "metric": "fail_rate", "operator": ">", "value": 0.3, "description": "失敗率超過 30% 才觸發" }
      """
    And T-001 已完成，結果 metrics 為 { "fail_rate": 0.5 }
    When orchestrator 執行 T-002
    Then T-002 正常執行（不被 skip）

  # [Derived] AC-011-008
  Scenario: state_flag 條件不滿足時 task 被 skip
    Given task T-003 的 activationPredicate 為:
      """json
      { "type": "state_flag", "taskId": "T-001", "expectedStatus": "failed", "description": "T-001 失敗時才修復" }
      """
    And T-001 的最終狀態為 "success"
    When orchestrator 執行 T-003
    Then T-003 狀態為 "skipped"

  Scenario: state_flag 條件滿足時 task 正常執行
    Given task T-003 的 activationPredicate 為:
      """json
      { "type": "state_flag", "taskId": "T-001", "expectedStatus": "failed", "description": "T-001 失敗時才修復" }
      """
    And T-001 的最終狀態為 "failed"
    When orchestrator 執行 T-003
    Then T-003 正常執行

  # [Derived] AC-011-009
  Scenario: custom 指令回傳非零時 task 被 skip
    Given task T-002 的 activationPredicate 為:
      """json
      { "type": "custom", "command": "test -f nonexistent.file", "description": "檔案存在時才執行" }
      """
    And 該指令執行回傳 exit code 1
    When orchestrator 執行 T-002
    Then T-002 狀態為 "skipped"

  Scenario: custom 指令回傳零時 task 正常執行
    Given task T-002 的 activationPredicate 為:
      """json
      { "type": "custom", "command": "true", "description": "永遠通過" }
      """
    And 該指令執行回傳 exit code 0
    When orchestrator 執行 T-002
    Then T-002 正常執行

  # [Derived] AC-011-010（向後相容 - 執行層面）
  Scenario: 無 activationPredicate 時 orchestrator 行為不變
    Given task 沒有 activationPredicate 欄位
    And 依賴已滿足
    When orchestrator 執行該 task
    Then 直接執行，與先前行為完全相同

  # ========================================
  # R6: TaskResult.metrics 欄位
  # ========================================

  # [Derived] AC-011-011
  Scenario: TaskResult 包含 optional metrics 欄位
    Given 現有的 TaskResult 介面
    When 新增 metrics 欄位
    Then 該欄位型別為 Record<string, number> 或 undefined
    And 不影響現有 TaskResult 的其他欄位

  # ========================================
  # R7: QualityGate Threshold-Trigger (Future Work)
  # ========================================

  # [Derived] AC-011-012
  Scenario: QualityGate 不動態插入任務
    Given DEC-011 Phase 1 實作完成
    When 檢查 QualityGate 程式碼
    Then QualityGate 不會動態插入新任務到 DAG
    And 既有 QualityGate 行為不受影響
