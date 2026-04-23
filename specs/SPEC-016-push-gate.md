# SPEC-016: Push Gate 整合（Push Gate Integration）

> **狀態**: Implemented
> **建立日期**: 2026-04-23
> **上游規格**: dev-platform [XSPEC-081](../../dev-platform/cross-project/specs/XSPEC-081-uds-push-skill.md) Phase 2
> **相關規格**: SPEC-001（品質強制執行）、SPEC-015（打包框架）

---

## 概述

在 `QualityConfig` 新增 `push_gate` 欄位、在 `ExecutionReport` 新增 `PushReceipt` 介面，並新增 `devap push` CLI 命令，實作 git push 的品質門禁與稽核紀錄。

---

## Requirements

### REQ-001: push_gate 設定欄位（對應 XSPEC-081 AC-1）

DevAP SHALL 在 `QualityConfig` 中支援 `push_gate` 可選欄位，允許使用者宣告 push 前的品質門禁設定。

- `gates`：要執行的 gate 清單（`lint`、`test`、`ac-coverage`、`type-check`、`security-scan`）
- `protected_branches`：受保護分支 pattern 清單（支援 `prefix/*` 萬用字元）
- `auto_pr`：push 後是否提示建立 PR
- `repo_mode`：`team`（預設，顯示 PR 提示）或 `single-owner`（略過 PR 提示）
- `receipt_output`：push receipt 輸出模式（`console`、`file`、`both`）

### REQ-002: PushReceipt 結構（對應 XSPEC-081 AC-2）

DevAP SHALL 定義 `PushReceipt` interface，作為 git push 完成後的結構化稽核紀錄。

- `branch`：推送目標分支
- `commit_sha`：HEAD commit SHA（短版）
- `gates_passed`：已通過的 gate 清單
- `gates_skipped`：是否跳過所有 gates
- `force_push`：是否為 force push
- `timestamp`：推送完成時間（ISO 8601）
- `target_remote`：push 目標的 remote 名稱

### REQ-003: ExecutionReport 整合（對應 XSPEC-081 AC-3）

DevAP SHALL 在 `ExecutionReport` 中新增 `push_receipt?: PushReceipt` 可選欄位，使 push 結果可嵌入標準執行報告。

### REQ-004: devap push 命令（對應 XSPEC-081 AC-4 ~ AC-7）

DevAP SHALL 提供 `devap push` CLI 命令，支援下列選項：

| 選項 | 說明 |
|------|------|
| `--force` | Force push（推送前顯示影響說明） |
| `--target <branch>` | 覆蓋目標分支 |
| `--skip-gates` | 跳過 pre-push quality gates |
| `--no-pr` | 跳過 push 後的 PR 建立提示 |
| `--remote <remote>` | 指定 git remote（預設 `origin`） |

### REQ-005: Protected Branch 偵測（對應 XSPEC-081 AC-5）

DevAP SHALL 在偵測到 push 目標為受保護分支時顯示警告訊息，並支援 CI 模式自動略過互動確認。

### REQ-006: Force Push 護欄（對應 XSPEC-081 AC-6）

DevAP SHALL 在使用 `--force` 時顯示 force push 影響摘要（目標分支、本地超前 commit 數量），並提示使用者謹慎操作。

### REQ-007: Pre-push Quality Gates（對應 XSPEC-081 AC-7）

DevAP SHALL 在執行 `git push` 前依序執行設定的 quality gates；任一 gate 失敗時中止 push 並顯示失敗原因。

### REQ-008: Push History 持久化（對應 XSPEC-081 AC-8）

DevAP SHALL 將每次成功 push 的 `PushReceipt` 以 JSONL 格式追加寫入 `~/.devap/push-history.jsonl`；寫入失敗不影響主流程。

### REQ-009: PR 整合提示（對應 XSPEC-081 AC-9）

DevAP SHALL 在 team 模式下、push 目標非受保護分支時，於 push 完成後顯示 PR 建立提示。

### REQ-010: 型別匯出（對應 XSPEC-081 AC-10）

DevAP SHALL 透過 `@devap/core` 公開匯出 `PushReceipt` 型別，供外部消費者使用。

---

## 實作位置

| 元件 | 路徑 |
|------|------|
| `QualityConfig.push_gate` | `packages/core/src/types.ts` |
| `PushReceipt` interface | `packages/core/src/types.ts` |
| `ExecutionReport.push_receipt` | `packages/core/src/types.ts` |
| `devap push` 命令 | `packages/cli/src/commands/push.ts` |
| CLI 命令註冊 | `packages/cli/src/index.ts` |

---

## 驗證紀錄

所有 REQ 已在 2026-04-23 提交 `feat(core,cli): Add push_gate to QualityConfig and devap push command (XSPEC-081 Phase 2)` 中實作完成。
