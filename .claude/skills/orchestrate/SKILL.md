---
name: orchestrate
version: 1.0.0
description: |
  Orchestrate multi-task execution plans using devap's DAG engine.
  Use when: executing a task plan JSON file with parallel/sequential task dependencies.
  Keywords: orchestrate, plan, execute, DAG, task plan, 編排, 執行計畫.

triggers:
  keywords:
    - orchestrate
    - 編排
    - 執行計畫
    - run plan
  commands:
    - /orchestrate
---

# /orchestrate — devap Claude Code 編排 Skill

## 用法

```
/orchestrate <plan.json> [--dry-run]
```

## 執行流程

### Step 1: 解析計畫

使用 plan-resolver CLI 取得 ResolvedPlan JSON：

```bash
node <project-root>/packages/core/dist/plan-resolver-cli.js <plan-path>
```

將 stdout JSON 解析為 `ResolvedPlan` 物件。

### Step 2: 驗證

檢查 `validation.valid`：
- 若為 `false`，輸出 `validation.errors` 並停止
- 若 `safety_issues` 非空，列出所有安全問題並**詢問使用者是否繼續**

### Step 3: 逐層執行

對 `layers` 陣列中的每一層：

1. **同層並行**：同一層的 tasks 在同一訊息中啟動多個 Agent tool
2. **Agent tool 參數**：
   - `prompt`: 使用 `task.generated_prompt`
   - `isolation: "worktree"`: 實現 git 隔離
   - `description`: `"Task {task.id}: {task.title}"`
3. **等待完成**：等所有同層 agents 完成後，才進入下一層

### Step 4: 依賴失敗處理

如果某個 task 的 agent 回報失敗：
- 標記該 task 為 `failed`
- 後續層中 `depends_on` 包含該 task ID 的所有 tasks 標記為 `skipped`
- 繼續執行不受影響的 tasks

### Step 5: Judge 審查

如果 task 定義了 `judge: true`：
- 啟動一個額外的 Agent tool，使用 reviewer agent prompt
- Prompt 內容：審查該 task 的 git diff，依照 `.claude/skills/agents/reviewer.md` 的審查標準
- 將 judge 結果附加到報告中

### Step 6: 產出報告

彙整所有 task 結果，輸出 `execution_report.json`：

```json
{
  "summary": {
    "total_tasks": 5,
    "succeeded": 3,
    "failed": 1,
    "skipped": 1,
    "total_duration_ms": 120000
  },
  "tasks": [
    { "task_id": "T-001", "status": "success", "duration_ms": 30000 },
    { "task_id": "T-002", "status": "failed", "error": "..." },
    { "task_id": "T-003", "status": "skipped", "error": "依賴任務失敗" }
  ]
}
```

### --dry-run 模式

若使用者指定 `--dry-run`：
- 只執行 Step 1-2（解析與驗證）
- 輸出 ResolvedPlan 的摘要（層數、任務數、安全問題）
- **不啟動任何 Agent tool**

## 重要注意事項

- plan-resolver CLI 必須先 build：`pnpm --filter @devap/core build`
- 每個 Agent tool 的 `isolation: "worktree"` 會自動建立 git worktree
- `max_parallel` 為 `-1` 表示無限制，同層所有 tasks 都可並行
- 使用繁體中文回覆使用者
