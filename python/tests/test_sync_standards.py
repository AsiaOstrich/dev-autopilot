"""commands/sync_standards.py 測試"""

import json
import os

import pytest
from devap.commands.sync_standards import (
    compare_semver,
    read_manifest,
)


class TestCompareSemver:
    def test_equal(self) -> None:
        assert compare_semver("1.0.0", "1.0.0") == 0

    def test_current_older(self) -> None:
        assert compare_semver("1.0.0", "2.0.0") < 0

    def test_current_newer(self) -> None:
        assert compare_semver("2.0.0", "1.0.0") > 0

    def test_minor_diff(self) -> None:
        assert compare_semver("1.1.0", "1.2.0") < 0

    def test_patch_diff(self) -> None:
        assert compare_semver("1.0.1", "1.0.2") < 0

    def test_v_prefix(self) -> None:
        assert compare_semver("v1.0.0", "1.0.0") == 0

    def test_pre_release_older(self) -> None:
        assert compare_semver("1.0.0-alpha", "1.0.0") < 0

    def test_no_pre_release_newer(self) -> None:
        assert compare_semver("1.0.0", "1.0.0-beta") > 0


class TestReadManifest:
    def test_valid_manifest(self, tmp_path: object) -> None:
        target = str(tmp_path)
        standards_dir = os.path.join(target, ".standards")
        os.makedirs(standards_dir)

        manifest = {
            "version": "5.0.0",
            "upstream": {
                "repo": "AsiaOstrich/universal-dev-standards",
                "version": "5.0.0",
                "installed": "2026-03-15",
            },
            "skills": {"version": "5.0.0", "installed": True},
        }
        with open(os.path.join(standards_dir, "manifest.json"), "w") as f:
            json.dump(manifest, f)

        result = read_manifest(target)
        assert result.upstream.repo == "AsiaOstrich/universal-dev-standards"
        assert result.upstream.version == "5.0.0"
        assert result.skills_version == "5.0.0"

    def test_missing_manifest(self, tmp_path: object) -> None:
        with pytest.raises(FileNotFoundError, match="manifest.json"):
            read_manifest(str(tmp_path))

    def test_invalid_manifest(self, tmp_path: object) -> None:
        target = str(tmp_path)
        standards_dir = os.path.join(target, ".standards")
        os.makedirs(standards_dir)

        with open(os.path.join(standards_dir, "manifest.json"), "w") as f:
            json.dump({"version": "1.0", "upstream": {}}, f)

        with pytest.raises(ValueError, match="upstream"):
            read_manifest(target)
