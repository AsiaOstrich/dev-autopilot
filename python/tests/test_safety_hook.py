"""safety_hook.py 測試"""

from devap.models.types import Task
from devap.hooks.safety_hook import (
    create_default_safety_hook,
    detect_dangerous_command,
    detect_hardcoded_secrets,
)


class TestDetectDangerousCommand:
    def test_rm_rf(self):
        assert "rm -rf" in detect_dangerous_command("rm -rf /")

    def test_drop_database(self):
        assert "DROP DATABASE" in detect_dangerous_command("DROP DATABASE production")

    def test_git_push_force(self):
        assert "git push --force" in detect_dangerous_command("git push --force origin main")

    def test_safe_command(self):
        assert detect_dangerous_command("pnpm test") == []


class TestDetectHardcodedSecrets:
    def test_aws_key(self):
        assert "AWS Access Key" in detect_hardcoded_secrets("AKIAIOSFODNN7EXAMPLE")

    def test_password(self):
        assert "Generic Secret" in detect_hardcoded_secrets('password="supersecret123"')

    def test_no_secrets(self):
        assert detect_hardcoded_secrets("normal code here") == []


class TestDefaultSafetyHook:
    def test_safe_task_allowed(self):
        hook = create_default_safety_hook()
        task = Task(id="T-001", title="Build", spec="pnpm build")
        assert hook(task) is True

    def test_dangerous_task_blocked(self):
        hook = create_default_safety_hook()
        task = Task(id="T-001", title="Clean", spec="rm -rf /")
        assert hook(task) is False

    def test_secret_in_spec_blocked(self):
        hook = create_default_safety_hook()
        task = Task(
            id="T-001",
            title="Config",
            spec='api_key="AKIAIOSFODNN7EXAMPLE"',
        )
        assert hook(task) is False
