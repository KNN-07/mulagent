import { Link } from "@tanstack/react-router";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  ActivityIcon,
  CheckCircle2Icon,
  CpuIcon,
  DollarSignIcon,
  FlaskConicalIcon,
  HelpCircleIcon,
  PlayCircleIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { cn } from "~/lib/utils";

import {
  computeFleetMetrics,
  groupFleetSessions,
  type FleetSessionEntry,
  type FleetSessionGroupKey,
} from "./fleet.logic";
import {
  formatShortRelativeAge,
  projectMonogram,
  type ResearchBadgeVariant,
} from "./researchPresentation";
import { useResearchBackends, useResearchFleet } from "./researchStore";

interface FleetViewProps {
  readonly onOpenNewProject: () => void;
}

const GROUP_META: ReadonlyArray<{
  readonly key: FleetSessionGroupKey;
  readonly label: string;
  readonly badgeVariant: ResearchBadgeVariant;
  readonly dotClass: string;
}> = [
  {
    key: "waiting-question",
    label: msg("Waiting on a question"),
    badgeVariant: "warning",
    dotClass: "bg-warning",
  },
  {
    key: "ready-review",
    label: msg("Ready for review"),
    badgeVariant: "success",
    dotClass: "bg-success",
  },
  {
    key: "running",
    label: msg("Running", { $context: "research fleet section heading" }),
    badgeVariant: "info",
    dotClass: "bg-info",
  },
  {
    key: "done",
    label: msg("Done", { $context: "research fleet section heading" }),
    badgeVariant: "secondary",
    dotClass: "bg-muted-foreground",
  },
];

function FleetSessionRow({
  entry,
  referenceMs,
  dotClass,
}: {
  readonly entry: FleetSessionEntry;
  readonly referenceMs: number;
  readonly dotClass: string;
}) {
  const rowContent = (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:bg-accent/40">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-2xs font-semibold text-secondary-foreground"
      >
        {projectMonogram(entry.projectTitle)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dotClass)} />
          <span className="truncate text-sm font-medium text-foreground">{entry.title}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{entry.projectTitle}</span>
          <span>·</span>
          <span>{entry.backendLabel}</span>
          <span>·</span>
          <span className="truncate">{entry.subtitle}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right text-xs">
        <span className="font-mono text-foreground tabular-nums">{entry.detail}</span>
        <span className="text-muted-foreground tabular-nums">
          {formatShortRelativeAge(entry.updatedAt, referenceMs)}
        </span>
      </div>
    </div>
  );

  if (entry.target.kind === "branch") {
    return (
      <Link
        to="/research/$researchProjectId/branches/$branchId"
        params={{
          researchProjectId: entry.target.researchProjectId,
          branchId: entry.target.branchId,
        }}
        className="block"
      >
        {rowContent}
      </Link>
    );
  }

  if (entry.target.kind === "gate") {
    return (
      <Link
        to="/research/$researchProjectId/gates/$findingId"
        params={{
          researchProjectId: entry.target.researchProjectId,
          findingId: entry.target.findingId,
        }}
        className="block"
      >
        {rowContent}
      </Link>
    );
  }

  return (
    <Link
      to="/research/$researchProjectId"
      params={{ researchProjectId: entry.target.researchProjectId }}
      className="block"
    >
      {rowContent}
    </Link>
  );
}

