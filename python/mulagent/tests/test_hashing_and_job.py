from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from mulagent.hashing import hash_code_tree, hash_data_paths
from mulagent.job import main as job_main, run_job


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True)


def test_hash_code_tree_detects_clean_and_dirty_git_states(tmp_path: Path) -> None:
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test")
    src = tmp_path / "train.py"
    src.write_text("print('v1')\n", encoding="utf-8")
    _git(tmp_path, "add", "train.py")
    _git(tmp_path, "commit", "-m", "init")

    clean_hash = hash_code_tree(tmp_path)
    assert len(clean_hash) == 40
    assert "+dirty-" not in clean_hash

    src.write_text("print('v2')\n", encoding="utf-8")
    dirty_hash = hash_code_tree(tmp_path)
    assert dirty_hash.startswith(clean_hash[:12] + "+dirty-")
    assert dirty_hash != clean_hash

    untracked = tmp_path / "extra.py"
    untracked.write_text("x = 1\n", encoding="utf-8")
    untracked_hash = hash_code_tree(tmp_path)
    assert untracked_hash != dirty_hash


def test_hash_data_paths_is_deterministic_over_files_and_dirs(tmp_path: Path) -> None:
    assert hash_data_paths([]) is None

    data_dir = tmp_path / "dataset"
    data_dir.mkdir()
    (data_dir / "a.txt").write_text("alpha", encoding="utf-8")
    (data_dir / "b.txt").write_text("beta", encoding="utf-8")

    h1 = hash_data_paths([data_dir])
    h2 = hash_data_paths([data_dir])
    assert h1 is not None
    assert h1 == h2

    (data_dir / "b.txt").write_text("gamma", encoding="utf-8")
    h3 = hash_data_paths([data_dir])
    assert h3 != h1


def test_run_job_captures_exit_code_hashes_and_reports_status(tmp_path: Path) -> None:
    data_file = tmp_path / "train.csv"
    data_file.write_text("x,y\n1,2\n", encoding="utf-8")
    (tmp_path / "script.py").write_text("print('hello')\n", encoding="utf-8")

    calls: list[tuple[str, dict[str, Any]]] = []

    def fake_post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> int:
        calls.append((url, payload))
        return 200

    ok_code = run_job(
        [sys.executable, "-c", "import sys; sys.exit(0)"],
        run_id="job-run-1",
        ledger_url="http://127.0.0.1:9999",
        code_dir=tmp_path,
        data_paths=[str(data_file)],
        http_post=fake_post,
    )
    assert ok_code == 0
    assert calls[0][0].endswith("/api/research/runs/job-run-1/status")
    assert calls[0][1]["status"] == "running"
    assert "codeHash" in calls[0][1]
    assert "dataHash" in calls[0][1]
    assert calls[1][0].endswith("/api/research/runs/job-run-1/finish")
    assert calls[1][1]["status"] == "finished"
    assert calls[1][1]["exitCode"] == 0

    calls.clear()
    fail_code = run_job(
        [sys.executable, "-c", "import sys; sys.exit(3)"],
        run_id="job-run-2",
        ledger_url="http://127.0.0.1:9999",
        code_dir=tmp_path,
        http_post=fake_post,
    )
    assert fail_code == 3
    assert calls[1][1]["status"] == "failed"
    assert calls[1][1]["exitCode"] == 3


def test_cli_entrypoint_parses_double_dash_command(tmp_path: Path) -> None:
    code = job_main(["--run-id", "cli-1", "--code-dir", str(tmp_path), "--", sys.executable, "-c", "print('ok')"])
    assert code == 0
