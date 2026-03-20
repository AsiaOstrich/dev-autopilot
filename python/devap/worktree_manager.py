"""
Git Worktree 管理器

為並行任務建立/合併/清理 git worktree。
每個 task 在獨立的 worktree 中執行，完成後 merge 回主分支。
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass


@dataclass
class WorktreeInfo:
    """Worktree 資訊"""

    task_id: str
    path: str
    branch: str


class WorktreeManager:
    """
    Git Worktree 管理器

    生命週期：
    1. create() -> 建立 worktree + 分支
    2. （外部執行 task）
    3. merge() -> 合併分支回主分支
    4. cleanup() -> 移除 worktree + 刪除分支
    """

    def __init__(self, root_dir: str) -> None:
        """
        Args:
            root_dir: 專案根目錄（git repo 所在位置）
        """
        self._root_dir = root_dir
        self._worktree_dir = os.path.join(root_dir, ".devap", "worktrees")
        self._worktrees: dict[str, WorktreeInfo] = {}

    async def create(self, task_id: str) -> WorktreeInfo:
        """
        為指定 task 建立 git worktree

        包含安全驗證步驟：
        1. 確保 worktree 目錄存在
        2. 確認目錄在 .gitignore 中
        3. 建立 worktree + 新分支

        Args:
            task_id: Task ID（如 T-001）

        Returns:
            worktree 資訊
        """
        branch = f"autopilot/{task_id}"
        worktree_path = os.path.join(self._worktree_dir, task_id)

        # 確保 worktree 目錄存在
        os.makedirs(self._worktree_dir, exist_ok=True)

        # 安全檢查：確認 worktree 目錄被 .gitignore 忽略
        await self._ensure_git_ignored()

        # 建立 worktree + 新分支
        await self._git(["worktree", "add", worktree_path, "-b", branch])

        info = WorktreeInfo(
            task_id=task_id,
            path=worktree_path,
            branch=branch,
        )
        self._worktrees[task_id] = info
        return info

    async def merge(self, task_id: str) -> None:
        """
        將 task 分支合併回主分支

        Args:
            task_id: Task ID

        Raises:
            ValueError: 若找不到 worktree 記錄
        """
        info = self._worktrees.get(task_id)
        if info is None:
            raise ValueError(f"找不到 Task {task_id} 的 worktree 記錄")

        await self._git([
            "merge", info.branch, "--no-ff",
            "-m", f"merge: {task_id} autopilot task",
        ])

    async def cleanup(self, task_id: str) -> None:
        """
        清理指定 task 的 worktree 和分支

        Args:
            task_id: Task ID
        """
        info = self._worktrees.get(task_id)
        if info is None:
            return

        # 移除 worktree
        try:
            await self._git(["worktree", "remove", info.path, "--force"])
        except RuntimeError:
            try:
                await self._git(["worktree", "prune"])
            except RuntimeError:
                pass

        # 刪除分支
        try:
            await self._git(["branch", "-d", info.branch])
        except RuntimeError:
            try:
                await self._git(["branch", "-D", info.branch])
            except RuntimeError:
                pass

        del self._worktrees[task_id]

    async def cleanup_all(self) -> None:
        """清理所有已建立的 worktree"""
        task_ids = list(self._worktrees.keys())
        for task_id in task_ids:
            await self.cleanup(task_id)

    def get_worktree(self, task_id: str) -> WorktreeInfo | None:
        """
        取得指定 task 的 worktree 資訊

        Args:
            task_id: Task ID

        Returns:
            worktree 資訊，或 None
        """
        return self._worktrees.get(task_id)

    async def _ensure_git_ignored(self) -> None:
        """
        確認 worktree 目錄在 .gitignore 中（借鑑 Superpowers 安全驗證）

        若未被忽略，自動加入 .gitignore。
        """
        try:
            await self._git(["check-ignore", "-q", self._worktree_dir])
            # 指令成功（exit code 0），表示已被忽略
        except RuntimeError:
            # 未被忽略或指令失敗 — 嘗試加入 .gitignore
            gitignore_path = os.path.join(self._root_dir, ".gitignore")
            try:
                content = ""
                if os.path.exists(gitignore_path):
                    with open(gitignore_path, encoding="utf-8") as f:
                        content = f.read()
                if ".devap/worktrees" not in content:
                    with open(gitignore_path, "a", encoding="utf-8") as f:
                        f.write("\n# DevAP worktrees (auto-added)\n.devap/worktrees/\n")
            except OSError:
                pass

    async def _git(self, args: list[str]) -> str:
        """
        執行 git 指令

        Args:
            args: git 子指令參數

        Returns:
            stdout 輸出

        Raises:
            RuntimeError: 指令執行失敗
        """
        proc = await asyncio.create_subprocess_exec(
            "git", *args,
            cwd=self._root_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(
                f"git {' '.join(args)} 失敗 (exit {proc.returncode}): "
                f"{stderr.decode().strip()}"
            )
        return stdout.decode().strip()
