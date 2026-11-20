import * as NodeSqlite from "node:sqlite";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Tests use private, disposable OS directories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import { BackendId, JobId } from "@t3tools/contracts";
import { it, expect } from "vite-plus/test";
import { ComputeBackend } from "./backend.ts";
import { batchScript, batchStatus, parsePbs } from "./batch.ts";
import {
  canServe,
  parseConfig,
  type BackendConfig,
  type Job,
  type Backend,
  type Status,
} from "./model.ts";
import { slurmNodes, pbsNodes } from "./monitor.ts";
import { Scheduler } from "./scheduler.ts";
import { manifest } from "./kubernetes.ts";

function config(kind: BackendConfig["description"]["kind"] = "slurm"): BackendConfig {
  return {
    description: {
      id: BackendId.make(kind),
      kind,
      label: kind,
      gpusTotal: 8,
      nodes: 2,
      healthy: true,
      preemptible: false,
      usdPerGpuHour: 1,
    },
    workRoot: "/var/tmp/mulagent",
    maxConcurrent: 1,
    spendCapUsd: 12,
    gpuMemGb: 40,
    memGbPerNode: 128,
    cpusPerNode: 32,
  };
}
const job: Job = {
  command: ["python", "space ' file.py", "$(false)"],
  cwd: "/tmp/source",
  artifacts: ["out"],
  resources: { gpus: 8, nodes: 2, hours: 1.5, cpus: 4, memGb: 16, preemptibleOk: true },
};

