"""Regression tests for the organization showcase sync script."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "sync-org.py"
SPEC = importlib.util.spec_from_file_location("sync_org", SCRIPT)
assert SPEC and SPEC.loader
sync_org = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_org)


class SyncOrgTests(unittest.TestCase):
    def test_fetch_repos_excludes_archived_repositories(self) -> None:
        payload = [
            {"name": "active", "archived": False},
            {"name": "archived", "archived": True},
            {"name": "legacy-default", "archived": False},
        ]
        with patch.object(sync_org, "api_get", return_value=(payload, None)):
            repos = sync_org.fetch_repos("ThanhNguyxnOrg", "token")
        self.assertEqual([repo["name"] for repo in repos], ["active", "legacy-default"])

    def test_clean_protects_markdown_table_cells(self) -> None:
        self.assertEqual(sync_org.clean("alpha | beta\nline two"), "alpha / beta line two")

    def test_top_six_excludes_the_meta_repository(self) -> None:
        repos = [
            {"name": ".github", "stargazers_count": 999},
            {"name": "project-a", "stargazers_count": 10},
            {"name": "project-b", "stargazers_count": 2},
        ]
        rendered = sync_org.render_top6(repos)
        self.assertIn("project-a", rendered)
        self.assertNotIn(".github", rendered)

    def test_marker_update_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "README.md"
            path.write_text("before\n<!-- START -->\nold\n<!-- END -->\nafter\n", encoding="utf-8")
            self.assertTrue(sync_org.update_file(str(path), "<!-- START -->", "<!-- END -->", "new"))
            self.assertFalse(sync_org.update_file(str(path), "<!-- START -->", "<!-- END -->", "new"))
            content = path.read_text(encoding="utf-8")
            self.assertEqual(content, "before\n<!-- START -->\nnew\n<!-- END -->\nafter\n")


if __name__ == "__main__":
    unittest.main()
