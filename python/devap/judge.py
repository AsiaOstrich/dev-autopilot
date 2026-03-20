"""
Judge Agent — AI 審查 AI

在任務完成後啟動獨立的 `claude -p` 子進程進行審查。
Judge 會檢查 task spec、git diff、verify_command 結果，
輸出 APPROVE 或 REJECT + 理由。
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Callable, Literal, Optional

from devap.models.types import JudgePolicy, JudgeReviewStage, Task, TaskResult


# --- Data Models ---

JudgeVerdict = Literal["APPROVE", "REJECT"]
"""Judge 判決結果"""


@dataclass
class CriteriaResult:
    """單條 acceptance criteria 的審查結果"""

    criteria: str
    passed: bool
    reasoning: str


@dataclass
class JudgeResult:
    """Judge 審查結果"""

    verdict: JudgeVerdict
    reasoning: str
    review_stage: Optional[JudgeReviewStage] = None
    session_id: Optional[str] = None
    cost_usd: Optional[float] = None
    criteria_results: Optional[list[CriteriaResult]] = None
    intent_assessment: Optional[str] = None


@dataclass
class JudgeOptions:
    """Judge Agent 選項"""

    cwd: str
    on_progress: Optional[Callable[[str], None]] = None
    max_turns: int = 10
    review_stage: Optional[JudgeReviewStage] = None


# --- Public Functions ---


def should_run_judge(
    policy: JudgePolicy,
    task: Task,
    has_changes: bool,
) -> bool:
    """
    判斷是否需要執行 Judge 審查

    根據 JudgePolicy 和 task 狀態決定：
    - always: 永遠審查
    - on_change: 有 git diff 時才審查（由呼叫者提供 has_changes）
    - never: 永不審查

    Args:
        policy: Judge 策略
        task: 任務定義
        has_changes: 是否有程式碼變更

    Returns:
        是否需要執行 Judge
    """
    # task 層級的 judge: false 明確關閉時，尊重它
    if task.judge is False:
        return False

    if policy == "always":
        return True
    if policy == "on_change":
        return has_changes
    # never 模式下，仍允許 task 層級 judge: true 覆寫
    return task.judge is True


def build_judge_prompt(
    task: Task,
    task_result: TaskResult,
    diff: str,
    verify_result: str,
    review_stage: Optional[JudgeReviewStage] = None,
) -> str:
    """
    構建 Judge prompt

    若 task 含 acceptance_criteria 或 user_intent，注入到 prompt 中，
    要求 Judge 逐條判定 criteria 並評估意圖達成度。

    Args:
        task: 任務定義
        task_result: 任務執行結果
        diff: git diff 輸出
        verify_result: 驗證指令結果
        review_stage: 審查階段

    Returns:
        Judge prompt 文字
    """
    has_criteria = bool(task.acceptance_criteria and len(task.acceptance_criteria) > 0)
    has_intent = bool(task.user_intent)

    # 驗收條件區段
    criteria_section = ""
    if has_criteria:
        items = "\n".join(
            f"{i + 1}. {c}" for i, c in enumerate(task.acceptance_criteria or [])
        )
        criteria_section = f"\n## 驗收條件\n{items}\n"

    # 使用者意圖區段
    intent_section = ""
    if has_intent:
        intent_section = f"\n## 使用者意圖\n{task.user_intent}\n"

    # JSON 格式要求
    intent_field = ',\n  "intent_assessment": "使用者意圖達成度評估"' if has_intent else ""
    if has_criteria:
        json_format = (
            '{\n'
            '  "verdict": "APPROVE" 或 "REJECT",\n'
            '  "reasoning": "你的判決理由",\n'
            '  "criteria_results": [\n'
            '    { "criteria": "驗收條件原文", "passed": true/false, "reasoning": "判定理由" }\n'
            f"  ]{intent_field}\n"
            "}"
        )
    else:
        json_format = (
            '{\n'
            '  "verdict": "APPROVE" 或 "REJECT",\n'
            f'  "reasoning": "你的判決理由"{intent_field}\n'
            "}"
        )

    # 判斷標準
    judging_criteria = [
        "1. 程式碼變更是否符合任務規格的要求？",
        "2. 驗證指令是否通過？",
        "3. 是否有明顯的錯誤或遺漏？",
        "4. 是否有不必要的變更？",
    ]
    if has_criteria:
        judging_criteria.append("5. 每條驗收條件是否都被滿足？請逐條判定。")
    if has_intent:
        n = "6" if has_criteria else "5"
        judging_criteria.append(f"{n}. 實作是否真正解決了使用者的問題（意圖達成度）？")

    # 階段特化指引
    stage_header = "你是一個嚴格的 Code Review Judge。請審查以下任務的執行結果。"
    stage_guidance = ""
    if review_stage == "spec":
        stage_header = "你是一個 Spec Compliance Reviewer。請嚴格比對任務規格與實際實作。"
        stage_guidance = (
            "\n## Spec Compliance 審查重點（借鑑 Superpowers）\n"
            "- **不信任報告，讀實際程式碼**：agent 聲稱完成不代表真正完成\n"
            "- 檢查是否有 **missing**（規格要求但未實作）\n"
            "- 檢查是否有 **extra**（規格未要求但額外實作）\n"
            "- 檢查是否有 **misunderstood**（實作方向與規格不符）\n"
        )
    elif review_stage == "quality":
        stage_header = "你是一個 Code Quality Reviewer。請審查程式碼品質與架構一致性。"
        stage_guidance = (
            "\n## Code Quality 審查重點（借鑑 Superpowers）\n"
            "- 單一職責原則：每個函式/模組是否只做一件事\n"
            "- 介面清晰度：API 是否直觀、命名是否一致\n"
            "- 檔案大小：單檔是否過大（超過 300 行需注意）\n"
            "- 測試覆蓋：關鍵路徑是否有測試\n"
            "- 錯誤處理：邊界條件是否考慮周全\n"
        )

    verify_cmd_section = (
        f"### 驗證指令\n`{task.verify_command}`" if task.verify_command else ""
    )
    verify_result_section = (
        f"## 驗證指令結果\n```\n{verify_result[:5000]}\n```" if verify_result else ""
    )

    return (
        f"{stage_header}\n"
        "\n"
        "## 原始任務規格\n"
        "\n"
        f"### {task.id}: {task.title}\n"
        f"{task.spec}\n"
        "\n"
        f"{verify_cmd_section}\n"
        f"{criteria_section}{intent_section}"
        "## 執行結果摘要\n"
        f"- 狀態: {task_result.status}\n"
        f"- 耗時: {task_result.duration_ms}ms\n"
        f"- 成本: ${task_result.cost_usd or 0}\n"
        "\n"
        "## Git Diff\n"
        "```diff\n"
        f"{diff[:10000]}\n"
        "```\n"
        "\n"
        f"{verify_result_section}\n"
        f"{stage_guidance}"
        "## 你的任務\n"
        "\n"
        "請仔細審查以上資訊，判斷任務是否正確完成。\n"
        "\n"
        "回覆必須是以下 JSON 格式（且只包含此 JSON，不要其他文字）：\n"
        "```json\n"
        f"{json_format}\n"
        "```\n"
        "\n"
        "判斷標準：\n"
        + "\n".join(judging_criteria)
    )


def parse_judge_output(stdout: str) -> JudgeResult:
    """
    解析 Judge 的 claude -p 輸出

    claude -p --output-format json 的 result 欄位包含 Judge 的回覆，
    其中應包含 JSON 格式的判決。

    Args:
        stdout: claude -p 的 stdout 輸出

    Returns:
        Judge 審查結果
    """
    cli_output = json.loads(stdout.strip())
    result_text: str = cli_output.get("result", "")
    session_id: Optional[str] = cli_output.get("session_id")
    cost_usd: Optional[float] = cli_output.get("cost_usd")

    # 嘗試解析 Judge 回傳的 JSON 判決
    verdict_obj = _try_parse_judge_json(result_text)
    if verdict_obj is not None:
        result = JudgeResult(
            verdict="REJECT" if verdict_obj.get("verdict") == "REJECT" else "APPROVE",
            reasoning=str(verdict_obj.get("reasoning", "")),
            session_id=session_id,
            cost_usd=cost_usd,
        )

        # 解析 criteria_results（若存在）
        raw_criteria = verdict_obj.get("criteria_results")
        if isinstance(raw_criteria, list):
            result.criteria_results = [
                CriteriaResult(
                    criteria=cr.get("criteria", "") if isinstance(cr, dict) else "",
                    passed=cr.get("passed", False) if isinstance(cr, dict) else False,
                    reasoning=cr.get("reasoning", "") if isinstance(cr, dict) else "",
                )
                for cr in raw_criteria
            ]

        # 解析 intent_assessment（若存在）
        intent = verdict_obj.get("intent_assessment")
        if isinstance(intent, str):
            result.intent_assessment = intent

        return result

    # 若無法提取 JSON，根據文字判斷
    if "REJECT" in result_text:
        return JudgeResult(
            verdict="REJECT",
            reasoning=result_text,
            session_id=session_id,
            cost_usd=cost_usd,
        )

    return JudgeResult(
        verdict="APPROVE",
        reasoning=result_text or "Judge 未提供明確判決，預設通過",
        session_id=session_id,
        cost_usd=cost_usd,
    )


async def run_judge(
    task: Task,
    task_result: TaskResult,
    options: JudgeOptions,
) -> JudgeResult:
    """
    執行 Judge 審查

    啟動一個獨立的 `claude -p` 子進程，提供：
    - 原始 task spec
    - git diff（已完成的變更）
    - verify_command 結果

    Args:
        task: 已完成的任務
        task_result: 任務執行結果
        options: Judge 選項

    Returns:
        Judge 審查結果
    """
    if options.on_progress:
        options.on_progress(f"[{task.id}] 啟動 Judge 審查")

    try:
        diff = await _get_git_diff(options.cwd)

        verify_result = ""
        if task.verify_command:
            verify_result = await _run_verify_command(task.verify_command, options.cwd)

        prompt = build_judge_prompt(
            task, task_result, diff, verify_result, options.review_stage
        )

        result = await _spawn_judge(prompt, options)

        if options.on_progress:
            options.on_progress(f"[{task.id}] Judge 判決：{result.verdict}")
        return result
    except Exception as e:
        if options.on_progress:
            options.on_progress(f"[{task.id}] Judge 審查失敗：{e}")
        return JudgeResult(
            verdict="APPROVE",
            reasoning=f"Judge 審查過程發生錯誤，預設通過：{e}",
        )


async def run_dual_stage_judge(
    task: Task,
    task_result: TaskResult,
    options: JudgeOptions,
) -> JudgeResult:
    """
    執行雙階段 Judge 審查（借鑑 Superpowers subagent-driven-development）

    1. Spec Compliance — 比對 task spec 與實作產出
    2. Code Quality — 程式碼品質、測試覆蓋、架構一致性

    Spec 通過才進 Quality 階段。任一階段 REJECT 即停止。

    Args:
        task: 已完成的任務
        task_result: 任務執行結果
        options: Judge 選項

    Returns:
        雙階段審查結果（回傳最終階段的 JudgeResult）
    """
    # 階段 1: Spec Compliance
    if options.on_progress:
        options.on_progress(f"[{task.id}] 啟動 Judge 審查（Spec Compliance）")

    spec_options = JudgeOptions(
        cwd=options.cwd,
        on_progress=options.on_progress,
        max_turns=options.max_turns,
        review_stage="spec",
    )
    spec_result = await run_judge(task, task_result, spec_options)
    spec_result.review_stage = "spec"

    if spec_result.verdict == "REJECT":
        if options.on_progress:
            options.on_progress(
                f"[{task.id}] Spec Compliance 審查未通過，跳過 Code Quality"
            )
        return spec_result

    # 階段 2: Code Quality
    if options.on_progress:
        options.on_progress(f"[{task.id}] 啟動 Judge 審查（Code Quality）")

    quality_options = JudgeOptions(
        cwd=options.cwd,
        on_progress=options.on_progress,
        max_turns=options.max_turns,
        review_stage="quality",
    )
    quality_result = await run_judge(task, task_result, quality_options)
    quality_result.review_stage = "quality"

    # 合併成本
    quality_result.cost_usd = (spec_result.cost_usd or 0) + (
        quality_result.cost_usd or 0
    )

    return quality_result


# --- Private Helpers ---


def _try_parse_judge_json(text: str) -> Optional[dict[str, object]]:
    """
    嘗試從文字中解析 Judge JSON 判決

    策略：先嘗試直接 JSON.parse 整段文字，
    再嘗試提取 ```json 區塊，最後嘗試找最外層 { } 配對。
    """
    # 策略 1：直接解析
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "verdict" in parsed:
            return parsed
    except (json.JSONDecodeError, ValueError):
        pass

    # 策略 2：提取 ```json ... ``` 區塊
    match = re.search(r"```json\s*([\s\S]*?)```", text)
    if match:
        try:
            parsed = json.loads(match.group(1).strip())
            if isinstance(parsed, dict) and "verdict" in parsed:
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass

    # 策略 3：找最外層 { } 配對（支援巢狀物件/陣列）
    first_brace = text.find("{")
    if first_brace == -1:
        return None

    depth = 0
    in_string = False
    escape = False
    for i in range(first_brace, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ("{", "["):
            depth += 1
        if ch in ("}", "]"):
            depth -= 1
        if depth == 0:
            try:
                parsed = json.loads(text[first_brace : i + 1])
                if isinstance(parsed, dict) and "verdict" in parsed:
                    return parsed
            except (json.JSONDecodeError, ValueError):
                pass
            return None

    return None


async def _get_git_diff(cwd: str) -> str:
    """取得工作目錄的 git diff"""
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "diff", "HEAD~1",
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        return stdout.decode() or "(無差異)"
    except Exception:
        return "(無法取得 git diff)"


async def _run_verify_command(command: str, cwd: str) -> str:
    """執行驗證指令"""
    try:
        proc = await asyncio.create_subprocess_exec(
            "sh", "-c", command,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        return (
            f"Exit code: {proc.returncode}\n"
            f"Stdout:\n{stdout.decode()}\n"
            f"Stderr:\n{stderr.decode()}"
        )
    except Exception as e:
        return f"Exit code: unknown\nError: {e}"


async def _spawn_judge(prompt: str, options: JudgeOptions) -> JudgeResult:
    """啟動 Judge claude -p 子進程"""
    args = [
        "claude",
        "-p",
        "--output-format", "json",
        "--permission-mode", "default",
        "--max-turns", str(options.max_turns),
    ]

    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=options.cwd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate(input=prompt.encode())

    try:
        return parse_judge_output(stdout.decode())
    except Exception as e:
        raise RuntimeError(f"Judge 輸出解析失敗：{e}") from e