it("quotes experiment arguments and requests per-node resources and a shared rendezvous", () => {
  const c = {
    ...config(),
    description: { ...config().description, usdPerGpuHour: 0 },
    partition: "a100",
    account: "science",
    qos: "low",
  };
  const s = batchScript(c, job, "/jobs/a/work");
  for (const flag of [
    "--nodes=2",
    "--ntasks-per-node=1",
    "--gpus-per-node=4",
    "--time=01:30:00",
    "--partition=a100",
    "--account=science",
    "--qos=low",
    "--requeue",
  ])
    expect(s).toContain("#SBATCH " + flag + "\n");
  expect(s).toContain("'space '\\'' file.py' '$(false)'");
  expect(s).toContain("srun --ntasks-per-node=1");
  expect(s).toContain('--node-rank="$SLURM_NODEID"');
  expect(() => batchScript({ ...c, partition: "a\nwhoami" }, job, "/jobs/a/work")).toThrow();
  expect(batchScript(config("pbs"), job, "/jobs/a/work")).toContain(
    "#PBS -l select=2:ngpus=4:ncpus=4:mem=16384mb",
  );
  expect(canServe(c, { ...job.resources, nodes: 1 })).toBe(false);
});
it("reads queue estimates and distinguishes preemption from an absent accounting row", async () => {
  expect(
    await batchStatus(
      "slurm",
      async (_p, args) =>
        args.includes("--start")
          ? "2026-11-20T10:00:00"
          : "9|RUNNING|gpu01\n10|PENDING|\n11|PENDING|",
      "11",
    ),
  ).toMatchObject({ state: "queued", queuePosition: 2, estimatedStart: "2026-11-20T10:00:00" });
  expect(
    await batchStatus(
      "slurm",
      async (p) => (p === "sacct" ? "11|PREEMPTED|0:15|gpu01|" : ""),
      "11",
    ),
  ).toMatchObject({ state: "failed", preempted: true });
  expect((await batchStatus("slurm", async () => "", "11")).state).toBe("unknown");
  expect(
    parsePbs(
      '{"Jobs":{"11.server":{"job_state":"F","Exit_status":2,"exec_host":"gpu01/0+gpu01/1"}}}',
      "11.server",
    ),
  ).toEqual({ state: "failed", exitCode: 2, nodes: ["gpu01"] });
});
it("excludes unavailable devices from node reports", () => {
  expect(
    slurmNodes("node01 mix gpu:a100:4(S:0-1) gpu:a100:2(IDX:0-1)\nnode02 drain gpu:4 (null)").map(
      (n) => n.freeGpus,
    ),
  ).toEqual([2, 0]);
  expect(
    pbsNodes(
      '{"nodes":{"n1":{"state":"free","resources_available":{"ngpus":8},"resources_assigned":{"ngpus":2}}}}',
    )[0]?.freeGpus,
  ).toBe(6);
});
it("uses the requested image and exposes only the job workspace and log from the PVC", () => {
  const m = manifest(
    { ...config("kubernetes"), workspaceClaim: "runs" },
    { ...job, resources: { hours: 0.5, gpus: 1, image: "test:v1" } },
    "ma-123",
    "/runs/123/work",
  );
  expect(m.spec.activeDeadlineSeconds).toBe(1800);
  expect(m.spec.template.spec.containers[0]).toMatchObject({
    image: "test:v1",
    resources: { limits: { "nvidia.com/gpu": 1 } },
    volumeMounts: [{ subPath: "123/work" }, { subPath: "123/log" }],
  });
});
it("decodes YAML and JSON and rejects repeat backend ids", () => {
  const c = config();
  expect(parseConfig("backends:\n  - " + JSON.stringify(c))).toEqual([c]);
  expect(() => parseConfig(JSON.stringify({ backends: [c, c] }))).toThrow("Duplicate");
});
function fixture(id: string, usd: number, queueDepth: number) {
  const c = config();
  const description = { ...c.description, id: BackendId.make(id), usdPerGpuHour: usd, queueDepth };
  const jobs: Job[] = [];
  let state: Pick<Status, "state" | "preempted"> = { state: "running" };
  const b: Backend = {
    config: { ...c, description, queueMinutesPerJob: 60, spendCapUsd: 3 },
    describe: () => description,
    submit: async (j, id) => {
      jobs.push(j);
      return id ?? JobId.make("1");
    },
    status: async (id) => ({ id, backendId: description.id, nodes: [], ...state }),
    cancel: async () => {},
    fetch: async () => {},
    async *logs() {
      yield "";
    },
  };
  return {
    b,
    jobs,
    setStatus(v: typeof state) {
      state = v;
    },
  };
}
it("prioritizes jobs, prices queue wait, and preserves reservations across scheduler restarts", async () => {
  const a = fixture("busy", 0.1, 4),
    b = fixture("ready", 1, 0);
  using db = new NodeSqlite.DatabaseSync(":memory:");
  const s = new Scheduler([a.b, b.b], db),
    j = { ...job, resources: { gpus: 1, hours: 1 } };
  s.enqueue(j);
  const first = s.enqueue({ ...j, env: { FIRST: "yes" } }, 10);
  await Promise.all([s.tick(), s.tick()]);
  expect(b.jobs.map((j) => j.env)).toEqual([{ FIRST: "yes" }]);
  expect(a.jobs).toHaveLength(1);
  b.setStatus({ state: "failed", preempted: true });
  await new Scheduler([a.b, b.b], db).tick();
  expect(s.attempts(first)).toMatchObject([
    { backend: "ready", outcome: "preempted" },
    { backend: "ready" },
  ]);
  expect(() => s.enqueue({ ...j, resources: { gpus: 80, hours: 1 } })).toThrow();
});
it("reserves the full wall time before dispatch and never spends a second attempt past the cap", async () => {
  const a = fixture("only", 3, 0);
  using db = new NodeSqlite.DatabaseSync(":memory:");
  const s = new Scheduler([a.b], db);
  const t = s.enqueue({ ...job, resources: { gpus: 1, hours: 1 } });
  await s.tick();
  a.setStatus({ state: "failed", preempted: true });
  await s.tick();
  expect(a.jobs).toHaveLength(1);
  expect(s.status(t)?.phase).toBe("budget-exhausted");
});
it("executes a local job, resumes status, reads its log and fetches only requested files", async () => {
  const root = await NodeFSP.mkdtemp(NodeOS.tmpdir() + "/ma-test-");
  try {
    const src = root + "/source",
      dest = root + "/out";
    await NodeFSP.mkdir(src);
    await NodeFSP.writeFile(src + "/input", "input");
    const c = { ...config("local"), workRoot: root + "/jobs" };
    const id = await new ComputeBackend(c).submit({
      command: ["sh", "-c", 'cat input; echo "$RESULT" > metric.json'],
      cwd: src,
      resources: { gpus: 0, hours: 0.01 },
      env: { RESULT: "42" },
      artifacts: [],
      metrics: ["metric.json"],
    });
    const resumed = new ComputeBackend(c);
    let output = "";
    for await (const chunk of resumed.logs(id, { follow: true })) output += chunk;
    expect(output).toBe("input");
    expect((await resumed.status(id)).state).toBe("succeeded");
    await resumed.fetch(id, dest);
    expect(await NodeFSP.readdir(dest)).toEqual(["metric.json"]);
    expect(await NodeFSP.readFile(dest + "/metric.json", "utf8")).toBe("42\n");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("round trips remote argv and submission stdin through one SSH shell boundary", async () => {
  const { transport, execute } = await import("./transport.ts");
  const remote = transport(async (program, args, input) => {
    expect(program).toBe("ssh");
    expect(args.slice(-3, -1)).toEqual(["--", "research@login"]);
    return execute("sh", ["-c", args.at(-1)!], input);
  }, "research@login");
  expect(await remote("printf", ["%s", "x ' $(echo wrong)"])).toBe("x ' $(echo wrong)");
  expect(await remote("cat", [], "#!/bin/sh\nprintf '%s' ok")).toBe("#!/bin/sh\nprintf '%s' ok");
});
it("cancels a local process and reports its terminal state after reopening the backend", async () => {
  const root = await NodeFSP.mkdtemp(NodeOS.tmpdir() + "/ma-stop-");
  try {
    await NodeFSP.mkdir(root + "/source");
    const c = { ...config("local"), workRoot: root + "/jobs" };
    const b = new ComputeBackend(c);
    const id = await b.submit({
      command: ["sleep", "120"],
      resources: { gpus: 0, hours: 1 },
      cwd: root + "/source",
      artifacts: [],
    });
    await b.cancel(id);
    expect((await new ComputeBackend(c).status(id)).state).toBe("cancelled");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
