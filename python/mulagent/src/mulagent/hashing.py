"""Code tree and data path hashing helpers."""

from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path
from typing import Iterable


def _run_git(cwd: Path, args: list[str]) -> subprocess.CompletedProcess[bytes] | None:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            check=False,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def hash_code_tree(cwd: str | os.PathLike[str] | None = None) -> str:
    """Compute a deterministic hash from git HEAD + dirty diff + untracked files.

    Falls back to hashing regular files under ``cwd`` when not inside a git worktree.
    """
    root = Path(cwd) if cwd is not None else Path.cwd()
    head_res = _run_git(root, ["rev-parse", "HEAD"])
    if head_res is not None and head_res.returncode == 0:
        commit = head_res.stdout.decode("utf-8", errors="replace").strip()
        diff_res = _run_git(root, ["diff", "HEAD", "--binary"])
        untracked_res = _run_git(root, ["ls-files", "--others", "--exclude-standard", "-z"])

        diff_bytes = diff_res.stdout if diff_res is not None and diff_res.returncode == 0 else b""
        untracked_paths: list[str] = []
        if untracked_res is not None and untracked_res.returncode == 0:
            untracked_paths = sorted(
                p for p in untracked_res.stdout.decode("utf-8", errors="replace").split("\0") if p
            )

        if not diff_bytes and not untracked_paths:
            return commit

        hasher = hashlib.sha256()
        hasher.update(commit.encode("utf-8"))
        hasher.update(b"\0diff\0")
        hasher.update(diff_bytes)
        for rel in untracked_paths:
            hasher.update(b"\0file\0")
            hasher.update(rel.encode("utf-8"))
            hasher.update(b"\0")
            candidate = root / rel
            if candidate.is_file():
                hasher.update(candidate.read_bytes())
        return f"{commit[:12]}+dirty-{hasher.hexdigest()[:12]}"

    # Non-git directory fallback: hash sorted relative paths and file contents.
    hasher = hashlib.sha256()
    if root.exists():
        files = sorted(
            p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts and "__pycache__" not in p.parts
        )
        for path in files:
            rel = path.relative_to(root).as_posix()
            hasher.update(rel.encode("utf-8"))
            hasher.update(b"\0")
            with path.open("rb") as fh:
                while chunk := fh.read(65536):
                    hasher.update(chunk)
            hasher.update(b"\0")
    return f"tree-{hasher.hexdigest()[:16]}"


def hash_data_paths(paths: Iterable[str | os.PathLike[str]]) -> str | None:
    """Compute a deterministic SHA-256 digest over one or more files or directories."""
    normalized = sorted(str(Path(p)) for p in paths if str(p).strip())
    if not normalized:
        return None

    hasher = hashlib.sha256()
    for raw in normalized:
        target = Path(raw)
        hasher.update(raw.encode("utf-8"))
        hasher.update(b"\0")
        if not target.exists():
            hasher.update(b"MISSING\0")
            continue
        if target.is_file():
            _hash_file(hasher, target)
        elif target.is_dir():
            for child in sorted(p for p in target.rglob("*") if p.is_file()):
                rel = child.relative_to(target).as_posix()
                hasher.update(rel.encode("utf-8"))
                hasher.update(b"\0")
                _hash_file(hasher, child)
    return hasher.hexdigest()[:16]


def _hash_file(hasher: "hashlib._Hash", path: Path) -> None:
    with path.open("rb") as fh:
        while chunk := fh.read(65536):
            hasher.update(chunk)
    hasher.update(b"\0")
