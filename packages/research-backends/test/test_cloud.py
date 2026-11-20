import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import cloud


class CloudTests(unittest.TestCase):
    def test_runpod_round_trip_and_persistent_cap(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, runpod=types.ModuleType("runpod")):
            import runpod_worker
            root = Path(tmp) / "job"
            work = root / "work"
            work.mkdir(parents=True)
            (work / "source").write_text("metric=42")
            cfg = {"cloudProvider": "runpod", "description": {"id": "gpu"},
                   "defaultImage": "worker:v1", "endpoint": "fixture", "spendCapUsd": 1}
            request = {"maximumCost": 1, "config": cfg, "job": {
                "command": ["sh", "-c", "cat source > metric; echo measured"],
                "artifacts": [], "metrics": ["metric"], "resources": {"hours": 1, "gpus": 1}}}
            output = {}

            def api(endpoint, operation, body=None):
                self.assertEqual(endpoint, "fixture")
                if operation == "run":
                    self.assertEqual(body["policy"]["executionTimeout"], 3600000)
                    output.update(runpod_worker.handle(body))
                    return {"id": "native"}
                self.assertEqual(operation, "status/native")
                return {"status": "COMPLETED", "output": output}

            with patch.object(cloud, "api", side_effect=api), contextlib.redirect_stdout(io.StringIO()) as stdout:
                with patch("sys.stdin", io.StringIO(json.dumps(request))):
                    cloud.submit(root)
                cloud.handle("status", root)
                self.assertIn('"state": "succeeded"', stdout.getvalue())
                cloud.handle("fetch", root)
                self.assertEqual((root / "log").read_text(), "measured\n")
                self.assertEqual((work / "metric").read_text(), "metric=42")
                with patch("sys.stdin", io.StringIO(json.dumps(request))), self.assertRaisesRegex(ValueError, "cap"):
                    cloud.submit(Path(tmp) / "second")


if __name__ == "__main__":
    unittest.main()
