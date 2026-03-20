"""
Safety Hook — 危險操作攔截 + 硬編碼祕密掃描

在任務執行前檢查 task spec 中的危險指令與硬編碼祕密。
"""

from __future__ import annotations

import re
from typing import Callable

from devap.models.types import Task

# Safety Hook 回呼函式類型
SafetyHook = Callable[[Task], bool]

# 危險指令模式
DANGEROUS_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("rm -rf", re.compile(r"\brm\s+-rf\b", re.IGNORECASE)),
    ("DROP DATABASE", re.compile(r"\bDROP\s+DATABASE\b", re.IGNORECASE)),
    ("DROP TABLE", re.compile(r"\bDROP\s+TABLE\b", re.IGNORECASE)),
    ("git push --force", re.compile(r"\bgit\s+push\s+--force\b", re.IGNORECASE)),
    ("git push -f", re.compile(r"\bgit\s+push\s+-f\b", re.IGNORECASE)),
    ("TRUNCATE", re.compile(r"\bTRUNCATE\s+TABLE\b", re.IGNORECASE)),
    ("format C:", re.compile(r"\bformat\s+[A-Z]:", re.IGNORECASE)),
    ("shutdown", re.compile(r"\bshutdown\s+(-[hrnP]|/[srtp])\b", re.IGNORECASE)),
    ("mkfs", re.compile(r"\bmkfs\b", re.IGNORECASE)),
    ("dd if=", re.compile(r"\bdd\s+if=", re.IGNORECASE)),
]

# 硬編碼祕密模式
SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("AWS Access Key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Generic Secret", re.compile(r"(?i)(password|secret|token|api_?key)\s*[:=]\s*['\"][^'\"]{8,}")),
    ("Private Key", re.compile(r"-----BEGIN\s+(RSA|EC|DSA|OPENSSH)?\s*PRIVATE KEY-----")),
]


def detect_dangerous_command(text: str) -> list[str]:
    """
    偵測文字中的危險指令

    Args:
        text: 要檢查的文字（通常是 task spec）

    Returns:
        偵測到的危險指令列表
    """
    detected: list[str] = []
    for name, pattern in DANGEROUS_PATTERNS:
        if pattern.search(text):
            detected.append(name)
    return detected


def detect_hardcoded_secrets(text: str) -> list[str]:
    """
    偵測文字中的硬編碼祕密

    Args:
        text: 要檢查的文字

    Returns:
        偵測到的祕密類型列表
    """
    detected: list[str] = []
    for name, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            detected.append(name)
    return detected


def create_default_safety_hook() -> SafetyHook:
    """
    建立預設的 Safety Hook

    檢查 task spec 中是否包含危險指令或硬編碼祕密。

    Returns:
        Safety Hook 函式
    """

    def hook(task: Task) -> bool:
        text = f"{task.title} {task.spec}"
        if task.verify_command:
            text += f" {task.verify_command}"

        dangers = detect_dangerous_command(text)
        secrets = detect_hardcoded_secrets(text)

        return len(dangers) == 0 and len(secrets) == 0

    return hook
