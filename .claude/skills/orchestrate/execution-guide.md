# Execution Guide — Agent Tool 呼叫範例

## 基本用法：單一 Task

```
Agent tool:
  description: "Task T-001: 初始化專案結構"
  prompt: "<task.generated_prompt 的完整內容>"
  isolation: "worktree"
```

## 同層並行：多個 Tasks

同一訊息中啟動多個 Agent tool（Claude Code 會自動並行）：

```
Agent tool #1:
  description: "Task T-002: 建立 DB schema"
  prompt: "<T-002 的 generated_prompt>"
  isolation: "worktree"

Agent tool #2:
  description: "Task T-003: 實作 CRUD API"
  prompt: "<T-003 的 generated_prompt>"
  isolation: "worktree"
```

## Worktree Isolation 說明

- `isolation: "worktree"` 會自動建立 git worktree
- Agent 完成後如果沒有任何改動，worktree 會自動清理
- 如果有改動，回傳值會包含 worktree path 和 branch name
- 改動需要由編排者（或使用者）merge 回主分支

## 錯誤處理策略

### Task 失敗

1. 記錄失敗的 task ID 和錯誤訊息
2. 建立 `failed_tasks` Set
3. 後續每層開始前，檢查每個 task 的 `depends_on`：
   - 若任一依賴在 `failed_tasks` 中 → skip 並加入 `failed_tasks`
   - 否則正常執行

### Agent 無回應

- Agent tool 有內建 timeout 機制
- 若 timeout，視為 `failed`，套用上述失敗處理

### Safety Issues

- `safety_issues` 非空時，列出清單
- **必須詢問使用者**是否繼續
- 使用者確認後才開始執行

## Judge 審查流程

當 `task.judge === true` 時：

```
Agent tool:
  description: "Judge: 審查 T-003"
  subagent_type: "general-purpose"
  prompt: |
    你是 Code Reviewer，請審查以下任務的程式碼品質。

    任務：T-003 - 實作 CRUD API
    規格：<task.spec>

    請執行 `git diff main...<worktree-branch>` 查看改動，
    並依照以下標準審查：
    - 功能正確性
    - 安全性（OWASP Top 10）
    - 程式碼品質
    - 測試覆蓋度

    輸出格式：
    - 總體評估：✅ 通過 / ⚠️ 需修改 / ❌ 不通過
    - 問題清單（含嚴重度）
    - 建議改善項目
```

## 報告格式

執行結束後寫入 `execution_report.json`：

```json
{
  "plan_file": "<plan.json 路徑>",
  "started_at": "2026-03-09T10:00:00Z",
  "completed_at": "2026-03-09T10:05:00Z",
  "summary": {
    "total_tasks": 5,
    "succeeded": 4,
    "failed": 0,
    "skipped": 1,
    "total_duration_ms": 300000
  },
  "tasks": [
    {
      "task_id": "T-001",
      "status": "success",
      "duration_ms": 60000,
      "worktree_branch": "autopilot/T-001-abc123"
    }
  ],
  "judge_results": [
    {
      "task_id": "T-003",
      "verdict": "pass",
      "issues": []
    }
  ]
}
```
