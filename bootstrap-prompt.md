# devap Bootstrap Prompt
# 
# 使用方式：
# 1. clone repo 後，在 repo 根目錄啟動 claude code
# 2. 貼上以下提示詞（或存為 .md 用 @ 引用）
# 
# ===== 以下為提示詞 =====

請先閱讀以下檔案建立完整上下文：
1. `CLAUDE.md`（專案規範）
2. `docs/research/feasibility-and-design.md`（完整研究，特別注意第 5-9 節的設計細節）
3. `specs/task-schema.json`（Task Plan schema）

你現在要接續 Milestone 1: Foundation (POC) 的實作工作。Repo 目前只有研究文件和設定檔，程式碼尚未開始。

## 請依序完成以下任務：

### Phase A：Monorepo 骨架
1. 確認 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json` 正確
2. 建立 `packages/core/`、`packages/adapter-claude/`、`packages/adapter-opencode/`、`packages/cli/` 的 package.json 和 tsconfig.json
3. 確認 `pnpm install` 和 `pnpm build` 能成功執行

### Phase B：核心型別與介面
4. 實作 `packages/core/src/types.ts`（完整型別定義，參考 CLAUDE.md 和研究文件第 6 節）
5. 確保所有型別都有 JSDoc 註解

### Phase C：Task Plan 驗證
6. 實作 `packages/core/src/plan-validator.ts`，使用 `specs/task-schema.json` 驗證 task plan
7. 寫測試確認 valid/invalid plan 都能正確處理

### Phase D：Orchestrator 核心
8. 實作 `packages/core/src/orchestrator.ts`：
   - 載入並驗證 task plan
   - 解析依賴圖（topological sort）
   - 依序執行 task（呼叫 adapter.executeTask）
   - 處理 skip（依賴失敗時）
   - 產出 ExecutionReport
9. 寫測試（用 mock adapter）

### Phase E：Claude Adapter
10. 實作 `packages/adapter-claude/src/claude-adapter.ts`：
    - 呼叫 claude-agent-sdk 的 query()
    - 支援 resume、fork_session、max_turns、max_budget_usd
    - 解析 SDK 回傳的 message stream，提取 session_id、status、cost
11. 實作 `isAvailable()`（檢查 claude CLI 是否存在）

### Phase F：OpenCode Adapter
12. 實作 `packages/adapter-opencode/src/opencode-adapter.ts`：
    - 透過 `@opencode-ai/sdk` 或 HTTP API 呼叫 opencode
    - 支援 session resume、headless mode
13. 實作 `isAvailable()`（檢查 opencode CLI 是否存在）

### Phase G：CLI
14. 實作 `packages/cli/src/index.ts`：
    - `devap run --plan <file> [--agent claude|opencode]`
    - 載入 plan → 建立 adapter → 執行 orchestrator → 輸出報告
15. 加入 `--dry-run` 模式（只驗證 plan + 檢查 adapter 可用性）

### Phase H：Safety Hook
16. 在 orchestrator 中加入 pre-execution hook，攔截危險 bash 命令
17. 危險清單：rm -rf, DROP DATABASE, git push --force, chmod 777, curl|sh

### Phase I：驗證
18. 用 `specs/examples/new-project-plan.json` 跑端到端測試
19. 確認所有測試通過：`pnpm test`

## 規則
- 每完成一個 Phase，先跑測試確認通過再繼續
- 遇到需要安裝的 npm 套件，直接 `pnpm add`
- 如果 claude-agent-sdk 或 @opencode-ai/sdk 的 API 與研究文件描述不同，以實際 npm 套件的 API 為準，並在程式碼中加註差異
- commit message 用 Conventional Commits 格式
