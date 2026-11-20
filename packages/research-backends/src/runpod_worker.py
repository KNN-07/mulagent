"""Entrypoint for the configured RunPod serverless experiment image."""
import base64
import os
from pathlib import Path
import subprocess
import tempfile
import time

import runpod


def inside(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Expected a workspace-relative path")
    return path


def handle(request):
    job = request["input"]
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name, data in job["files"].items():
            path = inside(root, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(data, validate=True))
            if name in job.get("executable", []):
                path.chmod(0o700)
        log = bytearray()
        last_update = time.monotonic()
        with subprocess.Popen(job["command"], cwd=root, env={"PATH": os.environ["PATH"], **job["env"]},
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as proc:
            while chunk := proc.stdout.read1(32768):
                log.extend(chunk)
                if len(log) > 2_000_000:
                    proc.kill()
                    raise ValueError("RunPod inline log exceeds 2 MB")
                if time.monotonic() - last_update >= 2:
                    runpod.serverless.progress_update(request, log.decode(errors="replace"))
                    last_update = time.monotonic()
            code = proc.wait()
        files = {}
        total = 0
        for name in job["artifacts"]:
            target = inside(root, name)
            for path in target.rglob("*") if target.is_dir() else [target]:
                if path.is_file() and path.resolve().is_relative_to(root):
                    total += path.stat().st_size
                    if total > 5_000_000:
                        raise ValueError("RunPod inline artifacts exceed 5 MB")
                    files[str(path.relative_to(root))] = base64.b64encode(path.read_bytes()).decode()
        return {"refresh_worker":True, "exitCode":code, "log":log.decode(errors="replace"), "files":files}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handle})
