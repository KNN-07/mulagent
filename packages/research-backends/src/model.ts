import {
  BackendDescription,
  ResourceRequest,
  type JobId,
  type JobStatus,
  type ResearchRunId,
} from "@t3tools/contracts";
import * as S from "effect/Schema";
import { parse } from "yaml";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodePath from "node:path";

export const BackendConfig = S.Struct({
  description: BackendDescription,
  workRoot: S.String,
  gpusPerNode: S.optional(S.Int),
  baseUsdPerHour: S.optional(S.Number),
  maxConcurrent: S.Int,
  spendCapUsd: S.Number,
  host: S.optional(S.String),
  partition: S.optional(S.String),
  account: S.optional(S.String),
  qos: S.optional(S.String),
  containerRuntime: S.optional(S.Literals(["docker", "podman"])),
  networks: S.optional(S.Array(S.String)),
  gpuMemGb: S.optional(S.Number),
  cpusPerNode: S.optional(S.Int),
  memGbPerNode: S.optional(S.Number),
  queueMinutesPerJob: S.optional(S.Number),
  namespace: S.optional(S.String),
  workspaceClaim: S.optional(S.String),
  defaultImage: S.optional(S.String),
  cloudProvider: S.optional(S.Literals(["modal", "runpod"])),
  endpoint: S.optional(S.String),
});
export type BackendConfig = typeof BackendConfig.Type;
export function parseConfig(source: string) {
  const configs = S.decodeUnknownSync(S.Struct({ backends: S.Array(BackendConfig) }), {
    onExcessProperty: "error",
  })(parse(source)).backends;
  const ids = new Set<string>();
  for (const c of configs) {
    validateConfig(c);
    if (ids.has(c.description.id)) throw Error("Duplicate backend id");
    ids.add(c.description.id);
  }
  return configs;
}
export function validateConfig(c: BackendConfig) {
  const d = c.description;
  if (
    ![
      c.gpusPerNode ?? 0,
      c.baseUsdPerHour ?? 0,
      c.gpuMemGb ?? 0,
      c.cpusPerNode ?? 0,
      c.memGbPerNode ?? 0,
      d.maxWallHours ?? 0,
    ].every((v) => Number.isFinite(v) && v >= 0) ||
    !NodePath.isAbsolute(c.workRoot) ||
    !/^\/[A-Za-z0-9._/-]+$/.test(c.workRoot) ||
    c.workRoot.split("/").includes("..") ||
    c.maxConcurrent < 1 ||
    ![c.spendCapUsd, d.usdPerGpuHour, c.queueMinutesPerJob ?? 0].every(
      (v) => Number.isFinite(v) && v >= 0,
    )
  )
    throw Error("Invalid backend capacity, id or workspace");
  if (c.host && !/^(?:[\w.]+@)?[a-zA-Z0-9][\w.-]*$/.test(c.host))
    throw Error("Invalid SSH destination");
  if (d.kind === "kubernetes" && !c.workspaceClaim)
    throw Error("Kubernetes needs a shared workspaceClaim mounted at workRoot");
  if (
    d.kind === "cloud" &&
    (!c.cloudProvider ||
      (c.cloudProvider === "runpod" && !/^[a-zA-Z0-9_-]+$/.test(c.endpoint ?? "")))
  )
    throw Error("Configure a cloud provider and RunPod endpoint");
  if (d.kind === "cloud" && (c.host || !c.defaultImage || (d.gpusTotal > 0 && !d.accelerator)))
    throw Error("Cloud requires a local workspace, image and configured accelerator");
  if (d.kind === "cloud" && c.cloudProvider === "runpod" && (d.nodes ?? 1) !== 1)
    throw Error("Configure the endpoint worker shape as one node");
}
export function maximumCost(c: BackendConfig, r: ResourceRequest) {
  return (
    ((c.description.usdPerGpuHour * r.gpus + (c.baseUsdPerHour ?? 0)) * Math.ceil(r.hours * 3600)) /
    3600
  );
}
export interface Job {
  command: readonly [string, ...string[]];
  cwd: string;
  resources: ResourceRequest;
  env?: Readonly<Record<string, string>>;
  artifacts: readonly string[];
  metrics?: readonly string[];
  network?: string;
  runId?: ResearchRunId;
}
export interface Status extends JobStatus {
  preempted?: boolean;
  estimatedStart?: string;
}
export interface Backend {
  readonly config: BackendConfig;
  describe(): BackendDescription;
  submit(job: Job, id?: JobId, resumeFrom?: JobId): Promise<JobId>;
  status(id: JobId): Promise<Status>;
  logs(id: JobId, options: { follow: boolean }): AsyncIterable<string>;
  cancel(id: JobId): Promise<void>;
  fetch(id: JobId, dest: string): Promise<void>;
}
export function canServe(c: BackendConfig, r: ResourceRequest) {
  const d = c.description,
    n = r.nodes ?? 1;
  return (
    S.is(ResourceRequest)(r) &&
    Number.isFinite(r.hours) &&
    r.hours > 0 &&
    r.hours <= (d.maxWallHours ?? Infinity) &&
    n <= (d.nodes ?? 1) &&
    (n === 1 || d.kind === "slurm" || d.kind === "pbs") &&
    r.gpus % n === 0 &&
    r.gpus <= d.gpusTotal &&
    r.gpus / n <= (c.gpusPerNode ?? Math.floor(d.gpusTotal / (d.nodes ?? 1))) &&
    (c.cloudProvider !== "runpod" ||
      (r.gpus === d.gpusTotal && (!r.image || r.image === c.defaultImage))) &&
    (!d.preemptible || r.preemptibleOk === true) &&
    (r.gpuMemGb ?? 0) >= 0 &&
    (r.gpuMemGb ?? 0) <= (c.gpuMemGb ?? 0) &&
    (r.memGb ?? 0) >= 0 &&
    (r.memGb ?? 0) <= (c.memGbPerNode ?? 0) &&
    (r.cpus ?? 0) <= (c.cpusPerNode ?? 0) &&
    (!r.image || !!c.containerRuntime || ["cloud", "kubernetes"].includes(d.kind)) &&
    (!["cloud", "kubernetes"].includes(d.kind) || !!(r.image ?? c.defaultImage))
  );
}
export function checkJob(c: BackendConfig, j: Job) {
  if (!canServe(c, j.resources) || !j.command[0] || j.command[0].startsWith("-"))
    throw Error("Unsupported job");
  if (
    j.network &&
    (!j.resources.image ||
      !c.containerRuntime ||
      ["cloud", "kubernetes"].includes(c.description.kind) ||
      !c.networks?.includes(j.network))
  )
    throw Error("Network outside configured allowlist");
  for (const k of Object.keys(j.env ?? {}))
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw Error("Invalid environment key");
  for (const p of [...j.artifacts, ...(j.metrics ?? [])])
    if (NodePath.isAbsolute(p) || p.split("/").some((s) => !s || s === "." || s === ".."))
      throw Error("Artifacts must be workspace-relative");
}
