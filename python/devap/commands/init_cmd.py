"""
`devap init` 子命令 — 安裝 devap 專有 Skills 到目標專案

將 skills（plan、orchestrate、dev-workflow-guide）
複製到目標專案的 .claude/skills/ 目錄。
"""

from __future__ import annotations

import os
import shutil

# devap 專有 skills 清單
DEVAP_SKILLS = ("plan", "orchestrate", "dev-workflow-guide")


def get_skills_source_dir() -> str:
    """
    取得 skills 來源目錄

    skills 存放在 package 根目錄的 skills/ 目錄中。
    """
    # python/devap/commands/init_cmd.py → python/devap/ → python/ → project root
    package_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    # 嘗試 Python package 內的 skills
    py_skills = os.path.join(package_root, "skills")
    if os.path.isdir(py_skills):
        return py_skills

    # Fallback: 嘗試 monorepo 的 CLI skills
    monorepo_root = os.path.dirname(package_root)
    cli_skills = os.path.join(monorepo_root, "packages", "cli", "skills")
    if os.path.isdir(cli_skills):
        return cli_skills

    raise FileNotFoundError(
        f"Skills 來源目錄不存在。\n"
        f"嘗試路徑：{py_skills}\n"
        f"嘗試路徑：{cli_skills}\n"
        "請確認 devap 套件安裝正確。"
    )


def execute_init(
    *,
    force: bool = False,
    target: str = ".",
) -> tuple[int, int]:
    """
    執行 init 命令核心邏輯

    Args:
        force: 強制覆蓋已存在的 skills
        target: 目標專案路徑

    Returns:
        (installed, skipped) 計數

    Raises:
        FileNotFoundError: skills 來源不存在
    """
    skills_source = get_skills_source_dir()
    target_base = os.path.join(os.path.abspath(target), ".claude", "skills")
    os.makedirs(target_base, exist_ok=True)

    installed = 0
    skipped = 0

    for skill in DEVAP_SKILLS:
        src = os.path.join(skills_source, skill)
        dest = os.path.join(target_base, skill)

        if not os.path.exists(src):
            print(f"⚠️  來源中找不到 {skill}，跳過")
            skipped += 1
            continue

        if os.path.exists(dest) and not force:
            entries = os.listdir(dest)
            if len(entries) > 0:
                print(f"⏭️  {skill} 已存在，跳過（使用 --force 強制覆蓋）")
                skipped += 1
                continue

        # 複製 skill 目錄
        if os.path.exists(dest):
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
        print(f"✅ 已安裝 {skill}")
        installed += 1

    print(f"\n📦 安裝完成：{installed} 個 skills 已安裝，{skipped} 個跳過")
    print(f"📁 目標路徑：{target_base}")

    return installed, skipped
