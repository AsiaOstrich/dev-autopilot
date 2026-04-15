# SPEC-015: 打包框架編排模組（Packaging Orchestration Module）

> **狀態**: Implemented
> **建立日期**: 2026-04-15
> **上游規格**: dev-platform [XSPEC-034](../../dev-platform/cross-project/specs/XSPEC-034-packaging-framework.md) Phase 2
> **相關規格**: SPEC-006（UDS 同步機制）

---

## 概述

在 `packages/core/src/packaging/` 實作打包編排模組，並新增 `devap package` CLI 命令。使用者透過 `.devap/packaging.yaml` 宣告打包目標，DevAP 負責讀取宣告、載入 Recipe、執行打包步驟。

---

## Requirements

### REQ-001: Recipe 載入（對應 XSPEC-034 REQ-001）

DevAP SHALL 能載入內建 Recipe（UDS 提供）與使用者自訂 Recipe（`.devap/recipes/*.yaml`）。

- 內建 Recipe：從 CLI 隨附的 `recipes/` 目錄載入
- 自訂 Recipe：路徑以 `./` 開頭時，從專案目錄解析
- 缺少必填欄位（`name`、`steps`）時，拋出明確錯誤說明缺少什麼

### REQ-002: Config 解析（對應 XSPEC-034 REQ-004）

DevAP SHALL 合併 Recipe 預設 config 與使用者覆蓋。

- 使用者 `target.config` 優先於 Recipe 預設 `config`
- 合併後的 config 用於替換步驟命令中的 `{key}` 佔位符

### REQ-003: Target 執行（對應 XSPEC-034 REQ-003）

DevAP SHALL 依序執行單一 target 的步驟。

- 執行順序：`hooks.preBuild` → `recipe.steps` → `hooks.postBuild`
- `target.hooks` 優先於 `recipe.hooks`
- dry-run 模式：只印出將執行的命令，不實際執行

### REQ-004: 並行編排（對應 XSPEC-034 REQ-003）

DevAP SHALL 並行執行多個 targets。

- 使用 `Promise.allSettled` 確保任一失敗不影響其他 target
- 支援 `--target` 選項篩選單一 target
- 回傳完整結果陣列（含成功/失敗與耗時）

### REQ-005: CLI 命令（對應 XSPEC-034 REQ-003）

`devap package` 命令 SHALL 提供友善的 CLI 介面。

- 讀取 `.devap/packaging.yaml`（或 `--config` 指定路徑）
- 檔案不存在時顯示友善錯誤訊息
- 輸出每個 target 的結果（✅/❌）
- 有失敗時回傳非零 exit code

---

## Acceptance Criteria

| AC | 說明 | 對應 XSPEC-034 AC | 驗證方式 |
|----|------|-------------------|---------|
| AC-1 | `devap package` 讀取 `.devap/packaging.yaml`，執行每個 target | XSPEC-034 AC-1 | 整合測試 |
| AC-2 | 多 target 並行執行，任一失敗不阻止其他 target | XSPEC-034 AC-2 | 單元測試（packaging-orchestrator.test.ts） |
| AC-3 | `config:` 覆蓋優先於 Recipe 預設值 | XSPEC-034 AC-3 | 單元測試（config-resolver.test.ts） |
| AC-4 | `hooks.preBuild` 在 build steps 前執行 | XSPEC-034 AC-4 | 單元測試（target-executor.test.ts） |
| AC-5 | 自訂 Recipe（`./` 前綴路徑）可正確載入與執行 | XSPEC-034 AC-5 | 單元測試（recipe-loader.test.ts） |
| AC-10 | Recipe 缺少必填欄位時，載入報錯並說明原因 | XSPEC-034 AC-10 | 單元測試（recipe-loader.test.ts） |

---

## 實作結構

```
packages/core/src/packaging/
├── index.ts                    # barrel export
├── types.ts                    # PackagingTarget, Recipe, PackagingConfig, PackagingResult
├── recipe-loader.ts            # loadRecipe()
├── config-resolver.ts          # resolveConfig()
├── target-executor.ts          # executeTarget(), interpolateCommand()
└── packaging-orchestrator.ts   # orchestratePackaging()

packages/core/src/__tests__/packaging/
├── recipe-loader.test.ts       # 8 tests
├── config-resolver.test.ts     # 6 tests
├── target-executor.test.ts     # 11 tests
└── packaging-orchestrator.test.ts  # 7 tests

packages/cli/src/commands/
└── package.ts                  # registerPackageCommand()

packages/cli/recipes/           # UDS 內建 recipes（隨 CLI 打包發布）
├── npm-library.yaml
├── npm-cli.yaml
├── docker-service.yaml
└── windows-installer.yaml
```

---

## 內建 Recipe 路徑解析策略

1. `DEVAP_UDS_RECIPES_DIR` 環境變數（優先，供測試與自訂）
2. CLI `dist/../recipes/`（打包後路徑）

---

## 測試結果

```
Test Files  4 passed (4)
Tests       32 passed (32)
```
