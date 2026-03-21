"""worktree_manager.py 測試"""

from unittest.mock import AsyncMock, patch

import pytest
from devap.worktree_manager import WorktreeInfo, WorktreeManager


class TestCreate:
    @pytest.mark.asyncio
    async def test_create_worktree(self) -> None:
        manager = WorktreeManager("/repo")

        with patch.object(manager, "_git", new_callable=AsyncMock) as mock_git, \
             patch.object(manager, "_ensure_git_ignored", new_callable=AsyncMock), \
             patch("os.makedirs"):
            info = await manager.create("T-001")

        assert info.task_id == "T-001"
        assert "T-001" in info.path
        assert info.branch == "autopilot/T-001"
        mock_git.assert_called_once()
        args = mock_git.call_args[0][0]
        assert "worktree" in args
        assert "add" in args

    @pytest.mark.asyncio
    async def test_create_stores_info(self) -> None:
        manager = WorktreeManager("/repo")

        with patch.object(manager, "_git", new_callable=AsyncMock), \
             patch.object(manager, "_ensure_git_ignored", new_callable=AsyncMock), \
             patch("os.makedirs"):
            await manager.create("T-001")

        assert manager.get_worktree("T-001") is not None


class TestMerge:
    @pytest.mark.asyncio
    async def test_merge_calls_no_ff(self) -> None:
        manager = WorktreeManager("/repo")
        manager._worktrees["T-001"] = WorktreeInfo(
            task_id="T-001", path="/repo/.devap/worktrees/T-001", branch="autopilot/T-001"
        )

        with patch.object(manager, "_git", new_callable=AsyncMock) as mock_git:
            await manager.merge("T-001")

        args = mock_git.call_args[0][0]
        assert "merge" in args
        assert "--no-ff" in args
        assert "autopilot/T-001" in args

    @pytest.mark.asyncio
    async def test_merge_unknown_task_raises(self) -> None:
        manager = WorktreeManager("/repo")

        with pytest.raises(ValueError, match="找不到"):
            await manager.merge("T-999")


class TestCleanup:
    @pytest.mark.asyncio
    async def test_cleanup_removes_worktree(self) -> None:
        manager = WorktreeManager("/repo")
        manager._worktrees["T-001"] = WorktreeInfo(
            task_id="T-001", path="/repo/.devap/worktrees/T-001", branch="autopilot/T-001"
        )

        with patch.object(manager, "_git", new_callable=AsyncMock):
            await manager.cleanup("T-001")

        assert manager.get_worktree("T-001") is None

    @pytest.mark.asyncio
    async def test_cleanup_nonexistent_noop(self) -> None:
        manager = WorktreeManager("/repo")
        # Should not raise
        await manager.cleanup("T-999")

    @pytest.mark.asyncio
    async def test_cleanup_handles_remove_failure(self) -> None:
        manager = WorktreeManager("/repo")
        manager._worktrees["T-001"] = WorktreeInfo(
            task_id="T-001", path="/repo/.devap/worktrees/T-001", branch="autopilot/T-001"
        )

        call_count = 0

        async def mock_git(args: list[str]) -> str:
            nonlocal call_count
            call_count += 1
            if "worktree" in args and "remove" in args:
                raise RuntimeError("busy")
            return ""

        with patch.object(manager, "_git", side_effect=mock_git):
            await manager.cleanup("T-001")

        assert manager.get_worktree("T-001") is None


class TestCleanupAll:
    @pytest.mark.asyncio
    async def test_cleanup_all(self) -> None:
        manager = WorktreeManager("/repo")
        manager._worktrees["T-001"] = WorktreeInfo(
            task_id="T-001", path="/p1", branch="autopilot/T-001"
        )
        manager._worktrees["T-002"] = WorktreeInfo(
            task_id="T-002", path="/p2", branch="autopilot/T-002"
        )

        with patch.object(manager, "_git", new_callable=AsyncMock):
            await manager.cleanup_all()

        assert len(manager._worktrees) == 0


class TestGetWorktree:
    def test_existing(self) -> None:
        manager = WorktreeManager("/repo")
        info = WorktreeInfo(task_id="T-001", path="/p1", branch="autopilot/T-001")
        manager._worktrees["T-001"] = info
        assert manager.get_worktree("T-001") is info

    def test_nonexistent(self) -> None:
        manager = WorktreeManager("/repo")
        assert manager.get_worktree("T-999") is None
