# SPEC-004: VibeOps Adapter — DevAP ↔ VibeOps 整合規格

## Context

VibeOps 是 AsiaOstrich 的全生命週期軟體工廠（AGPL-3.0），擁有 7+1 Agent Pipeline。DevAP 作為 agent-agnostic 編排引擎，需要定義如何透過 `AgentAdapter` interface 整合 VibeOps。

本 Spec 定義：
1. VibeOps Agent 如何實作 `AgentAdapter` interface
2. VibeOps 7+1 agents 到 DevAP task 的映射規則
3. Session 管理與狀態同步

## 設計

### AgentAdapter 實作

```typescript
import type { AgentAdapter, Task, TaskResult, ExecuteOptions, AgentType } from "@devap/core";

/**
 * VibeOps Adapter — 讓 DevAP 編排 VibeOps 7+1 agents
 *
 * 使用方式：
 *   const adapter = new VibeOpsAdapter({ baseUrl: "http://localhost:3360" });
 *   const result = await adapter.executeTask(task, options);
 *
 * VibeOps 端需要運行 Web API（REST + WebSocket）。
 */
export class VibeOpsAdapter implements AgentAdapter {
  readonly name: AgentType = "vibeops" as AgentType;

  constructor(private config: VibeOpsAdapterConfig) {}

  async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
    // 1. 解析 task.spec 判斷對應的 VibeOps agent
    // 2. 透過 REST API 提交到 VibeOps Pipeline Runner
    // 3. 透過 WebSocket 監聽執行進度
    // 4. 回傳 TaskResult
  }

  async isAvailable(): Promise<boolean> {
    // GET /api/health → 200 = available
  }

  async resumeSession(sessionId: string): Promise<void> {
    // POST /api/pipeline/resume?sessionId=xxx
  }
}

interface VibeOpsAdapterConfig {
  /** VibeOps API 基礎 URL */
  baseUrl: string;
  /** API Token（若啟用認證） */
  apiToken?: string;
  /** 預設 pipeline 選項 */
  pipelineOptions?: {
    skipCheckpoints?: boolean;
    stopAfter?: string;
  };
}
```

### Agent 映射規則

DevAP task 透過 `task.spec` 中的關鍵字或 `task.agent` 欄位判斷對應的 VibeOps agent：

| 觸發條件 | VibeOps Agent | DevAP Task 特徵 |
|----------|---------------|----------------|
| `agent: "vibeops"` + spec 含 "需求" / "PRD" | Planner | 需求分析任務 |
| `agent: "vibeops"` + spec 含 "架構" / "ADR" | Architect | 架構決策任務 |
| `agent: "vibeops"` + spec 含 "規格" / "設計" | Designer | 規格設計任務 |
| `agent: "vibeops"` + spec 含 "UI" / "視覺" | UI/UX | 視覺規格任務 |
| `agent: "vibeops"` + spec 含 "實作" / "開發" | Builder | 實作任務 |
| `agent: "vibeops"` + spec 含 "審查" / "review" | Reviewer | 品質審查任務 |
| `agent: "vibeops"` + spec 含 "部署" / "deploy" | Operator | 部署任務 |
| `agent: "vibeops"` + spec 含 "評估" / "度量" | Evaluator | 評估任務 |
| `agent: "vibeops"` + 完整 pipeline | Pipeline Runner | 完整 pipeline 執行 |

### Session 管理

| DevAP 機制 | VibeOps 對應 | 說明 |
|-----------|-------------|------|
| `task.fork_session` | 新建 Pipeline Run | 每次 fork 啟動新的 pipeline session |
| `ExecuteOptions.sessionId` | Pipeline Run ID | 用於恢復已暫停的 pipeline |
| `resumeSession()` | `POST /api/pipeline/resume` | 恢復 Human Checkpoint 暫停的 pipeline |

### 品質橋接

| DevAP | VibeOps | 橋接方式 |
|-------|---------|----------|
| `QualityGate` | Reviewer Agent | VibeOps Reviewer 結果映射為 QualityGate 結果 |
| `Judge` (APPROVE/REJECT) | Human Checkpoint | VibeOps 的 human checkpoint 結果映射為 Judge 判決 |
| `SafetyHook` | Guardian Agent | Guardian 的安全掃描結果映射為 SafetyHook 攔截 |
| `FixLoop` | Feedback Loop | VibeOps 的 evaluator feedback 映射為 FixLoop 重試 |

## 驗收條件

### AC-004-001: AgentAdapter 實作完整性

```gherkin
Given VibeOpsAdapter 實作了 AgentAdapter interface
When 呼叫 executeTask(task, options)
Then 請求正確路由到 VibeOps 對應 Agent
  And TaskResult 包含 status、cost_usd、duration_ms
  And verification_passed 反映 VibeOps Reviewer 結果
```

### AC-004-002: isAvailable 健康檢查

```gherkin
Given VibeOps 服務運行中
When 呼叫 isAvailable()
Then 回傳 true
When VibeOps 服務未運行
Then 回傳 false
```

### AC-004-003: Agent 映射正確性

```gherkin
Given task.agent 為 "vibeops"
  And task.spec 包含 "實作用戶模型"
When VibeOpsAdapter 解析 task
Then 路由到 VibeOps Builder Agent
  And Builder 收到正確的規格描述
```

### AC-004-004: Session 恢復

```gherkin
Given 先前的 pipeline 在 planner checkpoint 暫停
  And 回傳了 session_id
When 呼叫 resumeSession(session_id)
Then VibeOps pipeline 從暫停點繼續
```

### AC-004-005: 品質橋接

```gherkin
Given DevAP QualityGate 對 VibeOps task 執行品質檢查
When VibeOps Reviewer 回傳 pass
Then DevAP QualityGateResult.passed 為 true
When VibeOps Guardian 偵測到安全問題
Then DevAP SafetyHook 回傳 false（攔截）
```

## 相依性

| 相依項 | 類型 | 說明 |
|--------|------|------|
| `packages/core/src/types.ts` | 內部 | AgentAdapter、Task、TaskResult interface |
| SPEC-003 | 內部 | TestPolicy 橋接 |
| VibeOps SPEC-006 | 外部（vibeops360） | Web API 規格 |
| VibeOps SPEC-034 | 外部（vibeops360） | 跨產品整合策略 |

## 實作優先順序

| 順序 | 任務 | 說明 |
|------|------|------|
| 1 | VibeOpsAdapter 骨架 + isAvailable | 最小可行實作 |
| 2 | executeTask — 單一 Agent 路由 | 先支援 Builder |
| 3 | executeTask — 完整 Pipeline 路由 | 支援完整 pipeline |
| 4 | resumeSession | 恢復暫停的 pipeline |
| 5 | 品質橋接 | QualityGate ↔ Reviewer 映射 |
