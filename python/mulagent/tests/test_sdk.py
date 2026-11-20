from __future__ import annotations

import json
import sys
from io import StringIO
from pathlib import Path
from typing import Any

import mulagent


def test_init_reads_env_vars_and_logs_metrics_with_stdout_and_http(
    monkeypatch: Any, tmp_path: Path
) -> None:
    monkeypatch.setenv("MULAGENT_RUN_ID", "run-env-42")
    monkeypatch.setenv("MULAGENT_LEDGER_URL", "http://127.0.0.1:9999/")
    monkeypatch.setenv("MULAGENT_TOKEN", "secret-tok")

    posted: list[tuple[str, dict[str, Any], dict[str, str]]] = []

    def fake_post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> int:
        posted.append((url, payload, headers))
        return 200

    buf = StringIO()
    run = mulagent.init(
        project="wm-plan",
        spec={"lr": 3e-4},
        fallback_path=tmp_path / "fallback.jsonl",
        retry_delay=0.0,
        http_post=fake_post,
        stdout=buf,
    )
    mulagent.log_params({"batch_size": 64})
    mulagent.log_metric("val_bpb", 0.987, step=10, split="holdout")
    mulagent.log_metric("loss", 1.25)

    artifact = tmp_path / "model.bin"
    artifact.write_bytes(b"weights")
    mulagent.log_artifact(artifact, artifact_type="checkpoint")

    summary = mulagent.finish("finished")

    stdout_lines = buf.getvalue().strip().splitlines()
    assert stdout_lines == ["METRIC val_bpb=0.987", "METRIC loss=1.25"]

    urls = [u for u, _, _ in posted]
    assert "http://127.0.0.1:9999/api/research/runs/run-env-42/params" in urls
    assert "http://127.0.0.1:9999/api/research/runs/run-env-42/metrics" in urls
    assert "http://127.0.0.1:9999/api/research/runs/run-env-42/artifacts" in urls
    assert "http://127.0.0.1:9999/api/research/runs/run-env-42/finish" in urls

    metric_calls = [p for u, p, _ in posted if u.endswith("/metrics")]
    assert len(metric_calls) == 1
    assert len(metric_calls[0].pop("batchId")) == 32
    assert metric_calls == [
        {
            "metrics": [
                {"name": "val_bpb", "value": 0.987, "step": 10, "split": "holdout"},
                {"name": "loss", "value": 1.25},
            ]
        }
    ]
    assert all(h["Authorization"] == "Bearer secret-tok" for _, _, h in posted)
    assert summary["metrics_logged"] == 2
    assert summary["metrics_flushed"] == 2
    assert summary["fallback_written"] == 0
    assert not (tmp_path / "fallback.jsonl").exists()
    assert run.run_id == "run-env-42"


def test_retries_and_falls_back_to_jsonl_when_ledger_unreachable(tmp_path: Path) -> None:
    attempts = 0

    def failing_post(
        url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float
    ) -> int:
        nonlocal attempts
        if url.endswith("/metrics"):
            attempts += 1
        raise OSError("connection refused")

    fallback = tmp_path / "mulagent-metrics.jsonl"
    buf = StringIO()
    run = mulagent.init(
        run_id="r-offline",
        ledger_url="http://127.0.0.1:1",
        fallback_path=fallback,
        max_retries=3,
        retry_delay=0.0,
        http_post=failing_post,
        stdout=buf,
    )
    run.log_metric("acc", 0.776, step=1, split="val")
    summary = run.finish("finished")

    assert attempts == 3
    assert summary["metrics_flushed"] == 0
    assert summary["fallback_written"] == 1
    assert fallback.exists()
    rows = [json.loads(line) for line in fallback.read_text(encoding="utf-8").splitlines()]
    assert rows == [{"runId": "r-offline", "name": "acc", "value": 0.776, "step": 1, "split": "val"}]


def test_retries_succeed_on_transient_failure(tmp_path: Path) -> None:
    calls = 0

    def flaky_post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> int:
        nonlocal calls
        if url.endswith("/metrics"):
            calls += 1
            if calls < 2:
                return 503
        return 200

    fallback = tmp_path / "mulagent-metrics.jsonl"
    buf = StringIO()
    run = mulagent.init(
        run_id="r-flaky",
        ledger_url="http://127.0.0.1:9999",
        fallback_path=fallback,
        max_retries=3,
        retry_delay=0.0,
        http_post=flaky_post,
        stdout=buf,
    )
    run.log_metric("loss", 0.42, step=5)
    summary = run.finish("finished")

    assert calls == 2
    assert summary["metrics_flushed"] == 1
    assert summary["fallback_written"] == 0
    assert not fallback.exists()
