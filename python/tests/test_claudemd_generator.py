"""claudemd_generator.py 測試"""

import os
import tempfile

import pytest
from devap.claudemd_generator import ClaudeMdOptions, generate_claudemd
from devap.models.types import Task


def _make_task(**kwargs: object) -> Task:
    defaults = {"id": "T-001", "title": "Test Task", "spec": "Build the feature"}
    defaults.update(kwargs)  # type: ignore[arg-type]
    return Task(**defaults)  # type: ignore[arg-type]


class TestBasicGeneration:
    @pytest.mark.asyncio
    async def test_contains_task_id_and_title(self) -> None:
        task = _make_task()
        options = ClaudeMdOptions(project="myproject")
        content = await generate_claudemd(task, options)
        assert "T-001" in content
        assert "Test Task" in content

    @pytest.mark.asyncio
    async def test_contains_spec(self) -> None:
        task = _make_task()
        options = ClaudeMdOptions(project="myproject")
        content = await generate_claudemd(task, options)
        assert "Build the feature" in content

    @pytest.mark.asyncio
    async def test_contains_project_name(self) -> None:
        task = _make_task()
        options = ClaudeMdOptions(project="myproject")
        content = await generate_claudemd(task, options)
        assert "myproject" in content


class TestAcceptanceCriteria:
    @pytest.mark.asyncio
    async def test_with_criteria(self) -> None:
        task = _make_task(acceptance_criteria=["通過測試", "覆蓋率 > 80%"])
        options = ClaudeMdOptions(project="proj")
        content = await generate_claudemd(task, options)
        assert "驗收條件" in content
        assert "通過測試" in content
        assert "覆蓋率 > 80%" in content

    @pytest.mark.asyncio
    async def test_without_criteria(self) -> None:
        task = _make_task()
        options = ClaudeMdOptions(project="proj")
        content = await generate_claudemd(task, options)
        assert "驗收條件" not in content

    @pytest.mark.asyncio
    async def test_empty_criteria(self) -> None:
        task = _make_task(acceptance_criteria=[])
        options = ClaudeMdOptions(project="proj")
        content = await generate_claudemd(task, options)
        assert "驗收條件" not in content


class TestUserIntent:
    @pytest.mark.asyncio
    async def test_with_intent(self) -> None:
        task = _make_task(user_intent="改善登入體驗")
        options = ClaudeMdOptions(project="proj")
        content = await generate_claudemd(task, options)
        assert "使用者意圖" in content
        assert "改善登入體驗" in content

    @pytest.mark.asyncio
    async def test_without_intent(self) -> None:
        task = _make_task()
        options = ClaudeMdOptions(project="proj")
        content = await generate_claudemd(task, options)
        assert "使用者意圖" not in content


class TestVerifyCommand:
    @pytest.mark.asyncio
    async def test_with_verify(self) -> None:
        task = _make_task(verify_command="pnpm test")
        options = ClaudeMdOptions(project="proj")
        content = await generate_claudemd(task, options)
        assert "pnpm test" in content

    @pytest.mark.asyncio
    async def test_without_verify(self) -> None:
        task = _make_task()
        options = ClaudeMdOptions(project="proj")
        content = await generate_claudemd(task, options)
        assert "驗證指令" not in content


class TestExtraConstraints:
    @pytest.mark.asyncio
    async def test_with_constraints(self) -> None:
        task = _make_task()
        options = ClaudeMdOptions(
            project="proj",
            extra_constraints=["不要修改 README", "遵循 ESLint 規則"],
        )
        content = await generate_claudemd(task, options)
        assert "不要修改 README" in content
        assert "遵循 ESLint 規則" in content


class TestExistingClaudemd:
    @pytest.mark.asyncio
    async def test_appends_existing(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("# Original CLAUDE.md\nSome original content")
            tmppath = f.name

        try:
            task = _make_task()
            options = ClaudeMdOptions(project="proj", existing_claudemd_path=tmppath)
            content = await generate_claudemd(task, options)
            assert "專案原始指引" in content
            assert "Some original content" in content
        finally:
            os.unlink(tmppath)

    @pytest.mark.asyncio
    async def test_missing_file_ignored(self) -> None:
        task = _make_task()
        options = ClaudeMdOptions(
            project="proj",
            existing_claudemd_path="/nonexistent/path.md",
        )
        content = await generate_claudemd(task, options)
        assert "專案原始指引" not in content


class TestBackwardCompatibility:
    @pytest.mark.asyncio
    async def test_minimal_task(self) -> None:
        """只有必填欄位的 task 也能正常生成"""
        task = _make_task()
        options = ClaudeMdOptions(project="proj")
        content = await generate_claudemd(task, options)
        assert "T-001" in content
        assert "約束" in content
