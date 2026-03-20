# Adapter 開發指南

> 本文件說明如何為 DevAP 實作自訂 `AgentAdapter`，讓任意 AI coding agent 接入 DevAP 的 DAG 編排引擎。

## AgentAdapter 介面

### TypeScript

```typescript
interface AgentAdapter {
  readonly name: AgentType;
  executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult>;
  isAvailable(): Promise<boolean>;
  resumeSession?(sessionId: string): Promise<void>;
}
```

### Python

```python
class AgentAdapter(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def execute_task(self, task: Task, options: ExecuteOptions) -> TaskResult: ...

    @abstractmethod
    async def is_available(self) -> bool: ...

    async def resume_session(self, session_id: str) -> None:
        pass  # 可選
```

## 必須實作的方法

### `name`

回傳 adapter 的類型標識符。內建類型有 `"claude"`, `"opencode"`, `"cli"` 等。

自訂 adapter 可使用 type assertion：

```typescript
readonly name: AgentType = "myagent" as AgentType;
```

### `executeTask(task, options)`

核心方法。接收一個 `Task` 和 `ExecuteOptions`，回傳 `TaskResult`。

**輸入**：

| 參數 | 說明 |
|------|------|
| `task.id` | Task ID（T-NNN 格式） |
| `task.title` | 任務標題 |
| `task.spec` | 完整的任務規格（可能包含重試時注入的 feedback） |
| `task.acceptance_criteria` | 驗收條件列表（可選） |
| `task.model_tier` | 建議的模型等級：`"fast"` / `"standard"` / `"capable"` |
| `options.cwd` | 工作目錄 |
| `options.sessionId` | 要接續的 session ID（可選） |
| `options.forkSession` | 是否 fork session 隔離 context |
| `options.modelTier` | 模型等級建議（與 task.model_tier 相同值） |

**輸出 — `TaskResult`**：

| 欄位 | 必填 | 說明 |
|------|------|------|
| `task_id` | 是 | 必須與輸入 task.id 一致 |
| `status` | 是 | 執行狀態（見下方說明） |
| `session_id` | 建議 | Agent session 識別碼 |
| `cost_usd` | 建議 | 消耗成本（用於 cost circuit breaker） |
| `duration_ms` | 否 | 執行耗時（orchestrator 會自動補填） |
| `error` | 否 | 錯誤訊息（status 為 failed 時） |
| `concerns` | 否 | 疑慮清單（status 為 done_with_concerns 時） |
| `needed_context` | 否 | 需要的額外資訊（status 為 needs_context 時） |
| `block_reason` | 否 | 阻塞原因（status 為 blocked 時） |
| `verification_evidence` | 否 | 驗證證據列表 |

### 任務狀態（TaskStatus）

| 狀態 | 意義 | Orchestrator 行為 |
|------|------|------------------|
| `success` | 正常完成 | 繼續後續依賴 |
| `done_with_concerns` | 完成但有疑慮 | 繼續後續依賴（記錄 concerns） |
| `failed` | 執行失敗 | 觸發 fix loop 重試（若有設定） |
| `needs_context` | 需要更多上下文 | 觸發 fix loop 重試（注入結構化回饋） |
| `blocked` | 無法完成 | 觸發 fix loop 重試（建議升級模型或拆分） |
| `skipped` | 依賴失敗跳過 | 由 orchestrator 自動設定，adapter 不需回傳 |
| `timeout` | 逾時 | 視為失敗 |

### `isAvailable()`

檢查 adapter 所需的外部工具是否存在。例如：
- CLI adapter 檢查 `claude` 是否在 PATH 中
- SDK adapter 檢查 API key 是否設定

### `resumeSession(sessionId)` （可選）

恢復先前的 agent session。不實作則忽略 sessionId。

## 模型等級（ModelTier）

Adapter 可透過 `options.modelTier` 或 `task.model_tier` 取得建議的模型等級：

| 等級 | 適用場景 | 建議做法 |
|------|---------|---------|
| `fast` | 單一檔案、明確 spec | 使用 Haiku 或 Sonnet |
| `standard` | 多檔案整合、需要判斷力 | 使用 Sonnet |
| `capable` | 架構設計、審查、除錯 | 使用 Opus |

Adapter **不必**遵循此建議。這是由 plan 作者提供的最佳化提示。

## 範例：最小化 Adapter

```typescript
import type { AgentAdapter, AgentType, ExecuteOptions, Task, TaskResult } from "@devap/core";

export class EchoAdapter implements AgentAdapter {
  readonly name: AgentType = "cli";

  async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
    // 將 task spec 傳給 agent 並取得結果
    return {
      task_id: task.id,
      status: "success",
      session_id: `echo-${Date.now()}`,
      cost_usd: 0,
      duration_ms: 0,
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
```

## 現有 Adapter 參考

| Adapter | 路徑 | 說明 |
|---------|------|------|
| CLI | `packages/adapter-cli/` | 透過 `claude -p` 子進程，零外部依賴 |
| Claude SDK | `packages/adapter-claude/` | 使用 Claude Agent SDK |
| OpenCode | `packages/adapter-opencode/` | 使用 OpenCode SDK |

## 測試指引

每個 adapter 應至少包含以下測試：

1. **isAvailable**：工具存在 → true，不存在 → false
2. **executeTask 成功**：回傳正確的 TaskResult 結構
3. **executeTask 失敗**：錯誤訊息正確記錄
4. **超時處理**：長時間執行時的行為
5. **ModelTier 傳遞**：確認 modelTier 正確傳入

使用 `vitest`（TypeScript）或 `pytest`（Python）。

## 品質整合

當 orchestrator 啟用品質模式時：

1. Adapter 的 `executeTask` 結果會進入 **Quality Gate**（驗證、lint、型別檢查）
2. Quality Gate 失敗會進入 **Fix Loop**，自動注入結構化除錯回饋到 task spec 中重試
3. 通過後進入 **Judge**（雙階段審查：Spec Compliance → Code Quality）

Adapter 只需專注於 `executeTask` 的實作，品質閘門由 orchestrator 透明處理。

## VibeOps 整合

VibeOps 可透過實作 `AgentAdapter` 將其 7+1 agents 接入 DevAP：

```typescript
class VibeOpsAdapter implements AgentAdapter {
  readonly name: AgentType = "vibeops" as AgentType;

  async executeTask(task: Task, options: ExecuteOptions): Promise<TaskResult> {
    // 透過 VibeOps REST API 路由到對應 Agent
    const response = await fetch(`${VIBEOPS_URL}/agents/${task.agent}/execute`, {
      method: "POST",
      body: JSON.stringify({ task, options }),
    });
    return response.json();
  }

  async isAvailable(): Promise<boolean> {
    // 檢查 VibeOps 服務健康狀態
    const res = await fetch(`${VIBEOPS_URL}/health`);
    return res.ok;
  }
}
```

注意：DevAP 維持 MIT 授權，VibeOps 是 AGPL-3.0。透過網路 API 整合維持授權隔離。
