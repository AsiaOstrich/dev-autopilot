"""
CLAUDE.md 生成器

為每個 sub-agent 生成客製化的 CLAUDE.md，
注入任務規格、約束條件等資訊，引導 agent 專注於指定任務。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from devap.models.types import Task


@dataclass
class ClaudeMdOptions:
    """CLAUDE.md 生成選項"""

    project: str
    extra_constraints: Optional[list[str]] = None
    existing_claudemd_path: Optional[str] = None


async def generate_claudemd(
    task: Task,
    options: ClaudeMdOptions,
) -> str:
    """
    為指定任務生成 CLAUDE.md 內容

    Args:
        task: 任務定義
        options: 生成選項

    Returns:
        生成的 CLAUDE.md 內容
    """
    sections: list[str] = []

    # 標頭
    sections.append(f"# Task: {task.id} - {task.title}")
    sections.append("")

    # 角色說明
    sections.append("## 你的角色")
    sections.append(
        f'你是 devap 編排的 worker agent，負責執行專案 "{options.project}" 中的一個特定任務。'
    )
    sections.append("")

    # 任務規格
    sections.append("## 任務規格")
    sections.append(task.spec)
    sections.append("")

    # 驗收條件（若有）
    if task.acceptance_criteria and len(task.acceptance_criteria) > 0:
        sections.append("## 驗收條件")
        sections.append("完成任務後，你的成果必須滿足以下每一條驗收條件：")
        for i, criteria in enumerate(task.acceptance_criteria):
            sections.append(f"{i + 1}. {criteria}")
        sections.append("")

    # 使用者意圖（若有）
    if task.user_intent:
        sections.append("## 使用者意圖")
        sections.append(f"此任務的目的：{task.user_intent}")
        sections.append("請確保你的實作真正解決了使用者的問題，而不僅是技術上正確。")
        sections.append("")

    # 約束條件
    sections.append("## 約束")
    sections.append("- 只修改與此任務相關的檔案")
    sections.append("- 不要修改其他 task 負責的檔案")
    sections.append("- 完成後確認所有修改都已儲存")

    if task.verify_command:
        sections.append(f"- 完成後執行驗證指令：`{task.verify_command}`")

    if options.extra_constraints:
        for constraint in options.extra_constraints:
            sections.append(f"- {constraint}")

    sections.append("")

    # 附加原始 CLAUDE.md
    if options.existing_claudemd_path:
        try:
            with open(options.existing_claudemd_path, encoding="utf-8") as f:
                existing = f.read()
            sections.append("## 專案原始指引")
            sections.append(existing.strip())
            sections.append("")
        except OSError:
            pass

    return "\n".join(sections)


async def write_claudemd(content: str, target_dir: str) -> None:
    """
    將生成的 CLAUDE.md 寫入指定目錄

    Args:
        content: CLAUDE.md 內容
        target_dir: 目標目錄（通常是 worktree 路徑）
    """
    file_path = os.path.join(target_dir, "CLAUDE.md")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
