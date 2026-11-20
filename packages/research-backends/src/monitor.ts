// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodeTimersPromises from "node:timers/promises";
import { cloudCommand } from "./cloudCommand.ts";
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
interface KubeNode {
  metadata: { name: string };
  spec?: { unschedulable?: boolean };
  status: { conditions: { type: string; status: string }[]; allocatable?: Record<string, string> };
}
interface KubePod {
  metadata: { namespace: string };
  status: { phase: string };
  spec: {
    nodeName?: string;
    containers: {
      resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
    }[];
  };
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
          } else if (kind === "local" || kind === "ssh") {
            const hostname = (await b.hostRun("hostname", [])).trim();
            let free = 0;
            if (b.describe().gpusTotal) {
              const [devices, busy] = await Promise.all([
                b.hostRun("nvidia-smi", ["--query-gpu=uuid", "--format=csv,noheader"]),
                b.hostRun("nvidia-smi", ["--query-compute-apps=gpu_uuid", "--format=csv,noheader"]),
              ]);
              const used = new Set(busy.trim().split("\n"));
              free = devices
                .trim()
                .split("\n")
                .filter((id) => id && !used.has(id)).length;
            }
            nodes = [{ name: hostname, state: "online", freeGpus: free }];
            b.updateHealth({ healthy: true, queueDepth: 0, gpusFree: free });
          } else if (kind === "kubernetes") {
            const [inventory, workloads] = await Promise.all([
              b.hostRun("kubectl", ["get", "nodes", "-o", "json"]),
              b.hostRun("kubectl", ["get", "pods", "--all-namespaces", "-o", "json"]),
            ]);
            const pods: KubePod[] = JSON.parse(workloads).items;
            const inventoryNodes: KubeNode[] = JSON.parse(inventory).items;
            nodes = inventoryNodes.map((n) => {
              const ready =
                !n.spec?.unschedulable &&
                n.status.conditions.some((c) => c.type === "Ready" && c.status === "True");
              const used = pods
                .filter(
                  (p) =>
                    p.spec.nodeName === n.metadata.name &&
                    !["Succeeded", "Failed"].includes(p.status.phase),
                )
                .reduce(
                  (sum, p) =>
                    sum +
                    p.spec.containers.reduce(
                      (total, c) =>
                        total +
                        Number(
                          c.resources?.requests?.["nvidia.com/gpu"] ??
                            c.resources?.limits?.["nvidia.com/gpu"] ??
                            0,
                        ),
                      0,
                    ),
                  0,
                );
              return {
                name: n.metadata.name,
                state: ready ? "ready" : "unavailable",
                freeGpus: ready
                  ? Math.max(0, Number(n.status.allocatable?.["nvidia.com/gpu"] ?? 0) - used)
                  : 0,
              };
            });
            b.updateHealth({
              healthy: true,
              queueDepth: pods.filter(
                (p) =>
                  p.status.phase === "Pending" &&
                  p.metadata.namespace === (b.config.namespace ?? "default"),
              ).length,
              gpusFree: nodes.reduce((n, v) => n + v.freeGpus, 0),
            });
          } else {
            const data = JSON.parse(
              await b.run(
                "python3",
                cloudCommand("monitor", b.config.workRoot),
                JSON.stringify(b.config),
              ),
            );
            b.updateHealth({ healthy: true, queueDepth: data.queueDepth, gpusFree: data.gpusFree });
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
