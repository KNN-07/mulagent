// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodeTimersPromises from "node:timers/promises";
import { JobId, type BackendDescription } from "@t3tools/contracts";
import { launchProcess } from "./process.ts";
import { batchScript, batchStatus } from "./batch.ts";
import { manifest } from "./kubernetes.ts";
import {
  validateConfig,
  maximumCost,
  checkJob,
  type Backend,
  type Job,
  type BackendConfig,
  type Status,
} from "./model.ts";
import { execute, quote, shell, transport, type Execute } from "./transport.ts";

export class ComputeBackend implements Backend {
  readonly config: BackendConfig;
  readonly run: Execute;
  readonly hostRun: Execute;
  private description: BackendDescription;
  constructor(config: BackendConfig, run = execute) {
    validateConfig(config);
    this.config = config;
    this.run = run;
    this.hostRun = transport(run, config.host);
    this.description = config.description;
  }
  describe() {
    return this.description;
  }
  updateHealth(data: Partial<Pick<BackendDescription, "queueDepth" | "gpusFree" | "healthy">>) {
    this.description = { ...this.description, ...data };
  }
  private dir(id: JobId) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid job id");
    return this.config.workRoot + "/" + id;
  }
  private remote(path: string) {
    return this.config.host ? this.config.host + ":" + path : path;
  }
  private kubectl(args: string[], input?: string) {
    return this.hostRun("kubectl", ["-n", this.config.namespace ?? "default", ...args], input);
  }
  private cloud(action: string, dir: string, input?: string) {
    return this.run(
      "python3",
      [NodeURL.fileURLToPath(new URL("./cloud.py", import.meta.url)), action, dir],
      input,
    );
  }
  private async metadata(
    id: JobId,
  ): Promise<{ native: string; files: string[]; runId?: Job["runId"] }> {
    return JSON.parse(await this.hostRun("cat", [this.dir(id) + "/metadata"]));
  }
  async submit(j: Job, id = JobId.make(NodeCrypto.randomUUID()), resumeFrom?: JobId) {
    const c = this.config,
      kind = c.description.kind;
    checkJob(c, j);
    const dir = this.dir(id),
      work = dir + "/work",
      src = NodePath.resolve(j.cwd);
    if (!c.host && (dir.startsWith(src + "/") || src === "/"))
      throw Error("workRoot must be outside the source tree");
    await this.hostRun("mkdir", ["-p", c.workRoot]);
    await this.hostRun("mkdir", ["-m", "700", dir]);
    await this.hostRun("mkdir", [work]);
    await this.run("rsync", [
      "-rlt",
      "--safe-links",
      "--protect-args",
      "--exclude=.git",
      "--exclude=.ssh",
      "--exclude=.aws",
      "--exclude=.kube",
      "--exclude=.t3",
      "--exclude=.gnupg",
      "--exclude=.env*",
      "--exclude=node_modules",
      "--",
      src + "/",
      this.remote(work + "/"),
    ]);
    if (resumeFrom) {
      const previous = this.dir(resumeFrom) + "/work/.checkpoints";
      await this.hostRun("sh", [
        "-c",
        "if test -d " +
          quote(previous) +
          "; then " +
          shell(["rsync", "-rlt", "--safe-links", "--", previous + "/", work + "/.checkpoints/"]) +
          "; fi",
      ]);
    }
    await this.hostRun("touch", [dir + "/log"]);
    let native: string;
    if (kind === "slurm" || kind === "pbs") {
      native = (
        await this.hostRun(
          kind === "slurm" ? "sbatch" : "qsub",
          kind === "slurm" ? ["--parsable"] : [],
          batchScript(c, j, work),
        )
      )
        .trim()
        .split(";")[0]!;
      if (!/^[0-9]+(?:\.[\w.-]+)?$/.test(native)) throw Error("Unexpected batch job id");
    } else if (kind === "kubernetes") {
      native = "ma-" + id;
      await this.kubectl(["create", "-f", "-"], JSON.stringify(manifest(c, j, native, work)));
    } else if (kind === "cloud") {
      native = (
        await this.cloud(
          "submit",
          dir,
          JSON.stringify({ job: j, config: c, maximumCost: maximumCost(c, j.resources) }),
        )
      ).trim();
    } else {
      native = await launchProcess(this.hostRun, c, j, dir, id);
      if (!/^\d+$/.test(native)) throw Error("Invalid process id");
    }
    await this.hostRun(
      "sh",
      ["-c", "umask 077; cat > " + quote(dir + "/metadata")],
      JSON.stringify({ native, files: [...j.artifacts, ...(j.metrics ?? [])], runId: j.runId }),
    );
    return id;
  }
  async status(id: JobId): Promise<Status> {
    const dir = this.dir(id),
      m = await this.metadata(id),
      kind = this.config.description.kind;
    const base = {
      id,
      backendId: this.description.id,
      nativeId: m.native,
      ...(m.runId ? { runId: m.runId } : {}),
      nodes: [],
    };
    if (
      (
        await this.hostRun("sh", [
          "-c",
          "test ! -f " + quote(dir + "/cancelled") + " || echo cancelled",
        ])
      ).trim()
    )
      return { ...base, state: "cancelled" };
    if (kind === "slurm" || kind === "pbs")
      return { ...base, ...(await batchStatus(kind, this.hostRun, m.native)) };
    if (kind === "kubernetes") {
      const s = JSON.parse(await this.kubectl(["get", "job", m.native, "-o", "json"])).status ?? {};
      return {
        ...base,
        state: s.succeeded
          ? "succeeded"
          : s.conditions?.some(
                (v: { type: string; status: string }) => v.type === "Failed" && v.status === "True",
              )
            ? "failed"
            : s.active
              ? "running"
              : "queued",
      };
    }
    if (kind === "cloud") return { ...base, ...JSON.parse(await this.cloud("status", dir)) };
    const out = (
      await this.hostRun("sh", [
        "-c",
        "if test -f " +
          quote(dir + "/exit") +
          "; then cat " +
          quote(dir + "/exit") +
          "; elif " +
          this.ownsProcess(id, m.native) +
          "; then echo running; else echo unknown; fi",
      ])
    ).trim();
    return /^\d+$/.test(out)
      ? { ...base, state: out === "0" ? "succeeded" : "failed", exitCode: Number(out) }
      : { ...base, state: out === "running" ? "running" : "unknown" };
  }
  private ownsProcess(id: JobId, pid: string) {
    if (!/^\d+$/.test(pid)) throw Error("Invalid process id");
    return (
      "grep -zFxq " +
      quote("MULAGENT_JOB_ID=" + id) +
      " " +
      quote("/proc/" + pid + "/environ") +
      " 2>/dev/null"
    );
  }
  async cancel(id: JobId) {
    const { native } = await this.metadata(id),
      kind = this.config.description.kind,
      dir = this.dir(id);
    if (["cancelled", "failed", "succeeded"].includes((await this.status(id)).state)) return;
    if (kind === "kubernetes") await this.kubectl(["delete", "job", native]);
    else if (kind === "cloud") await this.cloud("cancel", dir);
    else if (kind === "slurm" || kind === "pbs")
      await this.hostRun(kind === "slurm" ? "scancel" : "qdel", [native]);
    else
      await this.hostRun("sh", [
        "-c",
        this.ownsProcess(id, native) + " && /bin/kill -TERM -- " + native,
      ]);
    await this.hostRun("touch", [dir + "/cancelled"]);
  }
  async *logs(id: JobId, { follow }: { follow: boolean }) {
    const dir = this.dir(id);
    let offset = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const state = await this.status(id);
      const encoded = await this.hostRun("sh", [
        "-c",
        "set -e; dd if=" +
          quote(dir + "/log") +
          " iflag=skip_bytes,count_bytes skip=" +
          offset +
          " count=65536 status=none | base64",
      ]);
      const bytes = Buffer.from(encoded, "base64");
      offset += bytes.length;
      if (bytes.length) yield decoder.decode(bytes, { stream: true });
      if (bytes.length === 65536) continue;
      if (!follow || !["running", "queued"].includes(state.state)) break;
      await NodeTimersPromises.setTimeout(1000);
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  }
  async fetch(id: JobId, dest: string) {
    const dir = this.dir(id),
      { files } = await this.metadata(id);
    if (this.config.description.kind === "cloud") await this.cloud("fetch", dir);
    await NodeFSP.mkdir(dest, { recursive: true });
    if (files.length)
      await this.run(
        "rsync",
        [
          "-rt",
          "--protect-args",
          "--from0",
          "--files-from=-",
          "--",
          this.remote(dir + "/work/"),
          NodePath.resolve(dest) + "/",
        ],
        files.join("\0") + "\0",
      );
  }
}
