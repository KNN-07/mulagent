import type { BackendConfig, Job } from "./model.ts";
import { shell, quote } from "./transport.ts";
export function manifest(c: BackendConfig, j: Job, name: string, dir: string) {
  const r = j.resources;
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: Math.ceil(r.hours * 3600),
      template: {
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          containers: [
            {
              name: "experiment",
              image: r.image ?? c.defaultImage,
              workingDir: dir,
              command: [
                "sh",
                "-c",
                "exec " + shell(j.command) + " >>" + quote("/mulagent-job.log") + " 2>&1",
              ],
              env: Object.entries(j.env ?? {}).map(([name, value]) => ({ name, value })),
              resources: {
                limits: {
                  ...(r.gpus ? { "nvidia.com/gpu": r.gpus } : {}),
                  ...(r.cpus ? { cpu: String(r.cpus) } : {}),
                  ...(r.memGb ? { memory: Math.ceil(r.memGb * 1024) + "Mi" } : {}),
                },
              },
              volumeMounts: [
                { name: "work", mountPath: dir, subPath: name.slice(3) + "/work" },
                { name: "work", mountPath: "/mulagent-job.log", subPath: name.slice(3) + "/log" },
              ],
            },
          ],
          volumes: [{ name: "work", persistentVolumeClaim: { claimName: c.workspaceClaim } }],
        },
      },
    },
  };
}
