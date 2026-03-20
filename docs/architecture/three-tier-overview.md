# AsiaOstrich 三層產品架構

## 概覽

AsiaOstrich 產品線以三層架構劃分職責，各層獨立授權、獨立部署，透過明確介面整合。

```
UDS (標準定義) ──→ DevAP (編排執行) ──→ VibeOps (全生命週期)
  MIT + CC BY 4.0     MIT          AGPL-3.0-only
```

## 完整對照表

| 面向 | UDS | DevAP | VibeOps |
|------|-----|-------|---------|
| **定位** | 標準定義層 | 編排執行層 | 全生命週期平台 |
| **回答什麼** | 「怎樣算做好」 | 「怎樣自動做」 | 「整套怎麼跑」 |
| **授權** | MIT + CC BY 4.0 | MIT | AGPL-3.0-only |
| **整合模式** | 被讀取 / 被安裝 | 被呼叫 / 被嵌入 | 呼叫下游 / 編排全流程 |
| **核心產出** | `.ai.yaml` 標準檔 | ExecutionReport、DAG 編排 | 完整軟體交付物 |
| **使用者** | 任何開發專案 | AI Agent 編排情境 | 端到端軟體開發團隊 |

## 各層說明

### UDS — 定規矩

Universal Dev Standards 提供語言無關、工具無關的開發標準。以 `.ai.yaml` 格式定義，涵蓋 commit message、測試策略、程式碼審查、文件結構等 45+ 個標準。

- **授權**：MIT + CC BY 4.0（標準內容可自由使用與再散佈）
- **安裝**：`npx uds install` 將標準寫入專案 `.standards/` 目錄
- **與 DevAP 的關係**：DevAP 讀取 UDS 標準作為品質閘門的依據

### DevAP — 定協定

Agent-agnostic 無人值守開發編排器。將標準轉化為可執行的 DAG 任務編排，搭配品質閘門與自動修復迴圈。

- **授權**：MIT（可商用嵌入）
- **核心能力**：
  - DAG 任務編排（Orchestrator）
  - 品質閘門（Quality Gate）
  - 自動修復迴圈（Fix Loop）
  - 獨立審查（Judge）
  - 安全防護（Safety Hook）
  - 計畫驗證與解析（Plan Validator / Plan Resolver）
  - Git Worktree 隔離執行（Worktree Manager）
  - CLAUDE.md 自動生成（ClaudeMD Generator）
- **與 UDS 的關係**：消費 UDS 標準，透過 `devap sync-standards` 同步
- **與 VibeOps 的關係**：提供 `AgentAdapter` 介面供 VibeOps 呼叫

### VibeOps — 跑起來

全生命週期 AI 軟體開發平台，串接 7+1 agents 完成從需求到部署的完整流程。

- **授權**：AGPL-3.0-only（開源但要求衍生作品同授權）
- **7+1 Agents**：Planner、Architect、Designer、Builder、Reviewer、Operator、Evaluator + Guardian
- **與 DevAP 的關係**：透過 Service Connector 呼叫 DevAP 的編排、品質閘門、修復迴圈能力

## 整合關係圖

```
┌─────────────────────────────────────────────────────────┐
│                    VibeOps (AGPL-3.0)                   │
│  Planner → Architect → Designer → Builder → Reviewer    │
│                    → Operator → Evaluator               │
│  Guardian (跨切面)                                       │
│                                                         │
│  Service Connector ─────────────────────┐               │
└─────────────────────────────────────────┼───────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────┐
│                    DevAP (MIT)                   │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │ Orchestrator │  │ Quality Gate│  │   Fix Loop     │  │
│  │  (DAG 編排)  │  │  (品質閘門)  │  │ (自動修復迴圈) │  │
│  └─────────────┘  └─────────────┘  └────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │    Judge    │  │ Safety Hook │  │ Plan Validator │  │
│  │  (獨立審查)  │  │ (安全防護)   │  │ (計畫驗證)     │  │
│  └─────────────┘  └─────────────┘  └────────────────┘  │
│                                                         │
│  AgentAdapter: claude / cli / opencode                  │
│                                                         │
│  讀取 UDS 標準 ─────────────────────┐                   │
└─────────────────────────────────────┼───────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────┐
│              UDS (MIT + CC BY 4.0)                      │
│                                                         │
│  45+ .ai.yaml 標準                                      │
│  commit-message / testing / code-review / ...           │
│                                                         │
│  npx uds install → .standards/                          │
└─────────────────────────────────────────────────────────┘
```

## DevAP 額外能力清單

除核心編排外，DevAP 提供以下進階能力：

| 能力 | 模組 | 說明 |
|------|------|------|
| 獨立審查 | Judge | 以獨立 Agent 審查 task 結果，APPROVE/REJECT 判定 |
| 安全防護 | Safety Hook | 偵測危險指令（rm -rf、DROP DATABASE 等）+ 硬編碼祕密掃描 |
| Git 隔離執行 | Worktree Manager | 每個 task 在獨立 worktree 中執行，避免互相干擾 |
| CLAUDE.md 生成 | ClaudeMD Generator | 根據專案結構自動產生 AI 指令檔 |
| 品質分層 | Quality Profile | 依 task 類別套用不同品質等級（quick / standard / strict） |
| 計畫解析 | Plan Resolver | 純函式橋接層，整合驗證、分層、安全檢查為單一呼叫 |
| 成本控制 | Cost Circuit Breaker | Fix Loop 中的成本斷路器，防止無限重試 |

## 授權隔離原則

三層產品的授權設計確保：

1. **UDS**（MIT + CC BY 4.0）：最寬鬆，任何專案皆可自由使用
2. **DevAP**（MIT）：可商用嵌入，不受 AGPL 汙染
3. **VibeOps**（AGPL-3.0-only）：開源但要求衍生作品公開原始碼

DevAP 絕不引入 AGPL 依賴，確保下游使用者可自由選擇授權模式。VibeOps 透過 Service Connector（網路呼叫）而非程式庫依賴整合 DevAP，維持授權隔離。
