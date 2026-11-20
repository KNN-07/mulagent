"""Entrypoint for the configured RunPod serverless experiment image."""
import base64
import os
from pathlib import Path
import subprocess
import tempfile

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
        result = subprocess.run(job["command"], cwd=root, env={"PATH": os.environ["PATH"], **job["env"]},
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        files = {}
        for name in job["artifacts"]:
            target = inside(root, name)
            for path in target.rglob("*") if target.is_dir() else [target]:
                if path.is_file() and path.resolve().is_relative_to(root):
                    files[str(path.relative_to(root))] = base64.b64encode(path.read_bytes()).decode()
        return {"exitCode":result.returncode, "log":result.stdout.decode(errors="replace"), "files":files}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handle})
