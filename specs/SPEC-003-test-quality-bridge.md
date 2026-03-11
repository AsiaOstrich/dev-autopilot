# SPEC-003: UDS-devap 測試品質銜接系統

## Context

**UDS** 定義規格與測試標準（「什麼是品質」），**devap** 執行 UDS 生成的規格與測試（「如何驗證品質」）。目前兩者缺乏正式銜接：

- UDS `testing.ai.yaml` 金字塔定義不一致（`pyramid` 寫 70/20/10 三層，`rules` 寫 70/20/7/3 四層）
- UDS 引用的 9 個 `options/testing/*.ai.yaml` 全部不存在
- UDS 缺少 Test Policy、Test Completion Criteria、Test Plan/Case 模板
- devap `TestLevelName` 只有 3 層（unit/integration/e2e），缺少 system
- devap `QualityConfig` 缺少靜態分析、完成準則檢查

本計畫基於以下標準建立兩者的完整銜接：

| 標準/來源 | 引用內容 |
|----------|---------|
| ISO/IEC/IEEE 29119-2 | Test Processes |
| ISO/IEC/IEEE 29119-3 | Test Documentation（Test Plan / Test Case） |
| ISO/IEC/IEEE 29119-4 | Test Techniques（ISTQB 技法） |
| ISO/IEC/IEEE 12207 | Verification Process + Integration Process |
| Agile/Scrum Guide | Definition of Done (DoD) |
| ISTQB Foundation Syllabus | 測試層級、測試類型 |
| Mike Cohn Test Pyramid | 金字塔經驗比例（非標準，為 recommended defaults） |
| Martin Fowler | Testing Patterns（Mock/Stub/Fake/Spy） |

### 術語對照

| 本 spec 用語 | 標準來源 | 說明 |
|-------------|---------|------|
| Definition of Done (DoD) | Agile/Scrum | 任務/功能完成的檢查清單 |
| Test Completion Criteria | ISO 29119-2 | 測試活動的退出準則（ISO 正式術語） |
| System Integration Testing | ISO 12207 Verification + Integration | 非 ISO 正式術語，但業界通用 |
| 金字塔比例 70/20/7/3 | Mike Cohn (empirical) | 推薦預設值，非強制標準 |

---

## Part A: UDS 端修改

### A1. 修正 `.standards/testing.ai.yaml`

統一金字塔為 4 層，推薦預設比例 70/20/7/3（源自 Mike Cohn，非強制標準）：

| 變更位置 | 原值 | 新值 |
|---------|------|------|
| L9 `guidelines[0]` | `"Follow 70/20/10 testing pyramid"` | `"Follow 70/20/7/3 testing pyramid (UT/IT/ST/E2E)"` |
| L32 `pyramid.ratio` | `"70/20/10"` | `"70/20/7/3"` |
| L34-47 `pyramid.levels` | 3 層（UT/IT/E2E） | 4 層（見下方） |
| L33 `pyramid.note` | 提及 ISTQB 4 levels | 更新為統一說明 |

新增 System Tests 層級：
```yaml
- name: System Tests (ST)
  percentage: 7
  scope: Complete subsystem with stubbed external dependencies
  speed: Medium (<10s)
```

E2E percentage 從 10 改為 3。

### A2. 新增 `.standards/test-governance.ai.yaml`

測試治理標準，涵蓋使用者要求的第一、三、四階段：

- **test_policy**：品質目標（QO-1~3）、各層級負責人與環境
- **completion_criteria**：task/feature/release 三個層級的完成準則
  - ISO 29119 稱為 Test Completion Criteria / Test Exit Criteria
  - Agile/Scrum 稱為 Definition of Done (DoD)
  - 本標準同時支援兩種語境
- **environment_management**：local/ci/sit/staging 四環境與 mock 策略
  - SIT = System Integration Testing，對齊 ISO 12207 Verification + Integration Process
- **rules**：`enforce-completion-criteria`（required）、`pyramid-compliance`（required）、`sit-isolation`（recommended）

### A3. 新增 `.standards/test-plan-template.md`

ISO 29119-3 啟發的 Test Plan 模板，欄位可直接映射到 devap TaskPlan：
- 測試範圍 → `TaskPlan.project`
- 測試層級定義 → `TaskPlan.defaults.test_levels`
- 靜態分析 → `TestPolicy.static_analysis_command`
- 品質門檻 → `QualityConfig`

### A4. 新增 `.standards/test-case-template.md`

標準化 Test Case 格式（TC-NNN），含驗證指令欄位可直接作為 devap 的 `verify_command`。

### A5. 建立 `.standards/options/testing/` 選項檔案（9 個）

先建骨架結構：
```
.standards/options/testing/
├── istqb-framework.ai.yaml
├── industry-pyramid.ai.yaml
├── unit-testing.ai.yaml
├── integration-testing.ai.yaml
├── system-testing.ai.yaml      ← 本次重點
├── e2e-testing.ai.yaml
├── security-testing.ai.yaml
├── performance-testing.ai.yaml
└── contract-testing.ai.yaml
```

---

## Part B: devap 端修改

### B1. `packages/core/src/types.ts` — 型別擴充

**1) TestLevelName 加入 `system`**
```typescript
export type TestLevelName = "unit" | "integration" | "system" | "e2e";
```

