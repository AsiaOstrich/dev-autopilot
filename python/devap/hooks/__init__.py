"""devap hooks — 安全鉤子"""

from devap.hooks.safety_hook import (
    SafetyHook,
    create_default_safety_hook,
    detect_dangerous_command,
    detect_hardcoded_secrets,
)

__all__ = [
    "SafetyHook",
    "create_default_safety_hook",
    "detect_dangerous_command",
    "detect_hardcoded_secrets",
]
