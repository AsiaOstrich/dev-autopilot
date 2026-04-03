# ATDD 追蹤表：Issue #6 — 並行 Task Worktree 環境配置增強

> Source: GitHub Issue #6
> Ref: XSPEC-002 Section 2.3

## AC ↔ 測試追蹤矩陣

| AC | 驗收條件 | BDD 場景 | TDD 測試 | 狀態 |
|----|---------|----------|---------|------|
| AC-1 | 並行 task 各有獨立 CLAUDE.md | `Scenario: 並行 task 各自有獨立 CLAUDE.md` | `[AC-1] 應將 CLAUDE.md 寫入 worktree 路徑` | ✅ GREEN |
| AC-1 | 2 task 內容不同 | 同上 | `[AC-1] 2 個並行 task 各自有獨立 CLAUDE.md` | ✅ GREEN |
| AC-1 | hooks 配置寫入 | 同上 | `[AC-1] 傳入 hooksConfig 時應寫入 .claude/settings.json` | ✅ GREEN |
| AC-1 | 無 hooks 不寫入 | — | `[AC-1] 無 hooksConfig 時不寫入 settings.json` | ✅ GREEN |
| AC-1 | 錯誤處理 | — | `[AC-1] 對不存在的 worktree 應拋出錯誤` | ✅ GREEN |
| AC-2 | 清理無殘留 | `Scenario: 清理後 worktree 不存在` | `[AC-2] cleanup 後 worktree 記錄被移除` | ✅ GREEN |
| AC-3 | 無 regression | `Scenario: 現有測試無回歸` | 既有 8 個測試 | ✅ GREEN |

## 新增/修改方法

```typescript
// worktree-manager.ts
class WorktreeManager {
  async setupTaskEnvironment(
    taskId: string,
    claudeMdContent: string,
    hooksConfig?: HooksConfig,
  ): Promise<void>;
}
```

## 驗證指令

```bash
cd packages/core && npm test
```