export function FleetView({ onOpenNewProject }: FleetViewProps) {
  const gt = useGT();
  const m = useMessages();
  const [fallbackNowMs] = useState(() => Date.now());
  const fleetResource = useResearchFleet();
  const backendsResource = useResearchBackends();

  if (fleetResource.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        <T>Loading research fleet…</T>
      </div>
    );
  }

  if (fleetResource.status === "error" || !fleetResource.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive-foreground">
        <T>
          Could not load research fleet: <Var>{fleetResource.error ?? ""}</Var>
        </T>
      </div>
    );
  }

  const snapshots = fleetResource.data;
  const backends = backendsResource.data ?? [];

  let referenceMs = fallbackNowMs;
  for (const snapshot of snapshots) {
    const parsed = Date.parse(snapshot.project.updatedAt);
    if (!Number.isNaN(parsed) && parsed > referenceMs) {
      referenceMs = parsed;
    }
  }
  if (snapshots.length > 0) {
    const latestSnapshotMs = Math.max(
      ...snapshots
        .map((snapshot) => Date.parse(snapshot.project.updatedAt))
        .filter(Number.isFinite),
    );
    if (Number.isFinite(latestSnapshotMs)) {
      referenceMs = latestSnapshotMs;
    }
  }

  const grouped = groupFleetSessions(snapshots, m);
  const metrics = computeFleetMetrics(snapshots, backends, referenceMs);
  const activeCount =
    grouped.running.length + grouped["waiting-question"].length + grouped["ready-review"].length;

  return (
    <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
      <WorkspacePageContainer width="expanded" className="gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {snapshots.length === 0 ? <T>What should we research?</T> : <T>Research fleet</T>}
            </h1>
            <p className="text-xs text-muted-foreground">
              <T>
                Active autonomous loops, decision gates, claim reviews, and compute backends across
                projects.
              </T>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/" search={{ mode: "coding" }} />}
            >
              <T>Start a coding thread</T>
            </Button>
            <Button size="sm" variant="default" onClick={onOpenNewProject}>
              <PlusIcon aria-hidden="true" />
              <T>New research project</T>
            </Button>
          </div>
        </div>

        <section
          aria-label={gt("Fleet throughput and spend")}
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <div className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ActivityIcon aria-hidden="true" className="size-3.5" />
              <span>
                <T>Experiments / hr</T>
              </span>
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-foreground tabular-nums">
              {metrics.experimentsPerHour.toFixed(1)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              <T>Trailing 24h ledger rate</T>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CpuIcon aria-hidden="true" className="size-3.5" />
              <span>
                <T>GPUs in use</T>
              </span>
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-foreground tabular-nums">
              {metrics.totalGpusInUse} / {metrics.totalGpusCapacity}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              <T>
                Across <Var>{metrics.backendUtilization.length}</Var> backends
              </T>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSignIcon aria-hidden="true" className="size-3.5" />
              <span>
                <T>Spend today</T>
              </span>
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-foreground tabular-nums">
              ${metrics.spendTodayUsd.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              <T>
                <Var>{metrics.gpuHoursToday.toFixed(1)}</Var> GPU-h · $
                <Var>{metrics.llmUsdToday.toFixed(2)}</Var> LLM
              </T>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
              <span>
                <T>Active sessions</T>
              </span>
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-foreground tabular-nums">
              {activeCount}
            </div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              <T>
                <Var>{grouped["waiting-question"].length}</Var> waiting ·{" "}
                <Var>{grouped["ready-review"].length}</Var> review
              </T>
            </div>
          </div>
        </section>

        <section aria-labelledby="fleet-backends-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="fleet-backends-heading" className="text-sm font-semibold text-foreground">
              <T>Compute backends</T>
            </h2>
            <span className="text-xs text-muted-foreground">
              <T>GPU allocation and queue depth</T>
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {metrics.backendUtilization.map((backend) => {
              const pct =
                backend.gpusTotal > 0
                  ? Math.min(100, Math.round((backend.gpusInUse / backend.gpusTotal) * 100))
                  : 0;
              return (
                <div
                  key={backend.backendId}
                  className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{backend.label}</span>
                    <Badge size="sm" variant={backend.healthy ? "success" : "error"}>
                      {backend.healthy ? <T>healthy</T> : <T>degraded</T>}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{backend.accelerator ?? backend.kind}</span>
                    <span className="font-mono text-foreground tabular-nums">
                      <T>
                        <Var>{backend.gpusInUse}</Var>/<Var>{backend.gpusTotal}</Var> GPU
                      </T>
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={gt("{label} GPU utilization", { label: backend.label })}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                  >
                    <div
                      className={cn("h-full rounded-full", pct >= 90 ? "bg-warning" : "bg-info")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground tabular-nums">
                    <span>
                      <T>
                        Queue depth: <Var>{backend.queueDepth}</Var>
                      </T>
                    </span>
                    <span>
                      <T>
                        $<Var>{backend.usdPerGpuHour.toFixed(2)}</Var>/GPU-h
                      </T>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-6">
          {GROUP_META.map((group) => {
            const entries = grouped[group.key];
            const GroupIcon =
              group.key === "waiting-question"
                ? HelpCircleIcon
                : group.key === "ready-review"
                  ? CheckCircle2Icon
                  : group.key === "running"
                    ? PlayCircleIcon
                    : FlaskConicalIcon;

            return (
              <section
                key={group.key}
                aria-labelledby={`fleet-group-${group.key}`}
                className="flex flex-col gap-2.5"
              >
                <div className="flex items-center gap-2">
                  <GroupIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <h2
                    id={`fleet-group-${group.key}`}
                    className="text-sm font-semibold text-foreground"
                  >
                    {m(group.label)}
                  </h2>
                  <Badge size="sm" variant={group.badgeVariant}>
                    {entries.length}
                  </Badge>
                </div>

                {entries.length === 0 ? (
                  <p className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
                    <T>No sessions in this state.</T>
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {entries.map((entry) => (
                      <FleetSessionRow
                        key={entry.id}
                        entry={entry}
                        referenceMs={referenceMs}
                        dotClass={group.dotClass}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </WorkspacePageContainer>
    </div>
  );
}
