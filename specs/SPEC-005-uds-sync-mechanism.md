# SPEC-005: UDS 同步機制 — DevAP 標準版本管理

## Context

DevAP 消費 UDS（Universal Dev Standards）的 35 個標準檔和 39 個 skills，採用 copy-once 模式。
目前缺乏自動化同步機制，導致版本不一致和雙向修改摩擦。

本 Spec 定義短期改善方案（B 路徑）：
1. `devap sync-standards` CLI 指令
2. CI 版本檢查 workflow
3. Skills 版本對齊驗證

## 設計

### CLI 指令：`devap sync-standards`

```
devap sync-standards [options]

Options:
  --check          僅檢查版本是否落後（不同步，適合 CI）
  --force          強制覆蓋本地修改
  --target <dir>   指定目標專案路徑（預設：.）
```

**執行流程：**
1. 讀取 `.standards/manifest.json` 取得 upstream repo 和版本
2. 呼叫 GitHub API 取得 upstream 最新版本（releases → tags fallback）
3. 比較 semver 版本
4. `--check` 模式：僅報告狀態，落後時 exit 1
5. 預設模式：透過 `npx uds init` 執行同步

### CI Workflow：`check-standards.yml`

- 觸發條件：每週排程 + manifest 變更的 PR + 手動觸發
- 檢查項目：標準版本 vs upstream、Skills 版本對齊

### Skills 版本對齊

manifest.json 中 `skills.version` 應與 `upstream.version` 一致。
不一致時發出警告，提示使用者重新安裝 skills。

## 中期演進（npm 包化）

當 UDS 發布為 `@asiaostrich/uds` npm 包後：
- DevAP 改用 `devDependencies` 引入
- 支援 `extends` 機制覆蓋或擴展標準
- `devap sync-standards` 改為 `npm update` 語意

## 決策記錄

- **維持分離 repo**：UDS 有獨立消費者生態，不與 DevAP 合併
- **維持 Apache-2.0**：patent grant 保護，與上下游授權相容
- **copy-once + 版本檢查**：短期最小改動，中期遷移 npm 依賴
