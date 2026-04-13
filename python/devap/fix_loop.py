"""
Fix Loop — 自動修復迴圈

驗證失敗時自動注入錯誤回饋重試，含 cost circuit breaker。
借鑑 Superpowers 四階段除錯法與 3-Strike Rule。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Literal, Optional

from devap.models.types import EpistemicActionType, FixLoopAttempt, FixLoopConfig, FixLoopResult


@dataclass
class ExecuteResult:
    """單次執行函式的回傳值"""

    success: bool
    cost_usd: float
    feedback: Optional[str] = None
    epistemic_action: Optional[EpistemicActionType] = None  # None = 預設 "answer"


# 回呼函式類型
ExecuteFn = Callable[[Optional[str], int], Awaitable[ExecuteResult]]
ProgressFn = Callable[[str], None]


async def run_fix_loop(
    config: FixLoopConfig,
    execute: ExecuteFn,
    on_progress: Optional[ProgressFn] = None,
) -> FixLoopResult:
    """
    執行 fix loop

    Args:
        config: Fix Loop 設定
        execute: 執行回呼，接收 (feedback, attempt_number)
        on_progress: 進度回呼

    Returns:
        Fix Loop 執行結果
    """
    attempts: list[FixLoopAttempt] = []
    total_retry_cost = 0.0
    last_feedback: Optional[str] = None
    consecutive_failures = 0
    previous_hypotheses: list[dict[str, str]] = []

    max_attempts = 1 + config.max_retries

    for i in range(1, max_attempts + 1):
        is_retry = i > 1

        if is_retry:
            # 成本熔斷
            if total_retry_cost >= config.max_retry_budget_usd:
                on_progress and on_progress(
                    f"成本熔斷：重試成本 ${total_retry_cost:.2f} 已超過預算 ${config.max_retry_budget_usd:.2f}"
                )
                break

            on_progress and on_progress(
                f"第 {i} 次嘗試（重試 {i - 1}/{config.max_retries}）"
            )

            # 借鑑 Superpowers 四階段除錯法：構建結構化回饋
            last_feedback = build_structured_feedback(
                last_feedback or "",
                consecutive_failures,
                previous_hypotheses,
            )

        result = await execute(last_feedback, i)

        # 認知路由：ask/abstain 不重試（XSPEC-008 Phase 4）
        if result.epistemic_action in ("ask", "abstain"):
            attempt = FixLoopAttempt(
                attempt=i,
                success=False,
                cost_usd=result.cost_usd,
                feedback=result.feedback,
            )
            return FixLoopResult(
                success=False,
                attempts=[*attempts, attempt],
                total_retry_cost_usd=total_retry_cost,
                stop_reason=result.epistemic_action,  # "ask" or "abstain"
            )

        attempt = FixLoopAttempt(
            attempt=i,
            success=result.success,
            cost_usd=result.cost_usd,
            feedback=result.feedback,
        )
        attempts.append(attempt)

        if result.success:
            consecutive_failures = 0
            return FixLoopResult(
                success=True,
                attempts=attempts,
                total_retry_cost_usd=total_retry_cost,
                stop_reason="passed",
            )

        # 失敗時累計重試成本（首次不算）
        if is_retry:
            total_retry_cost += result.cost_usd

        consecutive_failures += 1
        previous_hypotheses.append({
            "hypothesis": f"attempt {i}",
            "result": result.feedback or "未知錯誤",
        })
        last_feedback = result.feedback

    # 判定停止原因
    stop_reason: Literal["budget_exceeded", "max_retries"] = (
        "budget_exceeded"
        if total_retry_cost >= config.max_retry_budget_usd and len(attempts) < max_attempts
        else "max_retries"
    )

    return FixLoopResult(
        success=False,
        attempts=attempts,
        total_retry_cost_usd=total_retry_cost,
        stop_reason=stop_reason,
    )


def build_structured_feedback(
    raw_feedback: str,
    consecutive_failures: int,
    previous_attempts: list[dict[str, str]],
) -> str:
    """
    構建結構化除錯回饋（借鑑 Superpowers 四階段除錯法）

    根據連續失敗次數決定除錯階段：
    - 1 次失敗：Root Cause Investigation
    - 2 次失敗：Pattern Analysis
    - 3+ 次失敗：Architecture Questioning（3-Strike Rule）

    Args:
        raw_feedback: 原始錯誤回饋
        consecutive_failures: 連續失敗次數
        previous_attempts: 先前嘗試記錄

    Returns:
        結構化除錯回饋
    """
    sections = [raw_feedback]

    if consecutive_failures >= 3:
        # 3-Strike Rule
        attempts_log = "\n".join(
            f"- **{a['hypothesis']}**: {a['result'][:200]}"
            for a in previous_attempts
        )
        sections.extend([
            "",
            "---",
            "## ⚠️ 架構問題升級（Superpowers 3-Strike Rule）",
            "",
            "已連續失敗 3 次以上。**停止猜測性修復**，請：",
            "1. 質疑目前的架構設計是否正確",
            "2. 回顧所有先前嘗試，找出共同失敗模式",
            "3. 考慮是否需要重新設計方案而非修補",
            "",
            "### 先前嘗試記錄",
            attempts_log,
            "",
            "Red Flags：如果你想到「quick fix」、「just try」、「should work now」→ 停下來，回到根因分析。",
        ])
    elif consecutive_failures >= 2:
        attempts_log = "\n".join(
            f"- **{a['hypothesis']}**: {a['result'][:200]}"
            for a in previous_attempts
        )
        sections.extend([
            "",
            "---",
            "## 除錯指引：Pattern Analysis（第 2 階段）",
            "",
            "前次修復未解決問題。請：",
            "1. 比對同類成功案例的模式",
            "2. 檢查是否遺漏了某個前置條件",
            "3. 用最小化修改驗證假設",
            "",
            "### 先前嘗試",
            attempts_log,
        ])
    else:
        sections.extend([
            "",
            "---",
            "## 除錯指引：Root Cause Investigation（第 1 階段）",
            "",
            "請先分析根因再修復，不要直接猜測：",
            "1. 仔細閱讀錯誤訊息，定位出錯的精確位置",
            "2. 追蹤變更記錄，找出是哪個修改引入了問題",
            "3. 在元件邊界加診斷觀測，定位故障層",
        ])

    return "\n".join(sections)
