import type { BackendConfig, Job } from "./model.ts";
import { workload } from "./batch.ts";
import type { Execute } from "./transport.ts";

// The supervisor owns the workload process group after the SSH connection closes.
const supervisor = `
import json, os, signal, subprocess, sys
from pathlib import Path
root, command, seconds, runtime, name = sys.argv[1:]
work = Path(root) / "work"
(work / ".checkpoints").mkdir(exist_ok=True)
class Cancelled(Exception):
    pass
def cancel(*_):
    raise Cancelled()
signal.signal(signal.SIGTERM, cancel)
proc = None
try:
    proc = subprocess.Popen(["sh", "-c", command], cwd=work, start_new_session=True)
    exit_code = proc.wait(timeout=float(seconds))
except (Cancelled, subprocess.TimeoutExpired):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    if proc:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
    if runtime:
        subprocess.run([runtime, "rm", "--force", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    exit_code = 124
finally:
    pending = Path(root) / "exit.tmp"
    pending.write_text(str(locals().get("exit_code", 1)))
    pending.replace(Path(root) / "exit")
`;
const launcher = `
import json, os, subprocess, sys
root, command, seconds, runtime, name = sys.argv[1:]
with open(root + "/log", "ab") as log:
    p = subprocess.Popen([sys.executable, "-c", sys.stdin.read(), root, command, seconds, runtime, name],
        start_new_session=True, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
        env={"PATH": os.environ["PATH"], "MULAGENT_JOB_ID":name[3:]})
print(p.pid)
`;

export async function launchProcess(
  run: Execute,
  c: BackendConfig,
  j: Job,
  root: string,
  id: string,
) {
  const name = "ma-" + id;
  return (
    await run(
      "python3",
      [
        "-c",
        launcher,
        root,
        workload(c, j, root + "/work", name),
        String(Math.ceil(j.resources.hours * 3600)),
        j.resources.image ? (c.containerRuntime ?? "") : "",
        name,
      ],
      supervisor,
    )
  ).trim();
}
