"""
`devap sync-standards` 子命令 — 從 UDS upstream 同步最新標準

模式：
- 預設：執行同步（透過 npx uds init）
- --check：僅檢查版本是否落後（適合 CI），不實際同步
- --force：強制覆蓋本地修改
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Optional
from urllib.error import URLError
from urllib.request import Request, urlopen


@dataclass
class UpstreamInfo:
    """manifest.json 中 upstream 區塊"""

    repo: str
    version: str
    installed: str


@dataclass
class StandardsManifest:
    """manifest.json 的最小結構"""

    version: str
    upstream: UpstreamInfo
    skills_version: Optional[str] = None


@dataclass
class CheckResult:
    """版本檢查結果"""

    current: str
    latest: str
    up_to_date: bool
    repo: str
    installed_at: str
    skills_version: Optional[str] = None
    skills_aligned: Optional[bool] = None


def read_manifest(target_dir: str) -> StandardsManifest:
    """
    讀取目標專案的 .standards/manifest.json

    Args:
        target_dir: 目標專案根目錄

    Returns:
        解析後的 manifest

    Raises:
        FileNotFoundError: manifest 不存在
        ValueError: manifest 格式不正確
    """
    manifest_path = os.path.join(target_dir, ".standards", "manifest.json")

    if not os.path.exists(manifest_path):
        raise FileNotFoundError(
            f"找不到 .standards/manifest.json（路徑：{manifest_path}）\n"
            "請先執行 `uds init` 安裝 UDS 標準。"
        )

    with open(manifest_path, encoding="utf-8") as f:
        data = json.load(f)

    upstream = data.get("upstream", {})
    if not upstream.get("repo") or not upstream.get("version"):
        raise ValueError(
            "manifest.json 缺少 upstream.repo 或 upstream.version 欄位。\n"
            "此 manifest 可能不是由 UDS CLI 產生的。"
        )

    skills_data = data.get("skills", {})

    return StandardsManifest(
        version=data.get("version", ""),
        upstream=UpstreamInfo(
            repo=upstream["repo"],
            version=upstream["version"],
            installed=upstream.get("installed", ""),
        ),
        skills_version=skills_data.get("version") if skills_data else None,
    )


def fetch_latest_version(repo: str) -> str:
    """
    透過 GitHub API 取得 upstream repo 最新版本號

    嘗試順序：
    1. GitHub API releases/latest
    2. 若無 release，嘗試 tags

    Args:
        repo: GitHub repo（如 "AsiaOstrich/universal-dev-standards"）

    Returns:
        最新版本號（不含 v 前綴）
    """
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "devap-cli-python",
    }

    try:
        req = Request(url, headers=headers)
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            tag_name: str = data.get("tag_name", "")
            return tag_name.lstrip("v")
    except URLError as e:
        # 404 = 無 release，嘗試 tags
        if hasattr(e, "code") and getattr(e, "code") == 404:
            return _fetch_latest_tag(repo)
        raise ConnectionError(
            f"無法連線 GitHub API：{e}\n"
            "請確認網路連線。"
        ) from e


def _fetch_latest_tag(repo: str) -> str:
    """從 GitHub tags API 取得最新版本號（fallback）"""
    url = f"https://api.github.com/repos/{repo}/tags?per_page=10"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "devap-cli-python",
    }

    try:
        req = Request(url, headers=headers)
        with urlopen(req, timeout=10) as resp:
            tags = json.loads(resp.read().decode())
    except URLError as e:
        raise ConnectionError(
            f"無法取得 {repo} 的 tags：{e}"
        ) from e

    if not tags:
        raise ValueError(f"{repo} 沒有任何 tag。")

    # 過濾 semver 格式的 tags
    semver_re = re.compile(r"^v?\d+\.\d+\.\d+")
    for tag in tags:
        tag_name: str = tag.get("name", "")
        if semver_re.match(tag_name):
            return tag_name.lstrip("v")

    first_name: str = tags[0].get("name", "")
    return first_name.lstrip("v")


def compare_semver(current: str, latest: str) -> int:
    """
    比較兩個 semver 版本字串

    Returns:
        負數=current 較舊, 0=相同, 正數=current 較新
    """
    def parse(v: str) -> list[int]:
        clean = v.lstrip("v").split("-")[0].split("+")[0]
        parts = clean.split(".")
        return [int(p) for p in parts[:3]] + [0] * (3 - len(parts))

    c = parse(current)
    lat = parse(latest)

    for i in range(3):
        if c[i] != lat[i]:
            return c[i] - lat[i]

    # 主版本相同，有 pre-release 的較舊
    c_pre = "-" in current
    l_pre = "-" in latest
    if c_pre and not l_pre:
        return -1
    if not c_pre and l_pre:
        return 1

    return 0


def check_standards_version(target_dir: str) -> CheckResult:
    """
    檢查版本狀態（不執行同步）

    Args:
        target_dir: 目標專案路徑

    Returns:
        版本檢查結果
    """
    manifest = read_manifest(target_dir)
    latest = fetch_latest_version(manifest.upstream.repo)
    up_to_date = compare_semver(manifest.upstream.version, latest) >= 0

    result = CheckResult(
        current=manifest.upstream.version,
        latest=latest,
        up_to_date=up_to_date,
        repo=manifest.upstream.repo,
        installed_at=manifest.upstream.installed,
    )

    if manifest.skills_version:
        result.skills_version = manifest.skills_version
        result.skills_aligned = manifest.skills_version == manifest.upstream.version

    return result


def execute_uds_sync(target_dir: str, *, force: bool = False) -> None:
    """
    執行 UDS 同步（透過 npx uds init）

    Args:
        target_dir: 目標專案路徑
        force: 強制覆蓋

    Raises:
        RuntimeError: 同步失敗
    """
    force_flag = " --force" if force else ""
    cmd = f"npx --yes uds init{force_flag}"

    print(f"\n🔄 執行：{cmd}")
    print(f"📁 目標：{target_dir}\n")

    try:
        subprocess.run(
            cmd,
            shell=True,
            cwd=target_dir,
            check=True,
            timeout=120,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(
            "UDS 同步失敗。請手動執行 `npx uds init` 查看錯誤細節。"
        ) from e


def execute_sync_standards(
    *,
    check: bool = False,
    force: bool = False,
    target: str = ".",
) -> int:
    """
    執行 sync-standards 命令核心邏輯

    Args:
        check: 僅檢查模式（CI 用）
        force: 強制覆蓋
        target: 目標專案路徑

    Returns:
        exit code（0=成功, 1=版本落後或失敗）
    """
    target_dir = os.path.abspath(target)

    # Step 1: 讀取本地 manifest
    manifest = read_manifest(target_dir)
    print(f"📋 本地 UDS 版本：{manifest.upstream.version}")
    print(f"📦 上游 repo：{manifest.upstream.repo}")
    print(f"📅 安裝日期：{manifest.upstream.installed}")

    # Step 2: 取得最新版本
    print("\n🔍 查詢上游最新版本...")
    latest = fetch_latest_version(manifest.upstream.repo)
    print(f"🏷️  上游最新版本：{latest}")

    up_to_date = compare_semver(manifest.upstream.version, latest) >= 0

    # Step 3: Skills 版本對齊檢查
    if manifest.skills_version:
        aligned = manifest.skills_version == manifest.upstream.version
        if aligned:
            print(f"✅ Skills 版本（{manifest.skills_version}）與標準對齊")
        else:
            print(
                f"⚠️  Skills 版本（{manifest.skills_version}）"
                f"與標準版本（{manifest.upstream.version}）不一致",
                file=sys.stderr,
            )

    # Step 4: 版本比對
    if up_to_date:
        print("\n✅ 標準已是最新版本，無需同步。")
        return 0

    print(f"\n⬆️  發現新版本：{manifest.upstream.version} → {latest}")

    # --check 模式
    if check:
        print("\n⚠️  標準版本落後上游（--check 模式，不執行同步）")
        return 1

    # Step 5: 執行同步
    execute_uds_sync(target_dir, force=force)

    # Step 6: 驗證
    updated = read_manifest(target_dir)
    print(f"\n✅ 同步完成！版本：{updated.upstream.version}")
    return 0
