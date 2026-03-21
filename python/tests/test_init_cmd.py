"""commands/init_cmd.py 測試"""

import os

import pytest
from devap.commands.init_cmd import execute_init


class TestExecuteInit:
    def test_installs_skills(self, tmp_path: object) -> None:
        """從 monorepo skills 目錄安裝"""
        target = str(tmp_path)

        try:
            installed, skipped = execute_init(target=target)
            # 至少有一些被處理（可能 install 或 skip，取決於 skills 來源是否存在）
            assert installed + skipped > 0
        except FileNotFoundError:
            pytest.skip("skills 來源目錄不存在（可能不在 monorepo 環境）")

    def test_skip_existing(self, tmp_path: object) -> None:
        """已存在的 skills 不應覆蓋"""
        target = str(tmp_path)

        try:
            execute_init(target=target)
            # 第二次應全部 skip
            installed, skipped = execute_init(target=target)
            assert installed == 0
        except FileNotFoundError:
            pytest.skip("skills 來源目錄不存在")

    def test_force_overwrite(self, tmp_path: object) -> None:
        """--force 應強制覆蓋"""
        target = str(tmp_path)

        try:
            execute_init(target=target)
            installed, skipped = execute_init(target=target, force=True)
            assert installed > 0
        except FileNotFoundError:
            pytest.skip("skills 來源目錄不存在")

    def test_creates_target_dir(self, tmp_path: object) -> None:
        """應自動建立 .claude/skills/ 目錄"""
        target = os.path.join(str(tmp_path), "subdir")
        os.makedirs(target)

        try:
            execute_init(target=target)
            assert os.path.isdir(os.path.join(target, ".claude", "skills"))
        except FileNotFoundError:
            pytest.skip("skills 來源目錄不存在")
