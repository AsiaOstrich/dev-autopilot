"""
devap CLI 入口

支援 `devap run --plan <file> --agent <type>` 指令模式。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from devap.models.types import AgentAdapter


def _create_parser() -> argparse.ArgumentParser:
    """建立 CLI 參數解析器"""
    parser = argparse.ArgumentParser(
        prog="devap",
        description="Agent-agnostic 無人值守開發編排器",
    )
    parser.add_argument(
        "--version",
        action="version",
        version="%(prog)s 0.1.0",
    )

    subparsers = parser.add_subparsers(dest="command", help="子指令")

    # run 指令
    run_parser = subparsers.add_parser("run", help="執行任務計畫")
    run_parser.add_argument(
        "--plan",
        required=True,
        help="任務計畫 JSON 檔案路徑",
    )
    run_parser.add_argument(
        "--agent",
        choices=["claude", "opencode", "codex", "cline", "cursor", "cli"],
        default="cli",
        help="使用的 AI Agent（預設 cli）",
    )
    run_parser.add_argument(
        "--cwd",
        default=".",
        help="工作目錄（預設當前目錄）",
    )
    run_parser.add_argument(
        "--parallel",
        action="store_true",
        help="啟用並行模式",
    )
    run_parser.add_argument(
        "--max-parallel",
        type=int,
        default=None,
        help="最大並行任務數",
    )

    return parser


async def _run_command(args: argparse.Namespace) -> int:
    """執行 run 指令"""
    from devap.models.types import TaskPlan
    from devap.orchestrator import orchestrate

    # 讀取 plan
    try:
        with open(args.plan, encoding="utf-8") as f:
            plan_data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"錯誤：無法讀取計畫檔案 {args.plan}: {e}", file=sys.stderr)
        return 1

    try:
        plan = TaskPlan(**plan_data)
    except Exception as e:
        print(f"錯誤：計畫檔案格式不正確: {e}", file=sys.stderr)
        return 1

    # 建立 adapter
    adapter = _create_adapter(args.agent)

    # 進度回呼
    def on_progress(msg: str) -> None:
        print(f"  {msg}")

    # 執行
    print(f"開始執行計畫：{plan.project}")
    print(f"Agent: {args.agent}")
    print(f"任務數: {len(plan.tasks)}")
    print()

    report = await orchestrate(
        plan,
        adapter,
        args.cwd,
        on_progress=on_progress,
        parallel=args.parallel,
        max_parallel=args.max_parallel,
    )

    # 輸出報告
    print()
    print("=" * 60)
    print("執行報告")
    print("=" * 60)
    print(f"總任務: {report.summary.total_tasks}")
    print(f"成功:   {report.summary.succeeded}")
    print(f"失敗:   {report.summary.failed}")
    print(f"跳過:   {report.summary.skipped}")
    print(f"總成本: ${report.summary.total_cost_usd:.4f}")
    print(f"總耗時: {report.summary.total_duration_ms:.0f}ms")

    return 0 if report.summary.failed == 0 else 1


def _create_adapter(agent_type: str) -> AgentAdapter:
    """建立 Agent Adapter"""
    if agent_type == "cli":
        from devap.adapters.cli_adapter import CliAdapter

        return CliAdapter()

    raise ValueError(f"不支援的 agent 類型: {agent_type}")


def main() -> NoReturn:
    """CLI 主入口"""
    parser = _create_parser()
    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    if args.command == "run":
        exit_code = asyncio.run(_run_command(args))
        sys.exit(exit_code)

    parser.print_help()
    sys.exit(0)


if __name__ == "__main__":
    main()
