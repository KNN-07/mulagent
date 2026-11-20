"""Optional W&B and MLflow mirroring adapters (soft-imported, never fatal)."""

from __future__ import annotations

import os
import warnings
from typing import Any


class TrackerSink:
    name: str
    run_url: str | None

    def log_metric(self, name: str, value: float, step: int | None = None, split: str | None = None) -> None:
        raise NotImplementedError

    def log_params(self, params: dict[str, Any]) -> None:
        raise NotImplementedError

    def log_artifact(self, path: str, name: str | None = None, artifact_type: str | None = None) -> None:
        raise NotImplementedError

    def finish(self, status: str, exit_code: int | None = None) -> None:
        raise NotImplementedError


def _metric_key(name: str, split: str | None) -> str:
    return f"{split}/{name}" if split else name


class WandbSink(TrackerSink):
    name = "wandb"

    def __init__(self, *, run_id: str, project: str | None = None, spec: dict[str, Any] | None = None) -> None:
        import wandb  # type: ignore[import-not-found]

        self._wandb = wandb
        kwargs: dict[str, Any] = {"name": run_id, "reinit": True}
        if project:
            kwargs["project"] = project
        if spec:
            kwargs["config"] = spec
        self._run = wandb.init(**kwargs)
        self.run_url = getattr(self._run, "url", None)
        if not self.run_url and hasattr(self._run, "get_url"):
            try:
                self.run_url = self._run.get_url()
            except Exception:
                self.run_url = None

    def log_metric(self, name: str, value: float, step: int | None = None, split: str | None = None) -> None:
        key = _metric_key(name, split)
        if step is not None:
            self._wandb.log({key: value}, step=step)
        else:
            self._wandb.log({key: value})

    def log_params(self, params: dict[str, Any]) -> None:
        config = getattr(self._run, "config", None) or getattr(self._wandb, "config", None)
        if config is not None and hasattr(config, "update"):
            config.update(params, allow_val_change=True)

    def log_artifact(self, path: str, name: str | None = None, artifact_type: str | None = None) -> None:
        if hasattr(self._wandb, "Artifact") and hasattr(self._run, "log_artifact"):
            art = self._wandb.Artifact(name or os.path.basename(path), type=artifact_type or "file")
            if os.path.isdir(path):
                art.add_dir(path)
            else:
                art.add_file(path)
            self._run.log_artifact(art)
        elif hasattr(self._wandb, "save"):
            self._wandb.save(path)

    def finish(self, status: str, exit_code: int | None = None) -> None:
        code = exit_code if exit_code is not None else (0 if status == "finished" else 1)
        self._wandb.finish(exit_code=code)


class MlflowSink(TrackerSink):
    name = "mlflow"

    def __init__(self, *, run_id: str, project: str | None = None, spec: dict[str, Any] | None = None) -> None:
        import mlflow  # type: ignore[import-not-found]

        self._mlflow = mlflow
        if project:
            mlflow.set_experiment(project)
        self._run = mlflow.start_run(run_name=run_id)
        if spec:
            self.log_params(spec)

        self.run_url = None
        info = getattr(self._run, "info", None)
        if info is not None:
            tracking_uri = mlflow.get_tracking_uri() if hasattr(mlflow, "get_tracking_uri") else None
            exp_id = getattr(info, "experiment_id", None)
            ml_run_id = getattr(info, "run_id", None)
            if tracking_uri and exp_id and ml_run_id and str(tracking_uri).startswith(("http://", "https://")):
                self.run_url = f"{str(tracking_uri).rstrip('/')}/#/experiments/{exp_id}/runs/{ml_run_id}"
            elif ml_run_id:
                self.run_url = f"mlflow://runs/{ml_run_id}"

    def log_metric(self, name: str, value: float, step: int | None = None, split: str | None = None) -> None:
        key = f"{split}.{name}" if split else name
        self._mlflow.log_metric(key, float(value), step=step if step is not None else 0)

    def log_params(self, params: dict[str, Any]) -> None:
        flat = {str(k): v for k, v in params.items()}
        self._mlflow.log_params(flat)

    def log_artifact(self, path: str, name: str | None = None, artifact_type: str | None = None) -> None:
        self._mlflow.log_artifact(path)

    def finish(self, status: str, exit_code: int | None = None) -> None:
        ml_status = "FINISHED" if status == "finished" else ("KILLED" if status == "cancelled" else "FAILED")
        self._mlflow.end_run(status=ml_status)


def create_sinks(
    sink_names: list[str] | tuple[str, ...] | None,
    *,
    run_id: str,
    project: str | None = None,
    spec: dict[str, Any] | None = None,
) -> list[TrackerSink]:
    sinks: list[TrackerSink] = []
    for raw in sink_names or []:
        name = raw.strip().lower()
        if not name:
            continue
        try:
            if name == "wandb":
                sinks.append(WandbSink(run_id=run_id, project=project, spec=spec))
            elif name == "mlflow":
                sinks.append(MlflowSink(run_id=run_id, project=project, spec=spec))
            else:
                warnings.warn(f"Unknown mulagent sink '{name}', ignoring.", RuntimeWarning, stacklevel=2)
        except Exception as exc:
            warnings.warn(f"Failed to initialize sink '{name}': {exc}", RuntimeWarning, stacklevel=2)
    return sinks
