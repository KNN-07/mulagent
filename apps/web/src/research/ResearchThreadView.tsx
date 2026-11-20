import type { BranchId, ResearchProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T, useGT, useMessages, Var } from "gt-react";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  CpuIcon,
  FileTextIcon,
  GitBranchIcon,
  MinusCircleIcon,
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
import { cn } from "~/lib/utils";

import type { ResearchWorkspaceSnapshot } from "./client";
import { DecisionQuestionCard } from "./DecisionQuestionCard";
import {
  APPROVAL_MODE_LABELS,
  BRANCH_STATUS_LABELS,
  formatShortRelativeAge,
} from "./researchPresentation";
import { getResearchClient, useResearchSnapshot } from "./researchStore";

interface ResearchThreadViewProps {
  readonly researchProjectId: ResearchProjectId;
}

function branchDotClass(status: ResearchWorkspaceSnapshot["branches"][number]["status"]): string {
  if (status === "running") return "bg-info";
  if (status === "promoted") return "bg-success";
  if (status === "pruned") return "border border-muted-foreground bg-transparent";
  if (status === "failed") return "bg-destructive";
  return "bg-muted-foreground";
}

function ThreadBody({ snapshot }: { readonly snapshot: ResearchWorkspaceSnapshot }) {
  const gt = useGT();
  const m = useMessages();
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);

  const client = getResearchClient();
  const projectId = snapshot.project.id;
  const referenceMs = Date.parse(snapshot.project.updatedAt);

  const activeBranches = snapshot.branches.filter((branch) => branch.status === "running");
  const primaryBackend = snapshot.backends[0];
  const gpusInUse = primaryBackend
    ? Math.max(0, primaryBackend.gpusTotal - (primaryBackend.gpusFree ?? 0))
    : 0;
  const questionGates = snapshot.gates.filter((gate) => gate.kind !== "claims");

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    const text = composerText.trim();
    if (!text || sending) return;
    setSending(true);
    await client.postMessage(projectId, text);
    setComposerText("");
    setSending(false);
  };

  return (
    <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-4 pb-10 sm:px-6 lg:flex-row lg:items-start">
        <main className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b border-border pb-2.5 text-xs text-muted-foreground">
              <T>
                Worked for <Var>{snapshot.workedDurationLabel}</Var>
              </T>
              <ChevronRightIcon aria-hidden="true" className="size-3.5" />
            </div>

            <Link
              to="/research/$researchProjectId/lineage"
              params={{ researchProjectId: projectId }}
              className="flex flex-wrap items-center gap-2.5 rounded-lg px-1 py-1 text-sm hover:bg-accent/50"
            >
              <GitBranchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="font-medium text-foreground">
                <T>
                  <Var>{snapshot.branches.length}</Var> branches
                </T>
              </span>
              {activeBranches.length > 0 ? (
                <span className="text-info-foreground">
                  <T>
                    <Var>{activeBranches.length}</Var> working
                  </T>
                </span>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                <T>
                  <Var>{snapshot.runs.length}</Var> runs
                </T>
              </span>
            </Link>

            <div className="flex flex-col gap-3">
              {snapshot.threadEvents.map((event) => {
                if (event.kind === "user-message") {
                  return (
                    <div
                      key={event.id}
                      className="max-w-xl self-end rounded-2xl bg-message px-4 py-2.5 text-sm text-message-foreground"
                    >
                      {event.text}
                    </div>
                  );
                }

                if (event.kind === "agent-message") {
                  return (
                    <p key={event.id} className="text-sm leading-relaxed text-foreground">
                      {event.text}{" "}
                      {event.relatedFindingId ? (
                        <Link
                          to="/research/$researchProjectId/gates/$findingId"
                          params={{
                            researchProjectId: projectId,
                            findingId: event.relatedFindingId,
                          }}
                          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                        >
                          <T>Review it</T>
                        </Link>
                      ) : null}
                    </p>
                  );
                }

                if (event.kind === "file-edit") {
                  return (
                    <div
                      key={event.id}
                      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                    >
                      <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
                      <span>
                        <T>Edited</T>
                      </span>
                      <code className="font-mono text-foreground">{event.path}</code>
                      <span className="font-mono text-diff-addition-foreground tabular-nums">
                        +{event.additions}
                      </span>
                      <span className="font-mono text-diff-deletion-foreground tabular-nums">
                        -{event.deletions}
                      </span>
                    </div>
                  );
                }

                if (event.kind === "command-run") {
                  return (
                    <div
                      key={event.id}
                      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                    >
                      <TerminalIcon aria-hidden="true" className="size-3.5 shrink-0" />
                      <span>
                        <T>Ran</T>
                      </span>
                      <code className="font-mono text-foreground">{event.command}</code>
                      <span className="ml-auto font-mono tabular-nums">{event.durationLabel}</span>
                    </div>
                  );
                }

                if (event.kind === "lean-proved") {
                  return (
                    <div
                      key={event.id}
                      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                    >
                      <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-success" />
                      <span>
                        <T>Proved</T>
                      </span>
                      <code className="font-mono text-foreground">{event.claimName}</code>
                      <span>
                        <T>in Lean</T>
                      </span>
                      <span className="ml-auto font-mono tabular-nums">{event.durationLabel}</span>
                    </div>
                  );
                }

                return (
                  <div
                    key={event.id}
                    className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                  >
                    <MinusCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span>
                      <T>Pruned</T>
                    </span>
                    <span className="text-foreground">{event.branchLabel}</span>
                    <span>· {event.detail}</span>
                  </div>
                );
              })}
            </div>

            {snapshot.horizonSummary.length > 0 ? (
              <div className="rounded-xl border border-border bg-card p-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T>Horizon</T>
                      </TableHead>
                      <TableHead className="text-right">
                        <T>Latent</T>
                      </TableHead>
                      <TableHead className="text-right">
                        <T>Recurrent</T>
                      </TableHead>
                      <TableHead className="text-right">
                        <T>Delta (pp)</T>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshot.horizonSummary.map((row) => (
                      <TableRow key={row.horizon}>
                        <TableCell>
                          <span className="font-mono tabular-nums">{row.horizon}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-mono tabular-nums">
                            {row.latentValue.toFixed(1)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-mono tabular-nums">
                            {row.baselineValue.toFixed(1)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={cn(
                              "font-mono tabular-nums",
                              row.significant ? "text-success-foreground" : "text-muted-foreground",
                            )}
                          >
                            {row.significant ? (
                              `+${row.deltaPp.toFixed(1)}`
                            ) : (
                              <T>
                                +<Var>{row.deltaPp.toFixed(1)}</Var> · noise
                              </T>
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            {questionGates.map((gate) => (
              <DecisionQuestionCard
                key={gate.id}
                gate={gate}
                onAnswer={async (optionIds, note) => {
                  await client.answerGate(gate.id, optionIds, note);
                }}
                onSkip={async () => {
                  await client.skipGate(gate.id);
                }}
              />
            ))}
          </div>

          <form onSubmit={handleSend} className="mt-2 flex flex-col gap-2">
            <Label htmlFor="research-thread-composer" className="sr-only">
              <T>Send instructions to the research loop</T>
            </Label>
            <div className="rounded-2xl border border-border bg-card p-3">
              <Textarea
                id="research-thread-composer"
                unstyled
                rows={2}
                value={composerText}
                onChange={(event) => setComposerText(event.target.value)}
                placeholder={gt("Steer the research loop, add a constraint, or ask about a run")}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  <T>
                    Workflow: <Var>{snapshot.project.workflow}</Var>
                  </T>
                </span>
                <div className="flex items-center gap-2">
                  <Badge size="sm" variant="secondary">
                    {m(APPROVAL_MODE_LABELS[snapshot.project.approvalMode])}
                  </Badge>
                  <Button
                    type="submit"
                    size="icon-sm-pill"
                    variant="secondary"
                    aria-label={gt("Send message")}
                    disabled={sending || composerText.trim().length === 0}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground tabular-nums">
              {primaryBackend ? <span>{primaryBackend.label}</span> : null}
              <span>
                <T>
                  budget <Var>{snapshot.project.spent.gpuHours.toFixed(1)}</Var> /{" "}
                  <Var>{snapshot.project.budget.gpuHours}</Var> GPU-h
                </T>
              </span>
              <span className="ml-auto">
                {m(APPROVAL_MODE_LABELS[snapshot.project.approvalMode])}
              </span>
            </div>
          </form>
        </main>

        <aside
          aria-label={gt("Research context")}
          className="w-full shrink-0 lg:sticky lg:top-4 lg:w-72"
        >
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2 text-sm">
            {primaryBackend ? (
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                <CpuIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-foreground">{primaryBackend.label}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  <T>
                    <Var>{gpusInUse}</Var>/<Var>{primaryBackend.gpusTotal}</Var> GPU
                  </T>
                </span>
              </div>
            ) : null}

            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <GitBranchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-foreground">{snapshot.project.workflow}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {snapshot.workflowStepCompleted}/{snapshot.workflowStepTotal}
              </span>
            </div>

            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-foreground">
                <T>Ledger</T>
              </span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                <T>
                  <Var>{snapshot.runs.length}</Var> runs
                </T>
              </span>
            </div>

            <Separator className="my-1" />

            <Link
              to="/research/$researchProjectId/lineage"
              params={{ researchProjectId: projectId }}
              className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              <span>
                <T>
                  Lineage · <Var>{activeBranches.length}</Var> running
                </T>
              </span>
              <span className="inline-flex items-center gap-0.5">
                <T>Open graph</T>
                <ChevronRightIcon aria-hidden="true" className="size-3.5" />
              </span>
            </Link>

            <div className="flex flex-col gap-0.5">
              {snapshot.branches.map((branch) => {
                const branchNodes = snapshot.nodes.filter((node) => node.branchId === branch.id);
                const latestNode = branchNodes.at(-1);
                const rightMeta =
                  branch.status === "running"
                    ? formatShortRelativeAge(latestNode?.startedAt, referenceMs)
                    : m(BRANCH_STATUS_LABELS[branch.status]);
                return (
                  <Link
                    key={branch.id}
                    to="/research/$researchProjectId/branches/$branchId"
                    params={{
                      researchProjectId: projectId,
                      branchId: branch.id as BranchId,
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-accent/50",
                      branch.status === "pruned" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn("size-2 shrink-0 rounded-full", branchDotClass(branch.status))}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {branch.label} · {branch.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {rightMeta}
                    </span>
                  </Link>
                );
              })}
            </div>

            <Separator className="my-1" />

            <div className="flex flex-col gap-1 p-1">
              {snapshot.findings[0] ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  render={
                    <Link
                      to="/research/$researchProjectId/gates/$findingId"
                      params={{
                        researchProjectId: projectId,
                        findingId: snapshot.findings[0].id,
                      }}
                    />
                  }
                >
                  <T>
                    Review claim <Var>{snapshot.findings[0].label}</Var>
                  </T>
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost-muted"
                className="w-full"
                render={
                  <Link
                    to="/research/$researchProjectId/report"
                    params={{ researchProjectId: projectId }}
                  />
                }
              >
                <T>Open HTML report</T>
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ResearchThreadView({ researchProjectId }: ResearchThreadViewProps) {
  const resource = useResearchSnapshot(researchProjectId);

  if (resource.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        <T>Loading research thread…</T>
      </div>
    );
  }

  if (resource.status === "error" || !resource.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive-foreground">
        <T>
          Could not load research project: <Var>{resource.error ?? researchProjectId}</Var>
        </T>
      </div>
    );
  }

  return <ThreadBody key={resource.data.project.id} snapshot={resource.data} />;
}
