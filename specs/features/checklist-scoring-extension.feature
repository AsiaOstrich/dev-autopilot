# language: zh-TW
# [Source] SPEC-011 Checklist Scoring Extension (DevAP)
# [Derived] 從 SPEC-011 的 7 個 AC 推導，經 BDD 細化

Feature: Checklist Scoring Extension — QualityGateResult 評分欄位擴充
  作為 DevAP 使用者
  我希望品質門檻結果包含量化的規格品質評分
  以便 Judge agent 可參考分數作為 APPROVE/REJECT 依據

  Background:
    Given QualityGateResult 介面支援 optional 的 score 與 max_score 欄位
    And Task 介面支援 optional 的 spec_score 與 spec_max_score 欄位

  # ─── AC-3: Score 傳遞（成功路徑） ───

  # [Derived] AC-3: runQualityGate 傳遞 score
  Scenario Outline: 品質門檻通過時傳遞規格評分
    Given 一個 Task 帶有 spec_score=<score> 且 spec_max_score=<max_score>
    And 品質門檻的所有步驟皆通過
    When 執行品質門檻檢查
    Then 結果的 passed 為 true
    And 結果的 score 為 <score>
    And 結果的 max_score 為 <max_score>

    Examples: Standard mode（滿分 10）
      | score | max_score |
      | 8     | 10        |
      | 10    | 10        |

    Examples: Boost mode（滿分 25）
      | score | max_score |
      | 18    | 25        |
      | 25    | 25        |

  # ─── AC-4: 向後相容（無 score） ───

  # [Derived] AC-4: 無 spec_score 時不包含 score
  Scenario: 品質門檻結果不含 score 當 task 未設定規格評分
    Given 一個不帶 spec_score 的 Task
    And 品質門檻的所有步驟皆通過
    When 執行品質門檻檢查
    Then 結果的 passed 為 true
    And 結果不包含 score 欄位
    And 結果不包含 max_score 欄位

  # ─── AC-3 補充: max_score 推斷邏輯 ───

  # [Derived] AC-3: max_score 推斷 — Standard mode
  Scenario Outline: 未指定 max_score 時自動推斷模式
    Given 一個 Task 帶有 spec_score=<score> 但未設定 spec_max_score
    And 品質門檻的所有步驟皆通過
    When 執行品質門檻檢查
    Then 結果的 max_score 為 <inferred_max>

    Examples: 邊界值與典型值
      | score | inferred_max | 說明                        |
      | 1     | 10           | Standard mode 最小值        |
      | 7     | 10           | Standard mode 典型值        |
      | 10    | 10           | Standard mode 邊界值（含）  |
      | 11    | 25           | Boost mode 最小值           |
      | 18    | 25           | Boost mode 典型值           |

  # ─── AC-5: 失敗路徑同樣傳遞 score ───

  # [Derived] AC-5: buildFailResult 傳遞 score
  Scenario: 品質門檻失敗時仍傳遞規格評分
    Given 一個 Task 帶有 spec_score=7 且 spec_max_score=10
    And 品質門檻的某步驟失敗
    When 執行品質門檻檢查
    Then 結果的 passed 為 false
    And 結果的 score 為 7
    And 結果的 max_score 為 10
    And 結果包含失敗回饋訊息

  # [Derived] AC-5 補充: 失敗路徑無 score
  Scenario: 品質門檻失敗且無規格評分時不包含 score
    Given 一個不帶 spec_score 的 Task
    And 品質門檻的某步驟失敗
    When 執行品質門檻檢查
    Then 結果的 passed 為 false
    And 結果不包含 score 欄位
    And 結果包含失敗回饋訊息

  # ─── AC-6: Schema 合約 ───

  # [Derived] AC-6: task-schema.json 欄位定義
  Scenario: task-schema.json 包含 scoring 欄位定義
    Given 現有的 specs/task-schema.json
    When 查看 task 物件的 properties
    Then 包含 spec_score 欄位且 type 為 "number"
    And 包含 spec_max_score 欄位且 type 為 "number"
    And spec_score 不在 required 列表中
    And spec_max_score 不在 required 列表中

  # ─── AC-7: 回歸驗證 ───

  # [Derived] AC-7: 無 regression
  Scenario: 新增欄位後現有測試無 regression
    Given 所有 SPEC-011 變更已套用
    When 執行完整測試套件
    Then 所有現有測試仍然通過
    And 無任何 TypeScript 編譯錯誤
