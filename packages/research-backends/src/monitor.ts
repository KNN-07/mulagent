// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodeTimersPromises from "node:timers/promises";
import type { ComputeBackend } from "./backend.ts";
export interface NodeAvailability {
  name: string;
  state: string;
  freeGpus: number;
}
function gpuCount(gres: string) {
  return [...gres.matchAll(/(?:^|,)gpu:(?:[^:,()]+:)?(\d+)(?=[,(]|$)/g)].reduce(
    (sum, m) => sum + Number(m[1]),
    0,
  );
}
export function slurmNodes(text: string): NodeAvailability[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", state = "", gres = "", used = ""] = line.trim().split(/\s+/);
      return {
        name,
        state,
        freeGpus: /^(idle|mix|alloc)/i.test(state)
          ? Math.max(0, gpuCount(gres) - gpuCount(used))
          : 0,
      };
    });
}
export function pbsNodes(text: string): NodeAvailability[] {
  const nodes: Record<
    string,
    {
      state: string;
      resources_available?: { ngpus?: number };
      resources_assigned?: { ngpus?: number };
    }
  > = JSON.parse(text).nodes;
  return Object.entries(nodes).map(([name, n]) => ({
    name,
    state: n.state,
    freeGpus: /offline|down|unknown/i.test(n.state)
      ? 0
      : Math.max(
          0,
          Number(n.resources_available?.ngpus ?? 0) - Number(n.resources_assigned?.ngpus ?? 0),
        ),
  }));
}
export class ClusterMonitor {
  readonly backends: readonly ComputeBackend[];
  constructor(backends: readonly ComputeBackend[]) {
    this.backends = backends;
  }
  async sample() {
    return Promise.all(
      this.backends.map(async (b) => {
        const { kind } = b.describe();
        let nodes: NodeAvailability[] = [];
        try {
          if (kind === "slurm" || kind === "pbs") {
            let depth: number;
            if (kind === "slurm") {
              const opts = b.config.partition ? ["-p", b.config.partition] : [];
              const [info, queue] = await Promise.all([
                b.hostRun("sinfo", [
                  "-N",
                  "-h",
                  ...opts,
                  "-O",
                  "NodeHost:128,StateCompact:24,Gres:256,GresUsed:256",
                ]),
                b.hostRun("squeue", ["-h", "-t", "PENDING", ...opts, "-o", "%i"]),
              ]);
              nodes = slurmNodes(info);
              depth = queue.trim() ? queue.trim().split("\n").length : 0;
            } else {
              const [info, queue] = await Promise.all([
                b.hostRun("pbsnodes", ["-a", "-F", "json"]),
                b.hostRun("qstat", ["-f", "-F", "json"]),
              ]);
              nodes = pbsNodes(info);
              depth = Object.values(JSON.parse(queue).Jobs ?? {}).filter(
                (row) => (row as { job_state: string }).job_state === "Q",
              ).length;
            }
            b.updateHealth({
              healthy: true,
              queueDepth: depth,
              gpusFree: nodes.reduce((sum, n) => sum + n.freeGpus, 0),
            });
          }
          return { description: b.describe(), nodes };
        } catch (error) {
          b.updateHealth({ healthy: false });
          return { description: b.describe(), nodes, error: String(error) };
        }
      }),
    );
  }
  async *watch(intervalMs: number, signal: AbortSignal) {
    if (!(intervalMs > 0)) throw Error("Expected positive monitor interval");
    while (!signal.aborted) {
      yield await this.sample();
      try {
        await NodeTimersPromises.setTimeout(intervalMs, undefined, { signal });
      } catch (e) {
        if (!signal.aborted) throw e;
      }
    }
  }
}
