import type { BackendConfig, Job, Status } from "./model.ts";
import type { JobState } from "@t3tools/contracts";
import { quote, shell, type Execute } from "./transport.ts";

export function workload(c: BackendConfig, j: Job, dir: string): string {
  const env = Object.entries(j.env ?? {}).map(([k, v]) => k + "=" + v);
  const r = j.resources,
    n = r.nodes ?? 1,
    gpu = r.gpus / n;
  const checkpoint = "MULAGENT_CHECKPOINT_DIR=" + (r.image ? "/work" : dir) + "/.checkpoints";
  let cmd = shell(["env", ...env, checkpoint, ...j.command]);
  if (n > 1 && c.description.kind === "slurm") {
    cmd =
      shell(["torchrun", "--nnodes", String(n), "--nproc-per-node", String(Math.max(1, gpu))]) +
      ' --node-rank="$SLURM_NODEID" --master-addr="$MASTER_ADDR" --master-port="$MASTER_PORT" --no-python ' +
      shell(["env", ...env, checkpoint, ...j.command]);
  }
  if (r.image) {
    if (!c.containerRuntime) throw Error("Container runtime required");
    cmd = shell([
      c.containerRuntime,
      "run",
      "--rm",
      "--network",
      j.network ?? "none",
      "-v",
      dir + ":/work",
      "-w",
      "/work",
      ...(gpu
        ? c.containerRuntime === "podman"
          ? ["--device", "nvidia.com/gpu=all"]
          : ["--gpus", String(gpu)]
        : []),
      ...(n > 1 ? ["-e", "MASTER_ADDR", "-e", "MASTER_PORT", "-e", "SLURM_NODEID"] : []),
      ...(r.cpus ? ["--cpus", String(r.cpus)] : []),
      ...(r.memGb ? ["--memory", r.memGb + "g"] : []),
      "--",
      r.image,
      "sh",
      "-c",
      cmd,
    ]);
  }
  if (n > 1 && c.description.kind === "slurm")
    return (
      'export MASTER_ADDR=$(scontrol show hostnames "$SLURM_JOB_NODELIST" | head -1)\nexport MASTER_PORT=$((20000 + SLURM_JOB_ID % 30000))\nsrun --ntasks-per-node=1 ' +
      cmd
    );
  if (n > 1 && c.description.kind === "pbs") return "mpiexec -n " + n + " " + cmd;
  return cmd;
}
export function batchScript(c: BackendConfig, j: Job, dir: string) {
  const r = j.resources,
    n = r.nodes ?? 1,
    gpu = r.gpus / n;
  const seconds = Math.ceil(r.hours * 3600);
  const wall = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
  const directives =
    c.description.kind === "slurm"
      ? [
          "--nodes=" + n,
          "--ntasks-per-node=1",
          ...(gpu ? ["--gpus-per-node=" + gpu] : []),
          "--time=" + wall,
          "--output=" + dir + "/../log",
          "--open-mode=append",
          ...(r.cpus ? ["--cpus-per-task=" + r.cpus] : []),
          ...(r.memGb ? ["--mem=" + Math.ceil(r.memGb * 1024) + "M"] : []),
          ...Object.entries({ partition: c.partition, account: c.account, qos: c.qos }).flatMap(
            ([k, v]) => {
              if (!v) return [];
              if (!/^[\w.-]+$/.test(v)) throw Error("Invalid Slurm " + k);
              return ["--" + k + "=" + v];
            },
          ),
          ...(r.preemptibleOk ? ["--requeue"] : []),
        ].map((v) => "#SBATCH " + v)
      : [
          "#PBS -l select=" +
            n +
            ":ngpus=" +
            gpu +
            (r.cpus ? ":ncpus=" + r.cpus : "") +
            (r.memGb ? ":mem=" + Math.ceil(r.memGb * 1024) + "mb" : ""),
          "#PBS -l walltime=" + wall,
          "#PBS -j oe",
          "#PBS -o " + dir + "/../log",
        ];
  return [
    "#!/bin/sh",
    ...directives,
    "set -eu",
    "cd " + quote(dir),
    "mkdir -p .checkpoints",
    'export MULAGENT_RESTART_COUNT="${SLURM_RESTART_COUNT:-0}"',
    workload(c, j, dir),
    "",
  ].join("\n");
}
export function slurmState(raw: string): { state: JobState; preempted?: boolean } {
  switch (raw.trim().split(/[ +]/)[0]) {
    case "PENDING":
    case "CONFIGURING":
    case "REQUEUED":
      return { state: "queued" };
    case "RUNNING":
    case "COMPLETING":
    case "SUSPENDED":
      return { state: "running" };
    case "COMPLETED":
      return { state: "succeeded" };
    case "CANCELLED":
      return { state: "cancelled" };
    case "PREEMPTED":
      return { state: "failed", preempted: true };
    case "FAILED":
    case "TIMEOUT":
    case "OUT_OF_MEMORY":
    case "NODE_FAIL":
    case "BOOT_FAIL":
    case "DEADLINE":
      return { state: "failed" };
    default:
      return { state: "unknown" };
  }
}
export function parsePbs(raw: string, id: string): Pick<Status, "state" | "nodes" | "exitCode"> {
  const row = JSON.parse(raw).Jobs?.[id];
  if (!row) return { state: "unknown", nodes: [] };
  const code = row.Exit_status;
  const state: JobState = (
    {
      Q: "queued",
      H: "queued",
      W: "queued",
      R: "running",
      E: "running",
      S: "running",
      F: code === 0 ? "succeeded" : "failed",
      X: "cancelled",
    } as const
  )[row.job_state as "Q"];
  return {
    state: state ?? "unknown",
    nodes: [
      ...new Set<string>(
        String(row.exec_host ?? "")
          .split("+")
          .filter(Boolean)
          .map((v) => v.split("/")[0]!),
      ),
    ],
    ...(typeof code === "number" ? { exitCode: code } : {}),
  };
}
export async function batchStatus(
  kind: string,
  run: Execute,
  id: string,
): Promise<
  Pick<Status, "state" | "nodes" | "estimatedStart" | "preempted" | "exitCode" | "queuePosition">
> {
  if (kind === "pbs") return parsePbs(await run("qstat", ["-xf", "-F", "json", id]), id);
  const rows = (await run("squeue", ["--noheader", "--sort=-p,i", "--format=%i|%T|%N"]))
    .trim()
    .split("\n")
    .map((l) => l.split("|"));
  const row = rows.find((v) => v[0] === id);
  if (row) {
    const s = slurmState(row[1] ?? "");
    if (s.state === "queued") {
      const start = (await run("squeue", ["--start", "-h", "-j", id, "-o", "%S"])).trim();
      return {
        ...s,
        nodes: [],
        queuePosition:
          1 + rows.slice(0, rows.indexOf(row)).filter((v) => v[1] === "PENDING").length,
        ...(/^\d{4}-/.test(start) ? { estimatedStart: start } : {}),
      };
    }
    return { ...s, nodes: row[2] ? [row[2]] : [] };
  }
  const history = await run("sacct", [
    "-X",
    "-n",
    "-P",
    "-j",
    id,
    "-o",
    "JobIDRaw,State,ExitCode,NodeList",
  ]);
  const entry = history
    .trim()
    .split("\n")
    .map((l) => l.split("|"))
    .find((v) => v[0] === id);
  return {
    ...slurmState(entry?.[1] ?? ""),
    nodes: entry?.[3] ? [entry[3]] : [],
    ...(entry?.[2] ? { exitCode: Number(entry[2].split(":")[0]) } : {}),
  };
}
