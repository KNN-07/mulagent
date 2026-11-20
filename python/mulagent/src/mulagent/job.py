"""mulagent-job console script: wrap a command, hash code & data, report status."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Sequence

from .hashing import hash_code_tree, hash_data_paths
from .run import HttpSender, MulagentRun, _default_http_post

_METRIC_LINE_RE = re.compile(r"^METRIC\s+([^\s=]+)=([^\s]+)\s*$")


def _post_status(
    *,
    ledger_url: str | None,
    run_id: str,
    token: str | None,
    endpoint: str,
    payload: dict[str, object],
    http_post: HttpSender,
) -> bool:
    if not ledger_url:
        return False
    url = f"{ledger_url.rstrip('/')}{endpoint}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        status = http_post(url, payload, headers, 5.0)
        return 200 <= status < 300
    except Exception:
        return False


def run_job(
    command: Sequence[str],
    *,
    run_id: str | None = None,
    ledger_url: str | None = None,
    token: str | None = None,
    code_dir: str | os.PathLike[str] | None = None,
    data_paths: Sequence[str] = (),
    sinks: Sequence[str] = (),
    parse_stdout_metrics: bool = False,
    fallback_path: str | os.PathLike[str] = "mulagent-metrics.jsonl",
    http_post: HttpSender | None = None,
) -> int:
    if not command:
        raise ValueError("mulagent-job requires a command to execute")

    resolved_run_id = run_id or os.environ.get("MULAGENT_RUN_ID") or "local-job"
    resolved_url = ledger_url if ledger_url is not None else os.environ.get("MULAGENT_LEDGER_URL")
    resolved_token = token if token is not None else os.environ.get("MULAGENT_TOKEN")
    sender = http_post or _default_http_post

    workdir = Path(code_dir) if code_dir is not None else Path.cwd()
    code_hash = hash_code_tree(workdir)
    data_hash = hash_data_paths(data_paths)

    child_env = os.environ.copy()
    child_env["MULAGENT_RUN_ID"] = resolved_run_id
    if resolved_url:
        child_env["MULAGENT_LEDGER_URL"] = resolved_url
    if resolved_token:
        child_env["MULAGENT_TOKEN"] = resolved_token
    if sinks:
        child_env["MULAGENT_SINKS"] = ",".join(sinks)

    start_payload: dict[str, object] = {
        "status": "running",
        "codeHash": code_hash,
    }
    if data_hash is not None:
        start_payload["dataHash"] = data_hash

    _post_status(
        ledger_url=resolved_url,
        run_id=resolved_run_id,
        token=resolved_token,
        endpoint=f"/api/research/runs/{resolved_run_id}/status",
        payload=start_payload,
        http_post=sender,
    )

    sdk_run: MulagentRun | None = None
    if parse_stdout_metrics:
        sdk_run = MulagentRun(
            run_id=resolved_run_id,
            ledger_url=resolved_url,
            token=resolved_token,
            sinks=sinks,
            fallback_path=fallback_path,
            retry_delay=0.05,
            http_post=sender,
        )

    proc = subprocess.Popen(
        list(command),
        cwd=str(workdir),
        env=child_env,
        stdout=subprocess.PIPE if parse_stdout_metrics else None,
        text=parse_stdout_metrics,
    )

    if parse_stdout_metrics and proc.stdout is not None and sdk_run is not None:
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            match = _METRIC_LINE_RE.match(line.strip())
            if match:
                try:
                    val = float(match.group(2))
                    # Forward metric to ledger/sinks without re-printing to stdout.
                    record = {"name": match.group(1), "value": val}
                    with sdk_run._lock:
                        sdk_run._metrics_logged += 1
                        sdk_run._buffer.append(record)
                except ValueError:
                    pass

    exit_code = proc.wait()
    final_status = "finished" if exit_code == 0 else "failed"

    if sdk_run is not None:
        sdk_run.finish(
            final_status,
            exit_code=exit_code,
            code_hash=code_hash,
            data_hash=data_hash,
        )
    else:
        finish_payload: dict[str, object] = {
            "status": final_status,
            "exitCode": exit_code,
            "codeHash": code_hash,
        }
        if data_hash is not None:
            finish_payload["dataHash"] = data_hash
        _post_status(
            ledger_url=resolved_url,
            run_id=resolved_run_id,
            token=resolved_token,
            endpoint=f"/api/research/runs/{resolved_run_id}/finish",
            payload=finish_payload,
            http_post=sender,
        )

    return exit_code


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mulagent-job",
        description="Wrap an experiment command, hash code/data, and report status to MulAgent.",
    )
    parser.add_argument("--run-id", default=None, help="Override MULAGENT_RUN_ID")
    parser.add_argument("--ledger-url", default=None, help="Override MULAGENT_LEDGER_URL")
    parser.add_argument("--token", default=None, help="Override MULAGENT_TOKEN")
    parser.add_argument("--code-dir", default=None, help="Code directory to hash (default: cwd)")
    parser.add_argument("--data", action="append", default=[], help="Data file or directory path to hash")
    parser.add_argument("--sink", action="append", default=[], help="Optional tracker sink (wandb, mlflow)")
    parser.add_argument(
        "--parse-metrics",
        action="store_true",
        help="Parse METRIC name=value lines from child stdout and forward to ledger",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER, help="Command to execute")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    cmd = list(args.command)
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    if not cmd:
        parser.error("a command is required after options (e.g. mulagent-job -- python train.py)")
    return run_job(
        cmd,
        run_id=args.run_id,
        ledger_url=args.ledger_url,
        token=args.token,
        code_dir=args.code_dir,
        data_paths=args.data,
        sinks=args.sink,
        parse_stdout_metrics=args.parse_metrics,
    )


if __name__ == "__main__":
    raise SystemExit(main())
