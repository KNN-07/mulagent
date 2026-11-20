"""Provider-side resource lifetime is bounded even if the scheduler disconnects."""
import base64
import json
import math
import os
from pathlib import Path
import shlex
import sqlite3
import sys
import tempfile
import urllib.request


def api(endpoint, operation, body=None):
    req = urllib.request.Request(
        f"https://api.runpod.ai/v2/{endpoint}/{operation}",
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {os.environ['RUNPOD_API_KEY']}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def save(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(content)
    os.replace(tmp.name, path)


def submit(root):
    req = json.load(sys.stdin)
    cfg, job = req["config"], req["job"]
    resources = job["resources"]
    with sqlite3.connect(root.parent / "cloud-budget.sqlite") as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE IF NOT EXISTS reservations (job TEXT PRIMARY KEY, backend TEXT NOT NULL, usd REAL NOT NULL)")
        spent, = db.execute("SELECT coalesce(sum(usd),0) FROM reservations WHERE backend=?", (cfg["description"]["id"],)).fetchone()
        if spent + req["maximumCost"] > cfg["spendCapUsd"]:
            raise ValueError("Cloud spend cap exhausted")
        db.execute("INSERT INTO reservations VALUES (?,?,?)", (root.name,cfg["description"]["id"],req["maximumCost"]))
    seconds = math.ceil(resources["hours"] * 3600)
    image = resources.get("image", cfg.get("defaultImage"))
    provider = cfg["cloudProvider"]
    info = {"provider": provider, "files": job["artifacts"] + job.get("metrics", [])}
    if provider == "modal":
        import modal
        volume_name = "mulagent-" + root.name
        vol = modal.Volume.from_name(volume_name, create_if_missing=True)
        with vol.batch_upload() as upload:
            upload.put_directory(root / "work", "/work")
        app = modal.App.lookup("mulagent", create_if_missing=True)
        gpu = cfg["description"].get("accelerator")
        sandbox = modal.Sandbox.create(
            "sh", "-c", "exec "+shlex.join(job["command"])+" > /data/log 2>&1",
            workdir="/data/work", image=modal.Image.from_registry(image), app=app,
            volumes={"/data": vol}, timeout=seconds, env=job.get("env", {}),
            gpu=f"{gpu}:{resources['gpus']}" if resources["gpus"] else None,
            cpu=resources.get("cpus"), memory=math.ceil(resources["memGb"]*1024) if "memGb" in resources else None,
        )
        try:
            sandbox.set_tags({"backend":cfg["description"]["id"], "gpus":str(resources["gpus"])})
        except Exception:
            sandbox.terminate()
            raise
        info.update(native=sandbox.object_id, volume=volume_name)
    else:
        endpoint = cfg["endpoint"]
        files = {}
        executable = []
        size = 0
        for path in (root / "work").rglob("*"):
            if path.is_file() and not path.is_symlink():
                size += path.stat().st_size
                if size > 6_000_000:
                    raise ValueError("RunPod inline workspace exceeds 6 MB")
                name = str(path.relative_to(root / "work"))
                if path.stat().st_mode & 0o111:
                    executable.append(name)
                files[name] = base64.b64encode(path.read_bytes()).decode()
        result = api(endpoint, "run", {"input": {"command": job["command"], "env": job.get("env", {}),
                     "files": files, "executable": executable, "artifacts": info["files"]}, "policy": {"executionTimeout": seconds*1000}})
        info.update(endpoint=endpoint, native=result["id"])
    save(root / "provider.json", json.dumps(info).encode())
    print(info["native"])


def handle(action, root):
    info = json.loads((root / "provider.json").read_text())
    if action == "status" and (root/"cloud-status.json").exists():
        print((root/"cloud-status.json").read_text())
        return
    if action == "fetch" and (root/"cloud-fetched").exists():
        return
    if info["provider"] == "modal":
        import modal
        if action in ("status", "cancel"):
            sb = modal.Sandbox.from_id(info["native"])
        if action == "cancel":
            sb.terminate()
            return
        vol = modal.Volume.from_name(info["volume"])
        if action == "status":
            code = sb.poll()
            try:
                save(root / "log", b"".join(vol.read_file("/log")))
            except FileNotFoundError:
                pass
            status = {"state":"running"} if code is None else {"state":"succeeded" if code==0 else "failed","exitCode":code}
            if code is not None:
                save(root/"cloud-status.json",json.dumps(status).encode())
            print(json.dumps(status))
        else:
            import subprocess
            for name in info["files"]:
                path = root / "work" / name
                path.parent.mkdir(parents=True, exist_ok=True)
                subprocess.run(["modal", "volume", "get", "--force", info["volume"], "/work/"+name, str(path)], check=True)
            (root/"cloud-fetched").touch()
            subprocess.run(["modal", "volume", "delete", "--yes", "--allow-missing", info["volume"]], check=True)
    else:
        endpoint, native = info["endpoint"], info["native"]
        if action == "cancel":
            api(endpoint, "cancel/"+native, {})
            return
        cache = root/"runpod-result.json"
        result = json.loads(cache.read_text()) if cache.exists() else api(endpoint, "status/"+native)
        if result.get("status") in ("COMPLETED","FAILED","CANCELLED","TIMED_OUT") and not cache.exists():
            save(cache,json.dumps(result).encode())
        progress = result.get("progress")
        if isinstance(progress, str):
            save(root/"log",progress.encode())
        output = result.get("output") or {}
        if "log" in output:
            save(root / "log", output["log"].encode())
        if action == "status":
            state = {"IN_QUEUE":"queued", "IN_PROGRESS":"running","COMPLETED":"succeeded",
                     "FAILED":"failed","CANCELLED":"cancelled","TIMED_OUT":"failed"}.get(result.get("status"), "unknown")
            if state == "succeeded" and output.get("exitCode") != 0:
                state = "failed"
            print(json.dumps({"state":state}))
        else:
            for name, data in output.get("files", {}).items():
                path = (root / "work" / name).resolve()
                if not path.is_relative_to((root / "work").resolve()) or not any(name==a or name.startswith(a+"/") for a in info["files"]):
                    raise ValueError("Unexpected artifact path")
                path.parent.mkdir(parents=True, exist_ok=True)
                save(path, base64.b64decode(data,validate=True))
            if result.get("status") == "COMPLETED":
                (root/"cloud-fetched").touch()


def monitor(config):
    if config["cloudProvider"] == "runpod":
        health = api(config["endpoint"], "health")
        free = health["workers"].get("idle", 0) * config["description"]["gpusTotal"]
        queued = health["jobs"].get("inQueue", 0)
    else:
        import modal
        app = modal.App.lookup("mulagent", create_if_missing=True)
        active = list(modal.Sandbox.list(app_id=app.app_id, tags={"backend":config["description"]["id"]}))
        used = sum(int(sb.get_tags()["gpus"]) for sb in active)
        free = max(0, config["description"]["gpusTotal"] - used)
        queued = 0
    print(json.dumps({"gpusFree":free,"queueDepth":queued}))


if __name__ == "__main__":
    action, folder = sys.argv[1:]
    if action == "monitor":
        monitor(json.load(sys.stdin))
    elif action == "submit":
        submit(Path(folder))
    else:
        handle(action, Path(folder))
