import type { BranchId, ResearchProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T, useGT, useMessages, Var } from "gt-react";
import { FileTextIcon, GitForkIcon, MinusCircleIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";

import type { ResearchWorkspaceSnapshot } from "./client";
import { buildLineageGraph, computeBranchStats, type LineageTone } from "./lineage.logic";
import {
  BRANCH_STATUS_LABELS,
  branchStatusBadgeVariant,
  formatMetricValue,
  formatShortRelativeAge,
  LINEAGE_LANE_BG,
  SCALE_RUNG_LABELS,
} from "./researchPresentation";
import { getResearchClient, useResearchSnapshot } from "./researchStore";

interface LineageViewProps {
  readonly researchProjectId: ResearchProjectId;
}

type LineageDisplayMode = "graph" | "list" | "yaml";

const LANE_START_X = 14;
const LANE_STEP_X = 20;
const ROW_SVG_HEIGHT = 52;
const NODE_CENTER_Y = 26;

const LANE_STROKE_CLASS: Record<LineageTone, string> = {
  main: "text-muted-foreground",
  info: "text-info",
  guest: "text-guest",
  muted: "text-border",
  success: "text-success",
  warning: "text-warning",
};

function LineageBody({ snapshot }: { readonly snapshot: ResearchWorkspaceSnapshot }) {
  const gt = useGT();
  const m = useMessages();
  const client = getResearchClient();

  const [mode, setMode] = useState<LineageDisplayMode>("graph");
  const [selectedBranchId, setSelectedBranchId] = useState<BranchId | null>(
    snapshot.branches[0]?.id ?? null,
  );
  const [mutating, setMutating] = useState(false);

  const { lanes, rows } = buildLineageGraph(snapshot.nodes, snapshot.branches);
  const referenceMs = Date.parse(snapshot.project.updatedAt);

  const selectedBranch =
    snapshot.branches.find((candidate) => candidate.id === selectedBranchId) ??
    snapshot.branches[0] ??
    null;

  const selectedBranchStats = selectedBranch
    ? computeBranchStats(
        selectedBranch,
        snapshot.runs,
        snapshot.metrics,
        snapshot.specsByBranchId[selectedBranch.id],
        snapshot.backends,
      )
    : null;

  const selectedBranchLane = selectedBranch
    ? lanes.find((lane) => lane.branchId === selectedBranch.id)
    : undefined;

  const gutterWidth = Math.max(44, LANE_START_X * 2 + Math.max(0, lanes.length - 1) * LANE_STEP_X);
  const defaultFindingId = snapshot.findings[0]?.id;

  const handleFork = async () => {
    if (!selectedBranch || mutating) return;
    setMutating(true);
    const forked = await client.forkBranch(selectedBranch.id);
    setSelectedBranchId(forked.id);
    setMutating(false);
  };

  const handlePrune = async () => {
    if (!selectedBranch || selectedBranch.status === "pruned" || mutating) return;
    setMutating(true);
    await client.pruneBranch(selectedBranch.id);
    setMutating(false);
  };

  return (
    <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pt-4 pb-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {lanes.map((lane) => {
              const isSelected = lane.branchId !== null && lane.branchId === selectedBranch?.id;
              return (
                <button
                  key={lane.id}
                  type="button"
                  disabled={lane.branchId === null}
                  onClick={() => {
                    if (lane.branchId !== null) setSelectedBranchId(lane.branchId);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors",
                    lane.branchId !== null && "cursor-pointer hover:text-foreground",
                    isSelected && "bg-accent font-medium text-foreground",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("h-0.5 w-3 rounded-full", LINEAGE_LANE_BG[lane.tone])}
                  />
                  <span>{lane.title ? `${lane.label} ${lane.title}` : lane.label}</span>
                </button>
              );
            })}
          </div>

          <ToggleGroup
            aria-label={gt("Lineage display mode")}
            value={[mode]}
            onValueChange={(next) => {
              const first = next[0];
              if (first === "graph" || first === "list" || first === "yaml") {
                setMode(first);
              }
            }}
          >
            <Toggle value="graph">
              <T>Graph</T>
            </Toggle>
            <Toggle value="list">
              <T>List</T>
            </Toggle>
            <Toggle value="yaml">{"YAML"}</Toggle>
          </ToggleGroup>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <main className="min-w-0 flex-1">
            {mode === "graph" ? (
              <ol className="m-0 flex list-none flex-col p-0">
                {rows.map((row) => {
                  const isBranchSelected =
                    row.node.branchId !== undefined && row.node.branchId === selectedBranch?.id;
                  const isPruned = row.node.status === "pruned";
                  const nodeX = LANE_START_X + row.laneIndex * LANE_STEP_X;
                  const bridgeY =
                    row.bridgeSpan?.kind === "merge" ? NODE_CENTER_Y + 10 : NODE_CENTER_Y;

                  return (
                    <li key={row.node.id} className="m-0 p-0">
                      <div
                        className={cn(
                          "flex min-h-13 items-center gap-3 rounded-lg pr-2 transition-colors",
                          isBranchSelected ? "bg-accent/55" : "hover:bg-accent/30",
                          isPruned && "text-muted-foreground",
                        )}
                      >
                        <svg
                          width={gutterWidth}
                          height={ROW_SVG_HEIGHT}
                          viewBox={`0 0 ${gutterWidth} ${ROW_SVG_HEIGHT}`}
                          aria-hidden="true"
                          className="shrink-0"
                        >
                          {row.bridgeSpan ? (
                            <line
                              x1={LANE_START_X + row.bridgeSpan.fromLane * LANE_STEP_X}
                              y1={bridgeY}
                              x2={LANE_START_X + row.bridgeSpan.toLane * LANE_STEP_X}
                              y2={bridgeY}
                              stroke="currentColor"
                              strokeWidth={2}
                              className="text-border"
                            />
                          ) : null}

                          {row.activeLanes.map((segment) => {
                            const x = LANE_START_X + segment.laneIndex * LANE_STEP_X;
                            const isMergeChild =
                              row.bridgeSpan?.kind === "merge" && segment.laneIndex > 0;
                            const y1 = segment.top ? 0 : isMergeChild ? bridgeY : NODE_CENTER_Y;
                            const y2 = segment.bottom ? ROW_SVG_HEIGHT : NODE_CENTER_Y;
                            return (
                              <line
                                key={segment.laneIndex}
                                x1={x}
                                y1={y1}
                                x2={x}
                                y2={y2}
                                stroke="currentColor"
                                strokeWidth={2}
                                className={LANE_STROKE_CLASS[segment.tone]}
                              />
                            );
                          })}

                          <circle
                            cx={nodeX}
                            cy={NODE_CENTER_Y}
                            r={row.marker === "hollow" && row.laneIndex === 0 ? 4 : 5}
                            stroke="currentColor"
                            strokeWidth={2}
                            fill={row.marker === "filled" ? "currentColor" : "var(--background)"}
                            className={
                              row.marker === "warning"
                                ? "text-warning"
                                : row.marker === "pruned"
                                  ? "text-muted-foreground"
                                  : LANE_STROKE_CLASS[row.tone]
                            }
                          />
                        </svg>

                        <button
                          type="button"
                          onClick={() => {
                            if (row.node.branchId) {
                              setSelectedBranchId(row.node.branchId);
                            }
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer flex-col py-1.5 text-left"
                        >
                          <span
                            className={cn(
                              "truncate text-sm font-medium",
                              isPruned ? "text-muted-foreground line-through" : "text-foreground",
                            )}
                          >
                            {row.node.title}
                          </span>
                          {row.node.summary ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {row.node.summary}
                            </span>
                          ) : null}
                        </button>

                        {row.node.status === "waiting-gate" && defaultFindingId ? (
                          <Button
                            size="xs"
                            variant="warning-outline"
                            render={
                              <Link
                                to="/research/$researchProjectId/gates/$findingId"
                                params={{
                                  researchProjectId: snapshot.project.id,
                                  findingId: defaultFindingId,
                                }}
                              />
                            }
                          >
                            <T>Review gate</T>
                          </Button>
                        ) : row.node.verdict ? (
                          <span
                            className={cn(
                              "shrink-0 font-mono text-xs tabular-nums",
                              row.node.verdict.includes("keep")
                                ? "text-success-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {row.node.verdict}
                          </span>
                        ) : null}

                        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                          {row.node.status === "waiting-gate"
                            ? "-"
                            : formatShortRelativeAge(row.node.startedAt, referenceMs)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : mode === "list" ? (
              <div className="rounded-xl border border-border bg-card p-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T>Node</T>
                      </TableHead>
                      <TableHead>
                        <T>Branch</T>
                      </TableHead>
                      <TableHead>
                        <T>Status</T>
                      </TableHead>
                      <TableHead className="text-right">
                        <T>Verdict</T>
                      </TableHead>
                      <TableHead className="text-right">
                        <T>Age</T>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const branch = snapshot.branches.find(
                        (candidate) => candidate.id === row.node.branchId,
                      );
                      return (
                        <TableRow
                          key={row.node.id}
                          onClick={() => {
                            if (branch) setSelectedBranchId(branch.id);
                          }}
                        >
                          <TableCell className="whitespace-normal">
                            <div className="font-medium text-foreground">{row.node.title}</div>
                            {row.node.summary ? (
                              <div className="text-muted-foreground">{row.node.summary}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {branch ? `${branch.label} · ${branch.title}` : "main"}
                          </TableCell>
                          <TableCell>
                            <Badge size="sm" variant="secondary">
                              {row.node.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono tabular-nums">
                              {row.node.verdict ?? "-"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-muted-foreground tabular-nums">
                              {formatShortRelativeAge(row.node.startedAt, referenceMs)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-code p-4">
                <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
                  {snapshot.workflowYaml}
                </pre>
              </div>
            )}
          </main>

          {selectedBranch && selectedBranchStats ? (
            <aside
              aria-label={gt("Selected branch details")}
              className="w-full shrink-0 lg:sticky lg:top-4 lg:w-72"
            >
              <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2 text-sm">
                <div className="flex items-center gap-2.5 px-2.5 py-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      LINEAGE_LANE_BG[selectedBranchLane?.tone ?? "info"],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {selectedBranch.label} · {selectedBranch.title}
                  </span>
                  <Badge size="sm" variant={branchStatusBadgeVariant(selectedBranch.status)}>
                    {m(BRANCH_STATUS_LABELS[selectedBranch.status])}
                  </Badge>
                </div>

                <div
                  aria-label={gt("Scale ladder rungs")}
                  className="grid grid-cols-3 gap-1.5 px-2.5 pt-1 pb-2 text-center text-xs"
                >
                  {selectedBranchStats.rungs.map((item) => (
                    <div
                      key={item.rung}
                      className={cn(
                        "rounded-md bg-secondary px-2 py-1.5 font-medium",
                        item.state === "passed" && "text-success-foreground",
                        item.state === "active" && "text-info-foreground",
                        item.state === "pruned" && "text-destructive-foreground line-through",
                        item.state === "pending" && "text-muted-foreground",
                      )}
                    >
                      {m(SCALE_RUNG_LABELS[item.rung])}
                    </div>
                  ))}
                </div>

                <dl className="m-0 flex flex-col gap-1 px-2.5 py-1 text-xs">
                  <div className="flex items-center justify-between gap-2 py-1">
                    <dt className="text-muted-foreground">
                      <T>Best</T>
                    </dt>
                    <dd className="m-0 font-mono text-foreground tabular-nums">
                      {formatMetricValue(selectedBranchStats.bestMetric)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-1">
                    <dt className="text-muted-foreground">
                      <T>Runs</T>
                    </dt>
                    <dd className="m-0 text-foreground tabular-nums">
                      <T>
                        <Var>{selectedBranchStats.totalRuns}</Var> ·{" "}
                        <Var>{selectedBranchStats.keptRuns}</Var> kept
                      </T>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-1">
                    <dt className="text-muted-foreground">
                      <T>Budget</T>
                    </dt>
                    <dd className="m-0 text-foreground tabular-nums">
                      <T>
                        <Var>{selectedBranch.spentGpuHours.toFixed(1)}</Var> /{" "}
                        <Var>{selectedBranch.budgetGpuHours}</Var> GPU-h
                      </T>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-1">
                    <dt className="text-muted-foreground">
                      <T>Backend</T>
                    </dt>
                    <dd className="m-0 text-foreground">{selectedBranchStats.backendLabel}</dd>
                  </div>
                  {selectedBranch.killRule ? (
                    <div className="flex items-center justify-between gap-2 py-1">
                      <dt className="text-muted-foreground">
                        <T>Kill rule</T>
                      </dt>
                      <dd className="m-0 text-right text-foreground">{selectedBranch.killRule}</dd>
                    </div>
                  ) : null}
                </dl>

                <Separator className="my-1.5" />

                <div className="flex flex-col gap-1 p-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start"
                    render={
                      <Link
                        to="/research/$researchProjectId/branches/$branchId"
                        params={{
                          researchProjectId: snapshot.project.id,
                          branchId: selectedBranch.id,
                        }}
                      />
                    }
                  >
                    <FileTextIcon aria-hidden="true" />
                    <T>Open workspace</T>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={mutating}
                    onClick={() => void handleFork()}
                  >
                    <GitForkIcon aria-hidden="true" />
                    <T>Fork a branch from here</T>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost-destructive"
                    className="w-full justify-start"
                    disabled={mutating || selectedBranch.status === "pruned"}
                    onClick={() => void handlePrune()}
                  >
                    <MinusCircleIcon aria-hidden="true" />
                    <T>Prune branch</T>
                  </Button>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LineageView({ researchProjectId }: LineageViewProps) {
  const resource = useResearchSnapshot(researchProjectId);

  if (resource.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        <T>Loading branch lineage…</T>
      </div>
    );
  }

  if (resource.status === "error" || !resource.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive-foreground">
        <T>
          Could not load branch lineage: <Var>{resource.error ?? researchProjectId}</Var>
        </T>
      </div>
    );
  }

  return <LineageBody key={resource.data.project.id} snapshot={resource.data} />;
}
