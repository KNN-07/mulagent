from __future__ import annotations

import os
import random
import sys
import types
from io import StringIO
from pathlib import Path
from typing import Any

import mulagent


def test_seed_everything_makes_stdlib_random_reproducible() -> None:
    mulagent.seed_everything(12345)
    seq1 = [random.random() for _ in range(5)]
    assert os.environ["PYTHONHASHSEED"] == "12345"

    mulagent.seed_everything(12345)
    seq2 = [random.random() for _ in range(5)]
    assert seq1 == seq2


def test_wandb_and_mlflow_sink_mirroring_records_urls(monkeypatch: Any, tmp_path: Path) -> None:
    wb_events: list[tuple[str, Any]] = []
    ml_events: list[tuple[str, Any]] = []

    class FakeWandbRun:
        url = "https://wandb.example/proj/runs/abc"
        config: dict[str, Any] = {}

    fake_wandb = types.ModuleType("wandb")
    fake_wandb.init = lambda **kwargs: (wb_events.append(("init", kwargs)), FakeWandbRun())[1]  # type: ignore[attr-defined]
    fake_wandb.log = lambda data, step=None: wb_events.append(("log", (data, step)))  # type: ignore[attr-defined]
    fake_wandb.finish = lambda exit_code=0: wb_events.append(("finish", exit_code))  # type: ignore[attr-defined]
    fake_wandb.save = lambda path: wb_events.append(("save", path))  # type: ignore[attr-defined]

    class FakeMlflowInfo:
        experiment_id = "7"
        run_id = "ml-99"

    class FakeMlflowRun:
        info = FakeMlflowInfo()

    fake_mlflow = types.ModuleType("mlflow")
    fake_mlflow.set_experiment = lambda name: ml_events.append(("experiment", name))  # type: ignore[attr-defined]
    fake_mlflow.start_run = lambda run_name=None: (ml_events.append(("start", run_name)), FakeMlflowRun())[1]  # type: ignore[attr-defined]
    fake_mlflow.get_tracking_uri = lambda: "https://mlflow.example"  # type: ignore[attr-defined]
    fake_mlflow.log_params = lambda params: ml_events.append(("params", params))  # type: ignore[attr-defined]
    fake_mlflow.log_metric = lambda k, v, step=0: ml_events.append(("metric", (k, v, step)))  # type: ignore[attr-defined]
    fake_mlflow.log_artifact = lambda path: ml_events.append(("artifact", path))  # type: ignore[attr-defined]
    fake_mlflow.end_run = lambda status="FINISHED": ml_events.append(("end", status))  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "wandb", fake_wandb)
    monkeypatch.setitem(sys.modules, "mlflow", fake_mlflow)

    posted: list[tuple[str, dict[str, Any]]] = []

    def fake_post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> int:
        posted.append((url, payload))
        return 200

    run = mulagent.init(
        run_id="r-mirror",
        project="wm-plan",
        spec={"horizon": 32},
        sinks=["wandb", "mlflow"],
        ledger_url="http://127.0.0.1:9999",
        fallback_path=tmp_path / "fallback.jsonl",
        retry_delay=0.0,
        http_post=fake_post,
        stdout=StringIO(),
    )
    run.log_metric("success", 0.776, step=4, split="holdout")
    summary = run.finish("finished")

    assert summary["tracker_urls"] == [
        {"sink": "wandb", "url": "https://wandb.example/proj/runs/abc"},
        {"sink": "mlflow", "url": "https://mlflow.example/#/experiments/7/runs/ml-99"},
    ]
    assert ("log", ({"holdout/success": 0.776}, 4)) in wb_events
    assert ("finish", 0) in wb_events
    assert ("metric", ("holdout.success", 0.776, 4)) in ml_events
    assert ("end", "FINISHED") in ml_events

    finish_payload = next(p for u, p in posted if u.endswith("/finish"))
    assert finish_payload["trackerUrls"] == summary["tracker_urls"]
