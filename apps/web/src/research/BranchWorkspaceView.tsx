import type { BranchId, ResearchProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T, useGT, useMessages, Var } from "gt-react";
import {
  ArrowUpIcon,
  FileCode2Icon,
  FileTextIcon,
  FolderIcon,
  LockIcon,
  TerminalIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";

import { BestSoFarChart } from "./BestSoFarChart";
import { latestMetricValueByRun } from "./chart.logic";
import type { BranchWorkspaceExtras, ResearchWorkspaceSnapshot } from "./client";
import {
  APPROVAL_MODE_LABELS,
  BRANCH_STATUS_LABELS,
  branchStatusBadgeVariant,
  formatMetricValue,
  RUN_VERDICT_LABELS,
  runVerdictBadgeVariant,
} from "./researchPresentation";
import { getResearchClient, useResearchSnapshot } from "./researchStore";

interface BranchWorkspaceViewProps {
  readonly researchProjectId: ResearchProjectId;
  readonly branchId: BranchId;
}

type MobilePane = "doc" | "agent" | "files";

function defaultWorkspaceExtras(branchLabel: string, branchTitle: string): BranchWorkspaceExtras {
  const slug = `results/branch-${branchLabel.toLowerCase()}.md`;
  return {
    docPath: slug,
    docUpdatedLabel: "agent",
    agentPrompt: branchTitle,
    thoughtDurationLabel: "6s",
    integritySummary: "All completed runs recorded with immutable spec hash.",
    sessions: [],
    files: [{ path: slug, name: `branch-${branchLabel.toLowerCase()}.md`, folder: "results" }],
    pendingEdit: null,
    agentNotes: [],
  };
}

function BranchWorkspaceBody({
  snapshot,
  branchId,
}: {
  readonly snapshot: ResearchWorkspaceSnapshot;
  readonly branchId: BranchId;
}) {
  const gt = useGT();
  const m = useMessages();
  const client = getResearchClient();

  const branch =
    snapshot.branches.find((candidate) => candidate.id === branchId) ?? snapshot.branches[0];
  const resolvedBranchId = branch?.id ?? branchId;
  const spec = snapshot.specsByBranchId[resolvedBranchId] ?? {
    hypothesis: snapshot.project.goal,
    metric: "success_h32",
    higherIsBetter: true,
    baseline: undefined,
    seeds: [0, 1, 2],
    editable: ["models/main.py"],
    command: "uv run train.py",
    resources: { gpus: 1, hours: 4 },
  };
  const extras =
    snapshot.branchWorkspaces[resolvedBranchId] ??
    defaultWorkspaceExtras(branch?.label ?? "A", branch?.title ?? snapshot.project.title);
  const telemetry = snapshot.branchLiveTelemetry[resolvedBranchId];

  const [activeFilePath, setActiveFilePath] = useState(extras.docPath);
  const [selectedSessionId, setSelectedSessionId] = useState(extras.sessions[0]?.id ?? "");
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [constraintText, setConstraintText] = useState("");
  const [mobilePane, setMobilePane] = useState<MobilePane>("doc");

  const metricValues = latestMetricValueByRun(snapshot.metrics, spec.metric);
  const branchRuns = snapshot.runs
    .filter(
      (run) =>
        run.branchId === resolvedBranchId &&
        (metricValues.has(run.id) || run.verdict === "crash" || run.status === "running"),
    )
    .sort((a, b) => b.number - a.number);
  const allBranchRuns =
    branchRuns.length > 0
      ? branchRuns
      : snapshot.runs
          .filter((run) => run.branchId === resolvedBranchId)
          .sort((a, b) => b.number - a.number);

  const visibleTableRuns = showAllRuns ? allBranchRuns : allBranchRuns.slice(0, 6);
  const activeFile = extras.files.find((file) => file.path === activeFilePath) ?? extras.files[0];
  const isResultsDoc = activeFilePath === extras.docPath;

  const folders = new Map<string, Array<(typeof extras.files)[number]>>();
  for (const file of extras.files) {
    const key = file.folder || ".";
    const existing = folders.get(key) ?? [];
    existing.push(file);
    folders.set(key, existing);
  }

  const handleSendConstraint = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = constraintText.trim();
    if (!trimmed) return;
    await client.postMessage(snapshot.project.id, trimmed, resolvedBranchId);
    setConstraintText("");
  };

  if (!branch) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        <T>No branch found for this research project.</T>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 lg:hidden">
        <ToggleGroup
          value={[mobilePane]}
          onValueChange={(next) => {
            const first = next[0];
            if (first === "doc" || first === "agent" || first === "files") {
              setMobilePane(first);
            }
          }}
        >
          <Toggle value="doc">
            <T>Results</T>
          </Toggle>
          <Toggle value="agent">
            <T>Agent</T>
          </Toggle>
          <Toggle value="files">
            <T>Sessions & files</T>
          </Toggle>
        </ToggleGroup>
        <Badge size="sm" variant={branchStatusBadgeVariant(branch.status)}>
          {m(BRANCH_STATUS_LABELS[branch.status])}
        </Badge>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav
          aria-label={gt("Sessions and files")}
          className={cn(
            "min-h-0 shrink-0 overflow-y-auto border-border p-3 text-sm lg:block lg:w-60 lg:border-r",
            mobilePane === "files" ? "flex-1" : "hidden",
          )}
        >
          <div className="flex items-center justify-between px-2 pb-2 text-xs text-muted-foreground">
            <span>
              <T>Branches</T>
            </span>
            <Link
              to="/research/$researchProjectId/lineage"
              params={{ researchProjectId: snapshot.project.id }}
              className="hover:text-foreground"
            >
              <T>Graph</T>
            </Link>
          </div>
          <div className="mb-3 flex flex-col gap-1">
            {snapshot.branches.map((candidate) => (
              <Link
                key={candidate.id}
                to="/research/$researchProjectId/branches/$branchId"
                params={{ researchProjectId: snapshot.project.id, branchId: candidate.id }}
                className={cn(
                  "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs",
                  candidate.id === branch.id
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span className="truncate">
                  {candidate.label} · {candidate.title}
                </span>
                <span className="shrink-0">{candidate.rung}</span>
              </Link>
            ))}
          </div>

          <Separator className="my-2" />

          <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
            <span>
              <T>Sessions</T>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {extras.sessions.length > 0 ? (
              extras.sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedSessionId(session.id)}
                  className={cn(
                    "flex flex-col rounded-lg px-2.5 py-2 text-left transition-colors",
                    selectedSessionId === session.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2 text-xs font-medium">
                    <span className="truncate text-foreground">{session.title}</span>
                    <span className="shrink-0 text-muted-foreground">{session.ageLabel}</span>
                  </div>
                  <span
                    className={cn(
                      "mt-0.5 text-xs",
                      session.status === "running"
                        ? "text-info-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {session.detail}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                <T>
                  Active rung: <Var>{branch.rung}</Var>
                </T>
              </p>
            )}
          </div>

          <Separator className="my-3" />

          <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
            <span>
              <T>Files</T>
            </span>
            <Badge size="sm" variant="outline">
              <T>spec</T>
            </Badge>
          </div>
          <div className="mt-1 flex flex-col gap-1 text-xs">
            {[...folders.entries()].map(([folder, files]) => (
              <div key={folder} className="flex flex-col gap-0.5">
                {folder !== "." ? (
                  <div className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground">
                    <FolderIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span>{folder}</span>
                  </div>
                ) : null}
                {files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => {
                      setActiveFilePath(file.path);
                      setMobilePane("doc");
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-md py-1.5 pr-2 text-left",
                      folder === "." ? "pl-2" : "pl-6",
                      activeFilePath === file.path
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    {file.path.endsWith(".md") ? (
                      <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    ) : (
                      <FileCode2Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    {file.modified ? (
                      <span className="font-mono text-warning-foreground">M</span>
                    ) : null}
                    {file.locked ? (
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                        <LockIcon aria-hidden="true" className="size-3" />
                        <T>locked</T>
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col border-border lg:flex lg:border-r",
            mobilePane === "doc" ? "flex" : "hidden",
          )}
        >
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-2 text-xs">
            {extras.files.slice(0, 4).map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setActiveFilePath(file.path)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 transition-colors",
                  activeFilePath === file.path
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {file.name}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            {isResultsDoc ? (
              <article className="flex max-w-3xl flex-col gap-5">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {extras.docPath} · {extras.docUpdatedLabel}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-foreground">
                      <T>
                        Branch <Var>{branch.label}</Var> · <Var>{branch.title}</Var>
                      </T>
                    </h1>
                    <Badge size="sm" variant={branchStatusBadgeVariant(branch.status)}>
                      {m(BRANCH_STATUS_LABELS[branch.status])}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    <T>
                      Edits only{" "}
                      <code className="font-mono text-foreground">
                        <Var>{spec.editable.join(", ")}</Var>
                      </code>
                      .
                    </T>{" "}
                    {spec.lockedEval ? (
                      <T>
                        <code className="font-mono text-foreground">
                          <Var>{spec.lockedEval.path}</Var>
                        </code>{" "}
                        locked at{" "}
                        <code className="font-mono text-foreground">
                          <Var>{spec.lockedEval.commit}</Var>
                        </code>
                        .
                      </T>
                    ) : null}{" "}
                    {spec.baseline !== undefined ? (
                      <T>
                        Baseline <Var>{formatMetricValue(spec.baseline)}</Var>.
                      </T>
                    ) : null}{" "}
                    {spec.stopRule ? spec.stopRule : null}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-card p-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">
                          <T>Run</T>
                        </TableHead>
                        <TableHead>
                          <T>Change</T>
                        </TableHead>
                        <TableHead className="text-right">{spec.metric}</TableHead>
                        <TableHead className="w-24 text-right">
                          <T>Verdict</T>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleTableRuns.map((run) => {
                        const metricVal = metricValues.get(run.id);
                        return (
                          <TableRow key={run.id}>
                            <TableCell>
                              <span className="font-mono text-muted-foreground tabular-nums">
                                {run.number}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-normal">
                              <span className="text-foreground">{run.change}</span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="font-mono tabular-nums">
                                {run.verdict === "crash" ? "-" : formatMetricValue(metricVal)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge size="sm" variant={runVerdictBadgeVariant(run.verdict)}>
                                {m(RUN_VERDICT_LABELS[run.verdict])}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {allBranchRuns.length > 6 ? (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        onClick={() => setShowAllRuns((prev) => !prev)}
                      >
                        {showAllRuns ? (
                          <T>Show recent runs</T>
                        ) : (
                          <T>
                            Show all <Var>{allBranchRuns.length}</Var> runs
                          </T>
                        )}
                      </Button>
                    </div>
                  ) : null}
                </div>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    <T>Best so far</T>
                  </h2>
                  <BestSoFarChart
                    runs={allBranchRuns}
                    metrics={snapshot.metrics}
                    spec={spec}
                    scopeLabel={branch.rung}
                  />
                </section>
              </article>
            ) : (
              <div className="flex max-w-3xl flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-xs text-foreground">{activeFile?.path}</code>
                  {activeFile?.locked ? (
                    <Badge size="sm" variant="warning">
                      <T>Locked by frozen spec</T>
                    </Badge>
                  ) : null}
                </div>
                <pre className="overflow-x-auto rounded-xl border border-border bg-code p-4 font-mono text-xs leading-relaxed text-foreground">
                  {activeFile?.preview ??
                    gt("File preview is populated from the workspace checkout.")}
                </pre>
              </div>
            )}
          </div>
        </main>

        <aside
          aria-label={gt("Branch agent panel")}
          className={cn(
            "flex min-h-0 shrink-0 flex-col lg:flex lg:w-88",
            mobilePane === "agent" ? "flex-1" : "hidden",
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium text-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                branch.status === "running" ? "bg-info" : "bg-muted-foreground",
              )}
            />
            <span>{extras.sessions[0]?.title ?? branch.title}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {branch.gitBranch ?? branch.label}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-xs leading-relaxed">
            <div className="rounded-xl bg-secondary p-3 text-secondary-foreground">
              {extras.agentPrompt}
            </div>

            <p className="text-muted-foreground">
              <T>
                Thought for <Var>{extras.thoughtDurationLabel}</Var>
              </T>
            </p>

            <div className="flex flex-col gap-2 text-muted-foreground">
              {allBranchRuns.slice(0, 3).map((run) => {
                const value = metricValues.get(run.id);
                return (
                  <div key={run.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <T>
                        Run <Var>{run.number}</Var> · <Var>{run.change}</Var>
                      </T>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono tabular-nums",
                        run.verdict === "keep"
                          ? "text-success-foreground"
                          : run.verdict === "crash"
                            ? "text-destructive-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {m(RUN_VERDICT_LABELS[run.verdict])}{" "}
                      {value !== undefined ? formatMetricValue(value) : ""}
                    </span>
                  </div>
                );
              })}

              <div className="flex items-center gap-2">
                <TerminalIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <code className="truncate font-mono text-foreground">{spec.command}</code>
              </div>
            </div>

            {telemetry ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 font-mono text-2xs text-muted-foreground tabular-nums">
                <span>
                  <T>
                    step <Var>{telemetry.step}</Var>/<Var>{telemetry.totalSteps}</Var>
                  </T>
                </span>
                <span>
                  <T>
                    seed <Var>{telemetry.seedIndex}</Var>/<Var>{telemetry.totalSeeds}</Var>
                  </T>
                </span>
                <span>
                  <T>
                    <Var>{telemetry.gpus}</Var> GPU
                  </T>
                </span>
                <span className="ml-auto text-foreground">
                  <T>
                    eta <Var>{telemetry.etaMinutes}</Var>m
                  </T>
                </span>
              </div>
            ) : null}

            <p className="text-muted-foreground">
              {extras.integritySummary}{" "}
              <span className="font-medium text-success-foreground">
                <T>Trusted.</T>
              </span>
            </p>

            {extras.agentNotes.map((note, idx) => (
              <div
                key={`${resolvedBranchId}-note-${note}-${idx === 0 ? "first" : "next"}`}
                className="self-end rounded-xl bg-message px-3 py-2 text-message-foreground"
              >
                {note}
              </div>
            ))}
          </div>

          {extras.pendingEdit ? (
            <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              <span>
                <T>
                  <Var>{extras.pendingEdit.filesChanged}</Var> file changed
                </T>
              </span>
              <span className="font-mono text-diff-addition-foreground tabular-nums">
                +{extras.pendingEdit.additions}
              </span>
              <span className="font-mono text-diff-deletion-foreground tabular-nums">
                -{extras.pendingEdit.deletions}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="ghost-muted"
                  onClick={() =>
                    void client.resolvePendingEdit(snapshot.project.id, resolvedBranchId, "undo")
                  }
                >
                  <T>Undo</T>
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  onClick={() =>
                    void client.resolvePendingEdit(snapshot.project.id, resolvedBranchId, "keep")
                  }
                >
                  <T>Keep</T>
                </Button>
              </div>
            </div>
          ) : null}

          <form onSubmit={handleSendConstraint} className="p-3 pt-1">
            <Label htmlFor="branch-constraint-input" className="sr-only">
              <T>Add a constraint</T>
            </Label>
            <div className="rounded-xl border border-border bg-card p-2.5">
              <Textarea
                id="branch-constraint-input"
                unstyled
                rows={2}
                value={constraintText}
                onChange={(event) => setConstraintText(event.target.value)}
                placeholder={gt("Add a constraint, or let the loop continue")}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{m(APPROVAL_MODE_LABELS[snapshot.project.approvalMode])}</span>
                {telemetry ? (
                  <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                    <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                    <T>
                      run <Var>{telemetry.runIndex}</Var> of <Var>{telemetry.totalBudgetRuns}</Var>{" "}
                      · <Var>{telemetry.elapsedLabel}</Var>
                    </T>
                  </span>
                ) : null}
                <Button
                  type="submit"
                  size="icon-xs"
                  variant="secondary"
                  aria-label={gt("Send constraint")}
                  className="ml-auto"
                  disabled={constraintText.trim().length === 0}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
              </div>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}

export function BranchWorkspaceView({ researchProjectId, branchId }: BranchWorkspaceViewProps) {
  const resource = useResearchSnapshot(researchProjectId);

  if (resource.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        <T>Loading branch workspace…</T>
      </div>
    );
  }

  if (resource.status === "error" || !resource.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive-foreground">
        <T>
          Could not load branch workspace: <Var>{resource.error ?? branchId}</Var>
        </T>
      </div>
    );
  }

  return (
    <BranchWorkspaceBody
      key={`${resource.data.project.id}:${branchId}`}
      snapshot={resource.data}
      branchId={branchId}
    />
  );
}