**2) 新增 CompletionCheck + TestPolicy**
```typescript
/**
 * 完成準則檢查項目
 *
 * 對應 ISO 29119 Test Completion Criteria / Agile DoD。
 */
export interface CompletionCheck {
  name: string;
  command?: string;    // 有 command → 自動驗證；無 → 由 Judge 審查
  required: boolean;
}

/**
 * 測試策略定義
 *
 * 連結 UDS test-governance 標準。
 */
export interface TestPolicy {
  /** 金字塔推薦比例（加總應為 100，為經驗值非強制） */
  pyramid_ratio?: { unit: number; integration: number; system: number; e2e: number };
  /** 完成準則（ISO 29119 Test Completion Criteria / Agile DoD） */
  completion_criteria?: CompletionCheck[];
  /** 靜態分析指令 */
  static_analysis_command?: string;
}
```

**3) TaskPlan 新增 `test_policy?`**

**4) QualityConfig 擴充**
```typescript
static_analysis_command?: string;
completion_criteria?: CompletionCheck[];
```

### B2. `specs/task-schema.json` — Schema 同步

- `definitions.test_level.name.enum` 加入 `"system"`
- 新增 `definitions.test_policy` 定義
- 頂層 `properties` 加入 `test_policy`

### B3. `packages/core/src/quality-gate.ts` — 門檻擴充

**1) QualityGateStep.name 擴充**
```typescript
name: "verify" | "lint" | "type_check" | "static_analysis" | "completion_check"
     | "unit" | "integration" | "system" | "e2e";
```

**2) runQualityGate 新增兩個步驟**（在 type_check 之後）：
- `static_analysis_command`：執行靜態分析，失敗即停
- `completion_criteria`：逐項執行有 command 的完成準則，`required: true` 的失敗即停

### B4. `packages/core/src/quality-profile.ts` — 合併 test_policy

`resolveQualityProfile()` 將 `plan.test_policy` 的 `static_analysis_command` 和 `completion_criteria` 合併到 QualityConfig。

`checkQualityWarnings()` 同時檢查 `test_levels`（現在只檢查 `verify_command`）。

### B5. `packages/core/src/plan-validator.ts` — 內嵌 Schema 同步

L15-67 的內嵌 schema 需同步：
- defaults 加入 `test_levels`
- task items 加入 `test_levels`、`acceptance_criteria`、`user_intent`
- 頂層加入 `test_policy`

### B6. 新增 `specs/test-policy-schema.json`

獨立的 Test Policy JSON Schema，可被 UDS CLI 等外部工具使用。

### B7. 測試檔案更新

| 檔案 | 新增測試 |
|------|---------|
| `quality-gate.test.ts` | system level、static_analysis 步驟、completion_criteria 檢查（required/optional） |
| `quality-profile.test.ts` | test_policy 合併邏輯 |
| `plan-validator.test.ts` | system level 合法性、test_policy schema |
| `e2e.test.ts` | 含 test_policy 的完整 plan 執行 |

---

## Part C: 銜接對照表

| UDS 概念 | 標準來源 | devap 對應 |
|---------|---------|-----------|
| Test Plan 測試層級 | ISO 29119-3 | `TaskPlan.defaults.test_levels` |
| Test Plan 靜態分析 | DevOps Practice | `TestPolicy.static_analysis_command` |
| Test Completion Criteria | ISO 29119-2 | `TestPolicy.completion_criteria` → `QualityConfig.completion_criteria` |
| Definition of Done | Agile/Scrum | 同上（兩種語境共用同一欄位） |
| Test Case 驗證指令 | ISO 29119-3 | `Task.verify_command` 或 `test_levels[].command` |
| 金字塔推薦比例 | Mike Cohn (empirical) | `TestPolicy.pyramid_ratio` |
| Quality Profile | devap 原創 | `TaskPlan.quality` (strict/standard/minimal/none) |
| Judge 審查 | devap 原創 | `QualityConfig.judge_policy` |
| SIT 環境管理 | ISO 12207 Verification | `test-governance.ai.yaml` 環境定義 |

---

## 實作順序

| Phase | 內容 | 檔案數 |
|-------|------|--------|
| 1 | 核心型別 + Schema（向後相容） | 修改 3 + 新增 1 |
| 2 | 品質門檻擴充（quality-gate + quality-profile） | 修改 2 |
| 3 | UDS 標準修正 + 新增 | 修改 1 + 新增 12 |
| 4 | 測試更新 | 修改 4 |

## Roadmap：devap 在 Autonomous QA 架構中的定位

devap + UDS 已覆蓋 AI QA 自動化架構的完整鏈路：

| AI QA 角色 | 對應實現 | 狀態 |
|-----------|---------|------|
| AI Test Planner | UDS test-governance | 本 spec 新增 |
| AI Test Generator | AI Agent（Claude/OpenCode）| 已有 adapter |
| CI/CD Test Execution | devap orchestrator + quality-gate | 已實作 |
| AI Failure Analysis | devap judge | 已實作 |
| Self-Healing Test | devap fix-loop | 已實作（程式碼層） |
| Quality Report | devap execution-report | 已實作 |

**未來方向**（不在本 spec 範圍）：
- UI/E2E locator self-healing（需整合 Playwright/Cypress）
- Test coverage 自動分析與補齊建議
- Autonomous regression（程式變更自動觸發對應測試更新）

---

## 驗證方式

```bash
pnpm build          # 編譯通過
pnpm test           # 所有測試通過（含新增測試）
pnpm lint           # lint 通過
```

確認向後相容：現有 3 層 test_levels plan 不受影響，無 test_policy 的 plan 行為不變。
