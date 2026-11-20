"""Core MulAgent Python SDK: init, metric/param/artifact logging, buffering, retries, fallback."""

from __future__ import annotations

import atexit
import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
import warnings
from pathlib import Path
from typing import Any, Callable, Sequence

from .sinks import TrackerSink, create_sinks

HttpSender = Callable[[str, dict[str, Any], dict[str, str], float], int]

_ACTIVE_LOCK = threading.Lock()
_ACTIVE_RUN: MulagentRun | None = None


def _default_http_post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> int:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return int(getattr(resp, "status", 200))


class MulagentRun:
    """Represents an active MulAgent experiment run with buffered HTTP metric posting."""

    def __init__(
        self,
        *,
        run_id: str,
        project: str | None = None,
        spec: dict[str, Any] | None = None,
        ledger_url: str | None = None,
        token: str | None = None,
        sinks: Sequence[str] | None = None,
        fallback_path: str | os.PathLike[str] = "mulagent-metrics.jsonl",
        flush_interval: float = 0.5,
        batch_size: int = 32,
        max_retries: int = 3,
        retry_delay: float = 0.25,
        timeout: float = 5.0,
        http_post: HttpSender | None = None,
        stdout: Any = None,
    ) -> None:
        self.run_id = run_id
        self.project = project
        self.spec = dict(spec) if isinstance(spec, dict) else None
        self.ledger_url = ledger_url.rstrip("/") if ledger_url else None
        self.token = token
        self.fallback_path = Path(fallback_path)
        self.flush_interval = max(0.05, float(flush_interval))
        self.batch_size = max(1, int(batch_size))
        self.max_retries = max(1, int(max_retries))
        self.retry_delay = max(0.0, float(retry_delay))
        self.timeout = max(0.1, float(timeout))
        self._http_post = http_post or _default_http_post
        self._stdout = stdout

        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._buffer: list[dict[str, Any]] = []
        self._closed = False
        self._metrics_logged = 0
        self._metrics_flushed = 0
        self._fallback_written = 0
        self._params: dict[str, Any] = dict(self.spec) if self.spec else {}
        self._artifacts: list[dict[str, Any]] = []

        self._sinks: list[TrackerSink] = create_sinks(
            list(sinks) if sinks is not None else None,
            run_id=self.run_id,
            project=self.project,
            spec=self.spec,
        )
        self.tracker_urls: list[dict[str, str]] = [
            {"sink": sink.name, "url": sink.run_url}
            for sink in self._sinks
            if sink.run_url
        ]

        self._worker = threading.Thread(
            target=self._flush_loop,
            name=f"mulagent-flush-{self.run_id}",
            daemon=True,
        )
        self._worker.start()

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _post_with_retry(self, path: str, payload: dict[str, Any]) -> bool:
        if not self.ledger_url:
            return False
        url = f"{self.ledger_url}{path}"
        headers = self._headers()
        for attempt in range(self.max_retries):
            try:
                status = self._http_post(url, payload, headers, self.timeout)
                if 200 <= status < 300:
                    return True
                if 400 <= status < 500 and status != 429:
                    return False
            except (urllib.error.URLError, OSError, TimeoutError, ValueError):
                pass
            except Exception:
                pass
            if attempt + 1 < self.max_retries and self.retry_delay > 0:
                time.sleep(self.retry_delay * (2**attempt))
        return False

    def _write_fallback(self, records: list[dict[str, Any]]) -> None:
        if not records:
            return
        try:
            self.fallback_path.parent.mkdir(parents=True, exist_ok=True)
            with self.fallback_path.open("a", encoding="utf-8") as fh:
                for rec in records:
                    entry = {"runId": self.run_id, **rec}
                    fh.write(json.dumps(entry) + "\n")
            with self._lock:
                self._fallback_written += len(records)
        except OSError as exc:
            warnings.warn(f"Failed to write mulagent fallback file: {exc}", RuntimeWarning, stacklevel=2)

    def _flush_loop(self) -> None:
        while True:
            batch: list[dict[str, Any]] = []
            with self._lock:
                while not self._buffer and not self._closed:
                    self._cond.wait(timeout=self.flush_interval)
                if self._buffer:
                    batch = self._buffer[: self.batch_size]
                    del self._buffer[: self.batch_size]
                elif self._closed:
                    return

            if batch:
                self._deliver_batch(batch)

    def _deliver_batch(self, batch: list[dict[str, Any]]) -> None:
        ok = self._post_with_retry(
            f"/api/research/runs/{self.run_id}/metrics",
            {"batchId": uuid.uuid4().hex, "metrics": batch},
        )
        if ok:
            with self._lock:
                self._metrics_flushed += len(batch)
        else:
            self._write_fallback(batch)

    def flush(self) -> None:
        """Synchronously flush all currently buffered metrics."""
        while True:
            with self._lock:
                if not self._buffer:
                    return
                batch = self._buffer[: self.batch_size]
                del self._buffer[: self.batch_size]
            self._deliver_batch(batch)

    def log_metric(
        self,
        name: str,
        value: float | int,
        step: int | None = None,
        split: str | None = None,
    ) -> None:
        numeric = float(value)
        print(f"METRIC {name}={value}", file=self._stdout, flush=True)

        record: dict[str, Any] = {"name": str(name), "value": numeric}
        if step is not None:
            record["step"] = int(step)
        if split is not None:
            record["split"] = str(split)

        with self._lock:
            self._metrics_logged += 1
            self._buffer.append(record)
            if len(self._buffer) >= self.batch_size:
                self._cond.notify_all()

        for sink in self._sinks:
            try:
                sink.log_metric(str(name), numeric, step=step, split=split)
            except Exception as exc:
                warnings.warn(f"Sink '{sink.name}' log_metric failed: {exc}", RuntimeWarning, stacklevel=2)

    def log_params(self, params: dict[str, Any]) -> None:
        if not params:
            return
        with self._lock:
            self._params.update(params)

        self._post_with_retry(
            f"/api/research/runs/{self.run_id}/params",
            {"params": params},
        )
        for sink in self._sinks:
            try:
                sink.log_params(params)
            except Exception as exc:
                warnings.warn(f"Sink '{sink.name}' log_params failed: {exc}", RuntimeWarning, stacklevel=2)

    def log_artifact(
        self,
        path: str | os.PathLike[str],
        name: str | None = None,
        artifact_type: str | None = None,
    ) -> None:
        target = Path(path)
        meta: dict[str, Any] = {
            "path": str(target),
            "name": name or target.name,
            "type": artifact_type or "file",
        }
        if target.is_file():
            meta["sizeBytes"] = target.stat().st_size
            hasher = hashlib.sha256()
            with target.open("rb") as fh:
                while chunk := fh.read(65536):
                    hasher.update(chunk)
            meta["sha256"] = hasher.hexdigest()

        with self._lock:
            self._artifacts.append(meta)

        self._post_with_retry(
            f"/api/research/runs/{self.run_id}/artifacts",
            {"artifact": meta},
        )
        for sink in self._sinks:
            try:
                sink.log_artifact(str(target), name=name, artifact_type=artifact_type)
            except Exception as exc:
                warnings.warn(f"Sink '{sink.name}' log_artifact failed: {exc}", RuntimeWarning, stacklevel=2)

    def finish(
        self,
        status: str = "finished",
        *,
        exit_code: int | None = None,
        code_hash: str | None = None,
        data_hash: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            already_closed = self._closed
            self._closed = True
            self._cond.notify_all()

        if not already_closed and self._worker.is_alive():
            self._worker.join(timeout=max(2.0, self.timeout))
        self.flush()

        for sink in self._sinks:
            try:
                sink.finish(status, exit_code=exit_code)
            except Exception as exc:
                warnings.warn(f"Sink '{sink.name}' finish failed: {exc}", RuntimeWarning, stacklevel=2)

        payload: dict[str, Any] = {
            "status": status,
            "trackerUrls": self.tracker_urls,
        }
        if exit_code is not None:
            payload["exitCode"] = int(exit_code)
        if code_hash is not None:
            payload["codeHash"] = code_hash
        if data_hash is not None:
            payload["dataHash"] = data_hash
        if error is not None:
            payload["error"] = error

        self._post_with_retry(f"/api/research/runs/{self.run_id}/finish", payload)

        with _ACTIVE_LOCK:
            global _ACTIVE_RUN
            if _ACTIVE_RUN is self:
                _ACTIVE_RUN = None

        return {
            "run_id": self.run_id,
            "status": status,
            "metrics_logged": self._metrics_logged,
            "metrics_flushed": self._metrics_flushed,
            "fallback_written": self._fallback_written,
            "tracker_urls": list(self.tracker_urls),
        }

    def __enter__(self) -> "MulagentRun":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if exc is not None:
            self.finish("failed", exit_code=1, error=str(exc))
        else:
            self.finish("finished", exit_code=0)


def init(
    run_id: str | None = None,
    project: str | None = None,
    spec: dict[str, Any] | None = None,
    *,
    sinks: Sequence[str] | None = None,
    ledger_url: str | None = None,
    token: str | None = None,
    fallback_path: str | os.PathLike[str] = "mulagent-metrics.jsonl",
    flush_interval: float = 0.5,
    batch_size: int = 32,
    max_retries: int = 3,
    retry_delay: float = 0.25,
    timeout: float = 5.0,
    http_post: HttpSender | None = None,
    stdout: Any = None,
) -> MulagentRun:
    """Initialize a MulAgent run, reading MULAGENT_* environment variables by default."""
    resolved_run_id = run_id or os.environ.get("MULAGENT_RUN_ID") or f"local-{uuid.uuid4().hex[:12]}"
    resolved_url = ledger_url if ledger_url is not None else os.environ.get("MULAGENT_LEDGER_URL")
    resolved_token = token if token is not None else os.environ.get("MULAGENT_TOKEN")

    if sinks is None:
        env_sinks = os.environ.get("MULAGENT_SINKS", "")
        resolved_sinks = [s.strip() for s in env_sinks.split(",") if s.strip()]
    else:
        resolved_sinks = list(sinks)

    run = MulagentRun(
        run_id=resolved_run_id,
        project=project,
        spec=spec,
        ledger_url=resolved_url,
        token=resolved_token,
        sinks=resolved_sinks,
        fallback_path=fallback_path,
        flush_interval=flush_interval,
        batch_size=batch_size,
        max_retries=max_retries,
        retry_delay=retry_delay,
        timeout=timeout,
        http_post=http_post,
        stdout=stdout,
    )
    with _ACTIVE_LOCK:
        global _ACTIVE_RUN
        _ACTIVE_RUN = run
    return run


def get_run() -> MulagentRun:
    """Return the active run, auto-initializing a local run if init() was not called."""
    with _ACTIVE_LOCK:
        if _ACTIVE_RUN is not None:
            return _ACTIVE_RUN
    return init()


def log_metric(
    name: str,
    value: float | int,
    step: int | None = None,
    split: str | None = None,
) -> None:
    get_run().log_metric(name, value, step=step, split=split)


def log_params(params: dict[str, Any]) -> None:
    get_run().log_params(params)


def log_artifact(
    path: str | os.PathLike[str],
    name: str | None = None,
    artifact_type: str | None = None,
) -> None:
    get_run().log_artifact(path, name=name, artifact_type=artifact_type)


def finish(status: str = "finished", **kwargs: Any) -> dict[str, Any]:
    with _ACTIVE_LOCK:
        run = _ACTIVE_RUN
    if run is None:
        return {"run_id": None, "status": status, "metrics_logged": 0, "metrics_flushed": 0, "fallback_written": 0, "tracker_urls": []}
    return run.finish(status, **kwargs)


@atexit.register
def _flush_on_exit() -> None:
    with _ACTIVE_LOCK:
        run = _ACTIVE_RUN
    if run is not None and not run._closed:
        try:
            run.flush()
        except Exception:
            pass
