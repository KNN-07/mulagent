import type { Finding, FindingId, ResearchProjectId, RunMetric } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T, useGT, useMessages, Var } from "gt-react";
import { ArrowUpIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import type { ResearchWorkspaceSnapshot } from "./client";
import {
  FINDING_STATUS_LABELS,
  findingStatusBadgeVariant,
  formatMetricValue,
  INTEGRITY_VERDICT_LABELS,
  LEAN_STATUS_LABELS,
} from "./researchPresentation";
import { getResearchClient, useResearchSnapshot } from "./researchStore";

interface GateReviewViewProps {
  readonly researchProjectId: ResearchProjectId;
  readonly findingId: FindingId;
}

function primaryMetricForRun(metrics: ReadonlyArray<RunMetric>, runId: string): number | null {
  const match = metrics.find((row) => row.runId === runId && !row.name.startsWith("baseline_"));
  return match?.value ?? null;
}

function GateReviewBody({
  snapshot,
  finding,
}: {
  readonly snapshot: ResearchWorkspaceSnapshot;
  readonly finding: Finding;
}) {
  const gt = useGT();
  const m = useMessages();
  const client = getResearchClient();

  const defaultNote =
    finding.caveats[0] !== undefined
      ? gt("Add the critic's caveat: {caveat}", { caveat: finding.caveats[0] })
      : "";
  const [note, setNote] = useState(defaultNote);
  const [submitting, setSubmitting] = useState(false);
  const [showAllEvidence, setShowAllEvidence] = useState(false);

  const evidenceRuns = finding.evidenceRunIds
    .map((runId) => snapshot.runs.find((run) => run.id === runId))
    .filter((run): run is NonNullable<typeof run> => run !== undefined);
  const visibleEvidence = showAllEvidence ? evidenceRuns : evidenceRuns.slice(0, 3);
  const hiddenCount = Math.max(0, evidenceRuns.length - visibleEvidence.length);

  const landedCount = finding.critic.filter((attack) => attack.landed).length;
  const trustedIntegrity =
    evidenceRuns.length > 0 && evidenceRuns.every((run) => run.integrity === "trusted")
      ? "trusted"
      : "preliminary";

  const handleAction = async (action: "approve" | "send-back" | "reject") => {
    if (submitting) return;
    setSubmitting(true);
    const trimmed = note.trim() || undefined;
    if (action === "approve") {
      await client.approveFinding(finding.id, trimmed);
    } else if (action === "send-back") {
      await client.sendBack(finding.id, trimmed);
    } else {
      await client.reject(finding.id, trimmed);
    }
    setSubmitting(false);
  };

  const handleComposerSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await handleAction("approve");
  };

  return (
    <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-4 pb-10 sm:px-6 lg:flex-row lg:items-start">
        <main className="flex min-w-0 flex-1 flex-col gap-5">
          {snapshot.findings.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {snapshot.findings.map((candidate) => (
                <Button
                  key={candidate.id}
                  size="xs"
                  variant={candidate.id === finding.id ? "secondary" : "ghost-muted"}
                  render={
                    <Link
                      to="/research/$researchProjectId/gates/$findingId"
                      params={{
                        researchProjectId: snapshot.project.id,
                        findingId: candidate.id,
                      }}
                    />
                  }
                >
                  <T>
                    Claim <Var>{candidate.label}</Var>
                  </T>
                </Button>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              <T>
                Here is claim <Var>{finding.label}</Var> as the writer would state it. Every number
                comes from the ledger; nothing was typed by an agent.
              </T>
            </p>
            <Badge variant={findingStatusBadgeVariant(finding.status)}>
              {m(FINDING_STATUS_LABELS[finding.status])}
            </Badge>
          </div>

          <blockquote className="border-l-2 border-border pl-4 text-base leading-relaxed font-medium text-foreground">
            {finding.claim}
          </blockquote>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <T>
                <Var>{finding.evidenceRunIds.length}</Var> runs
              </T>
            </span>
            <span>
              <T>
                scope: <Var>{finding.scope}</Var>
              </T>
            </span>
            <span
              className={
                trustedIntegrity === "trusted"
                  ? "text-success-foreground"
                  : "text-warning-foreground"
              }
            >
              <T>
                integrity: <Var>{m(INTEGRITY_VERDICT_LABELS[trustedIntegrity])}</Var>
              </T>
            </span>
          </div>

          <section aria-labelledby="critic-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-xs text-muted-foreground">
              <h2 id="critic-heading" className="font-medium text-muted-foreground">
                {finding.criticModel ? (
                  <T>
                    Critic · fresh context (<Var>{finding.criticModel}</Var>)
                  </T>
                ) : (
                  <T>Critic · fresh context, different model family</T>
                )}
              </h2>
              <span className="tabular-nums">
                <T>
                  <Var>{finding.critic.length}</Var> attacks · <Var>{landedCount}</Var> landed
                </T>
              </span>
            </div>

            <ol className="flex list-none flex-col gap-2.5 p-0 text-sm">
              {finding.critic.map((entry, idx) => (
                <li key={entry.attack} className="flex items-start gap-3">
                  <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{entry.attack}</span>{" "}
                    <span className="text-muted-foreground">{entry.response}</span>
                  </div>
                  <Badge size="sm" variant={entry.landed ? "error" : "secondary"}>
                    {entry.landed ? <T>landed</T> : <T>held</T>}
                  </Badge>
                </li>
              ))}
            </ol>

            {finding.caveats.map((caveat) => (
              <p key={caveat} className="text-sm text-warning-foreground">
                <T>
                  Caveat from the critic: <Var>{caveat}</Var>
                </T>
              </p>
            ))}
          </section>

          {snapshot.leanClaims.length > 0 ? (
            <section aria-labelledby="lean-heading" className="flex flex-col gap-2.5">
              <h2
                id="lean-heading"
                className="border-b border-border pb-2 text-xs font-medium text-muted-foreground"
              >
                <T>Lean · formal verification</T>
              </h2>
              <div className="flex flex-col gap-2 text-sm">
                {snapshot.leanClaims.map((claim) => (
                  <div key={claim.name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <code className="w-44 shrink-0 font-mono text-xs text-foreground">
                      {claim.name}
                    </code>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        claim.status === "proven"
                          ? "text-success-foreground"
                          : claim.status === "disproved" || claim.status === "rejected"
                            ? "text-destructive-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {m(LEAN_STATUS_LABELS[claim.status])}
                    </span>
                    {claim.status === "open" && claim.informal ? (
                      <span className="text-xs text-muted-foreground">· {claim.informal}</span>
                    ) : claim.axioms.length > 0 ? (
                      <span className="font-mono text-2xs text-muted-foreground">
                        {claim.axioms.join(", ")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="default"
              disabled={submitting}
              onClick={() => void handleAction("approve")}
            >
              <T>Approve with note</T>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => void handleAction("send-back")}
            >
              <T>Send back for more runs</T>
            </Button>
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={submitting}
              onClick={() => void handleAction("reject")}
            >
              <T>Reject</T>
            </Button>
          </div>

          <form onSubmit={handleComposerSubmit} className="mt-1 flex flex-col gap-2">
            <Label htmlFor="gate-writer-note" className="sr-only">
              <T>Note to the writer</T>
            </Label>
            <div className="rounded-2xl border border-border bg-card p-3">
              <Textarea
                id="gate-writer-note"
                unstyled
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={gt(
                  "Add caveats, scope limits, or follow-up instructions for the writer",
                )}
              />
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  <T>Note to writer</T>
                </span>
                <Button
                  type="submit"
                  size="icon-sm-pill"
                  variant="secondary"
                  aria-label={gt("Approve with note")}
                  disabled={submitting}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
              </div>
            </div>
          </form>
        </main>

        <aside
          aria-label={gt("Evidence and venue checklist")}
          className="w-full shrink-0 lg:sticky lg:top-4 lg:w-72"
        >
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2 text-sm">
            <div className="flex items-center justify-between px-2.5 py-2 text-xs text-muted-foreground">
              <span>
                <T>
                  Evidence · <Var>{finding.evidenceRunIds.length}</Var> runs
                </T>
              </span>
              <span>
                <T>ledger</T>
              </span>
            </div>

            <div className="flex flex-col gap-0.5">
              {visibleEvidence.map((run) => {
                const value = primaryMetricForRun(snapshot.metrics, run.id);
                return (
                  <Link
                    key={run.id}
                    to="/research/$researchProjectId/branches/$branchId"
                    params={{
                      researchProjectId: snapshot.project.id,
                      branchId: run.branchId,
                    }}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs hover:bg-accent/50"
                  >
                    <code className="font-mono text-muted-foreground">{run.id}</code>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {run.scope ?? run.change}
                    </span>
                    <span className="font-mono text-muted-foreground tabular-nums">
                      {formatMetricValue(value)}
                    </span>
                  </Link>
                );
              })}
            </div>

            {hiddenCount > 0 || showAllEvidence ? (
              <Button
                size="xs"
                variant="ghost-muted"
                className="self-start"
                onClick={() => setShowAllEvidence((prev) => !prev)}
              >
                {showAllEvidence ? (
                  <T>Show fewer</T>
                ) : (
                  <T>
                    + <Var>{hiddenCount}</Var> more
                  </T>
                )}
              </Button>
            ) : null}

            <Separator className="my-1.5" />

            <div className="flex items-center justify-between px-2.5 py-1.5 text-xs text-muted-foreground">
              <span>
                <T>Venue checklist</T>
              </span>
              <span>
                <T>from ledger</T>
              </span>
            </div>

            <div className="flex flex-col gap-1 px-2.5 pb-1 text-xs">
              {snapshot.venueChecklist.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-1">
                  <span className="text-foreground">{item.label}</span>
                  <span
                    className={cn(
                      "font-medium",
                      item.status === "yes"
                        ? "text-success-foreground"
                        : item.status === "user-decision"
                          ? "text-warning-foreground"
                          : "text-destructive-foreground",
                    )}
                  >
                    {item.status === "yes" ? (
                      <T>yes</T>
                    ) : item.status === "user-decision" ? (
                      <T>your call</T>
                    ) : (
                      <T>missing</T>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function GateReviewView({ researchProjectId, findingId }: GateReviewViewProps) {
  const resource = useResearchSnapshot(researchProjectId);

  if (resource.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        <T>Loading claim review…</T>
      </div>
    );
  }

  if (resource.status === "error" || !resource.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive-foreground">
        <T>
          Could not load claim review: <Var>{resource.error ?? findingId}</Var>
        </T>
      </div>
    );
  }

  const finding =
    resource.data.findings.find((candidate) => candidate.id === findingId) ??
    resource.data.findings[0];

  if (!finding) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <p>
          <T>No claims are waiting at a review gate for this project yet.</T>
        </p>
        <Button
          size="sm"
          variant="outline"
          render={
            <Link
              to="/research/$researchProjectId"
              params={{ researchProjectId: resource.data.project.id }}
            />
          }
        >
          <T>Return to research thread</T>
        </Button>
      </div>
    );
  }

  return <GateReviewBody key={finding.id} snapshot={resource.data} finding={finding} />;
}
