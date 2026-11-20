import type {
  BackendDescription,
  BackendId,
  BranchId,
  FindingId,
  GateId,
  ResearchProjectId,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

import type { ResearchWorkspaceSnapshot } from "./client";

export type FleetSessionGroupKey = "waiting-question" | "ready-review" | "running" | "done";

export interface FleetSessionEntry {
  readonly id: string;
  readonly group: FleetSessionGroupKey;
  readonly researchProjectId: ResearchProjectId;
  readonly projectTitle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly backendLabel: string;
  readonly detail: string;
  readonly updatedAt: string;
  readonly target:
    | {
        readonly kind: "thread";
        readonly researchProjectId: ResearchProjectId;
        readonly gateId?: GateId;
      }
    | {
        readonly kind: "branch";
        readonly researchProjectId: ResearchProjectId;
        readonly branchId: BranchId;
      }
    | {
        readonly kind: "gate";
        readonly researchProjectId: ResearchProjectId;
        readonly findingId: FindingId;
      };
}

export interface GroupedFleetSessions {
  readonly "waiting-question": ReadonlyArray<FleetSessionEntry>;
  readonly "ready-review": ReadonlyArray<FleetSessionEntry>;
  readonly running: ReadonlyArray<FleetSessionEntry>;
  readonly done: ReadonlyArray<FleetSessionEntry>;
}

export interface BackendUtilizationRow {
  readonly backendId: BackendId;
  readonly label: string;
  readonly kind: BackendDescription["kind"];
  readonly accelerator: string | undefined;
  readonly gpusInUse: number;
  readonly gpusTotal: number;
  readonly queueDepth: number;
  readonly activeJobs: number;
  readonly usdPerGpuHour: number;
  readonly preemptible: boolean;
  readonly healthy: boolean;
}

export interface FleetMetricsSummary {
  readonly experimentsPerHour: number;
  readonly totalGpusInUse: number;
  readonly totalGpusCapacity: number;
  readonly spendTodayUsd: number;
  readonly gpuHoursToday: number;
  readonly llmUsdToday: number;
  readonly backendUtilization: ReadonlyArray<BackendUtilizationRow>;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function primaryBackendLabelFor(snapshot: ResearchWorkspaceSnapshot): string {
  const firstJobBackend = snapshot.jobs[0]?.backendId;
  if (firstJobBackend) {
    const found = snapshot.backends.find((backend) => backend.id === firstJobBackend);
    if (found) return found.label;
  }
  const firstRunBackend = snapshot.runs.find((run) => run.backendId !== undefined)?.backendId;
  if (firstRunBackend) {
    const found = snapshot.backends.find((backend) => backend.id === firstRunBackend);
    if (found) return found.label;
  }
  return snapshot.backends[0]?.label ?? "local";
}

export function groupFleetSessions(
  snapshots: ReadonlyArray<ResearchWorkspaceSnapshot>,
  resolve: MessageResolver = m,
): GroupedFleetSessions {
  const waitingQuestion: FleetSessionEntry[] = [];
  const readyReview: FleetSessionEntry[] = [];
  const running: FleetSessionEntry[] = [];
  const done: FleetSessionEntry[] = [];

  for (const snapshot of snapshots) {
    const projectId = snapshot.project.id;
    const projectTitle = snapshot.project.title;
    const defaultBackend = primaryBackendLabelFor(snapshot);

    const openQuestions = snapshot.gates.filter(
      (gate) => gate.status === "open" && gate.kind !== "claims",
    );
    for (const gate of openQuestions) {
      waitingQuestion.push({
        id: `gate:${gate.id}`,
        group: "waiting-question",
        researchProjectId: projectId,
        projectTitle,
        title: gate.title,
        subtitle: snapshot.project.workflow,
        backendLabel: defaultBackend,
        detail: resolve(msg("{count} options"), { count: gate.options.length }),
        updatedAt: gate.createdAt,
        target: { kind: "thread", researchProjectId: projectId, gateId: gate.id },
      });
    }

    const reviewFindings = snapshot.findings.filter(
      (finding) => finding.status === "critic-passed",
    );
    for (const finding of reviewFindings) {
      const landedCount = finding.critic.filter((attack) => attack.landed).length;
      readyReview.push({
        id: `finding:${finding.id}`,
        group: "ready-review",
        researchProjectId: projectId,
        projectTitle,
        title: resolve(msg("Claim {label}"), { label: finding.label }),
        subtitle: finding.scope,
        backendLabel: defaultBackend,
        detail: resolve(msg("{runs} runs · {landed} attacks landed"), {
          runs: finding.evidenceRunIds.length,
          landed: landedCount,
        }),
        updatedAt: snapshot.project.updatedAt,
        target: { kind: "gate", researchProjectId: projectId, findingId: finding.id },
      });
    }

    const activeBranches = snapshot.branches.filter((branch) => branch.status === "running");
    for (const branch of activeBranches) {
      const branchRuns = snapshot.runs.filter((run) => run.branchId === branch.id);
      const telemetry = snapshot.branchLiveTelemetry[branch.id];
      const detail = telemetry
        ? resolve(msg("run {run}/{total} · eta {eta}m"), {
            run: telemetry.runIndex,
            total: telemetry.totalBudgetRuns,
            eta: telemetry.etaMinutes,
          })
        : resolve(msg("{rung} rung · {runs} runs"), {
            rung: branch.rung,
            runs: branchRuns.length,
          });
      const branchBackendId = branchRuns.find((run) => run.backendId !== undefined)?.backendId;
      const backendLabel =
        (branchBackendId
          ? snapshot.backends.find((backend) => backend.id === branchBackendId)?.label
          : undefined) ?? defaultBackend;

      running.push({
        id: `branch:${branch.id}`,
        group: "running",
        researchProjectId: projectId,
        projectTitle,
        title: `${branch.label} · ${branch.title}`,
        subtitle: branch.gitBranch ?? branch.rung,
        backendLabel,
        detail,
        updatedAt: snapshot.project.updatedAt,
        target: { kind: "branch", researchProjectId: projectId, branchId: branch.id },
      });
    }

    const hasActiveWork =
      openQuestions.length > 0 || reviewFindings.length > 0 || activeBranches.length > 0;
    if (!hasActiveWork) {
      done.push({
        id: `project:${projectId}`,
        group: "done",
        researchProjectId: projectId,
        projectTitle,
        title: snapshot.project.goal.slice(0, 88),
        subtitle: snapshot.project.workflow,
        backendLabel: defaultBackend,
        detail: resolve(msg("{runs} runs · {hours} GPU-h"), {
          runs: snapshot.runs.length,
          hours: snapshot.project.spent.gpuHours.toFixed(1),
        }),
        updatedAt: snapshot.project.updatedAt,
        target: { kind: "thread", researchProjectId: projectId },
      });
    }
  }

  return {
    "waiting-question": waitingQuestion,
    "ready-review": readyReview,
    running,
    done,
  };
}

export function computeFleetMetrics(
  snapshots: ReadonlyArray<ResearchWorkspaceSnapshot>,
  backends: ReadonlyArray<BackendDescription>,
  nowMs: number,
): FleetMetricsSummary {
  const backendMap = new Map<BackendId, BackendDescription>();
  for (const backend of backends) {
    backendMap.set(backend.id, backend);
  }
  for (const snapshot of snapshots) {
    for (const backend of snapshot.backends) {
      if (!backendMap.has(backend.id)) {
        backendMap.set(backend.id, backend);
      }
    }
  }

  const activeJobsByBackend = new Map<BackendId, number>();
  let recentRunsCount = 0;
  let earliestRecentRunMs = nowMs;
  let gpuHoursToday = 0;
  let llmUsdToday = 0;
  let computeUsdToday = 0;

  const dayStartMs = nowMs - MS_PER_DAY;

  for (const snapshot of snapshots) {
    for (const job of snapshot.jobs) {
      if (job.state === "running" || job.state === "queued") {
        activeJobsByBackend.set(job.backendId, (activeJobsByBackend.get(job.backendId) ?? 0) + 1);
      }
    }
    for (const run of snapshot.runs) {
      const createdMs = Date.parse(run.createdAt);
      if (Number.isNaN(createdMs) || createdMs < dayStartMs || createdMs > nowMs + MS_PER_HOUR) {
        continue;
      }
      recentRunsCount += 1;
      if (createdMs < earliestRecentRunMs) {
        earliestRecentRunMs = createdMs;
      }
      gpuHoursToday += run.gpuHours;
      llmUsdToday += run.llmUsd;
      const rate = run.backendId ? (backendMap.get(run.backendId)?.usdPerGpuHour ?? 0) : 0;
      computeUsdToday += run.gpuHours * rate;
    }
  }

  const elapsedHours = Math.max(1, (nowMs - earliestRecentRunMs) / MS_PER_HOUR);
  const experimentsPerHour =
    recentRunsCount === 0 ? 0 : Number((recentRunsCount / elapsedHours).toFixed(1));

  const backendUtilization: BackendUtilizationRow[] = [];
  let totalGpusInUse = 0;
  let totalGpusCapacity = 0;

  for (const backend of backendMap.values()) {
    const gpusFree = backend.gpusFree ?? 0;
    const gpusInUse = Math.max(0, backend.gpusTotal - gpusFree);
    totalGpusInUse += gpusInUse;
    totalGpusCapacity += backend.gpusTotal;
    backendUtilization.push({
      backendId: backend.id,
      label: backend.label,
      kind: backend.kind,
      accelerator: backend.accelerator,
      gpusInUse,
      gpusTotal: backend.gpusTotal,
      queueDepth: backend.queueDepth ?? 0,
      activeJobs: activeJobsByBackend.get(backend.id) ?? 0,
      usdPerGpuHour: backend.usdPerGpuHour,
      preemptible: backend.preemptible,
      healthy: backend.healthy,
    });
  }

  return {
    experimentsPerHour,
    totalGpusInUse,
    totalGpusCapacity,
    spendTodayUsd: Number((computeUsdToday + llmUsdToday).toFixed(2)),
    gpuHoursToday: Number(gpuHoursToday.toFixed(1)),
    llmUsdToday: Number(llmUsdToday.toFixed(2)),
    backendUtilization,
  };
}
