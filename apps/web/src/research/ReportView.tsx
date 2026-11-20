import type { ResearchProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T, useGT, Var } from "gt-react";
import { RefreshCwIcon, ShieldCheckIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

import { refreshResearchReport, useResearchReportHtml, useResearchSnapshot } from "./researchStore";

interface ReportViewProps {
  readonly researchProjectId: ResearchProjectId;
}

export function ReportView({ researchProjectId }: ReportViewProps) {
  const gt = useGT();
  const snapshotResource = useResearchSnapshot(researchProjectId);
  const reportResource = useResearchReportHtml(researchProjectId);

  const projectTitle = snapshotResource.data?.project.title ?? researchProjectId;
  const runCount = snapshotResource.data?.runs.length ?? 0;

  if (reportResource.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        <T>Generating HTML report from ledger…</T>
      </div>
    );
  }

  if (reportResource.status === "error" || reportResource.data === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-sm text-destructive-foreground">
        <p>
          <T>
            Could not load HTML report: <Var>{reportResource.error ?? researchProjectId}</Var>
          </T>
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refreshResearchReport(researchProjectId)}
        >
          <T>Retry</T>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" className="size-4 text-success" />
          <span>
            <T>
              Sandboxed HTML report generated from <Var>{runCount}</Var> ledger runs
            </T>
          </span>
          <Badge size="sm" variant="outline">
            <T>scripts disabled</T>
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => refreshResearchReport(researchProjectId)}
          >
            <RefreshCwIcon aria-hidden="true" />
            <T>Refresh report</T>
          </Button>
          <Button
            size="xs"
            variant="outline"
            render={<Link to="/research/$researchProjectId" params={{ researchProjectId }} />}
          >
            <T>Back to thread</T>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-background p-3 sm:p-4">
        <iframe
          title={gt("Research report for {title}", { title: projectTitle })}
          srcDoc={reportResource.data}
          sandbox=""
          className="h-full w-full rounded-xl border border-border bg-card"
        />
      </div>
    </div>
  );
}
