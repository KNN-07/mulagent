import type { BranchId, FindingId, ResearchProjectId } from "@t3tools/contracts";
import { Link, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  FileTextIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  LayoutGridIcon,
  MessageSquareTextIcon,
  PlusIcon,
  ShieldCheckIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { createContext, use, useState } from "react";

import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import { NewResearchProjectDialog } from "./NewResearchProjectDialog";
import { useResearchProjects, useResearchSnapshot } from "./researchStore";

interface ResearchShellActions {
  readonly openNewProjectDialog: () => void;
}

const ResearchShellContext = createContext<ResearchShellActions>({
  openNewProjectDialog: () => undefined,
});

export function useResearchShellActions(): ResearchShellActions {
  return use(ResearchShellContext);
}

function ProjectNavigationStrip({
  researchProjectId,
}: {
  readonly researchProjectId: ResearchProjectId;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const snapshotResource = useResearchSnapshot(researchProjectId);
  const defaultBranchId = snapshotResource.data?.branches[0]?.id as BranchId | undefined;
  const defaultFindingId = snapshotResource.data?.findings[0]?.id as FindingId | undefined;

  const isThread = pathname === `/research/${researchProjectId}`;
  const isWorkspace = pathname.startsWith(`/research/${researchProjectId}/branches/`);
  const isGate = pathname.startsWith(`/research/${researchProjectId}/gates/`);
  const isLineage = pathname === `/research/${researchProjectId}/lineage`;
  const isReport = pathname === `/research/${researchProjectId}/report`;

  const linkClass = (active: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
    );

  return (
    <nav
      aria-label={snapshotResource.data?.project.title ?? researchProjectId}
      className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-1.5 sm:px-5"
    >
      <Link
        to="/research/$researchProjectId"
        params={{ researchProjectId }}
        className={linkClass(isThread)}
      >
        <MessageSquareTextIcon aria-hidden="true" className="size-3.5" />
        <T>Thread</T>
      </Link>

      {defaultBranchId ? (
        <Link
          to="/research/$researchProjectId/branches/$branchId"
          params={{ researchProjectId, branchId: defaultBranchId }}
          className={linkClass(isWorkspace)}
        >
          <TerminalSquareIcon aria-hidden="true" className="size-3.5" />
          <T>Workspace</T>
        </Link>
      ) : null}

      {defaultFindingId ? (
        <Link
          to="/research/$researchProjectId/gates/$findingId"
          params={{ researchProjectId, findingId: defaultFindingId }}
          className={linkClass(isGate)}
        >
          <ShieldCheckIcon aria-hidden="true" className="size-3.5" />
          <T>Gate review</T>
        </Link>
      ) : null}

      <Link
        to="/research/$researchProjectId/lineage"
        params={{ researchProjectId }}
        className={linkClass(isLineage)}
      >
        <GitBranchIcon aria-hidden="true" className="size-3.5" />
        <T>Lineage</T>
      </Link>

      <Link
        to="/research/$researchProjectId/report"
        params={{ researchProjectId }}
        className={linkClass(isReport)}
      >
        <FileTextIcon aria-hidden="true" className="size-3.5" />
        <T>Report</T>
      </Link>
    </nav>
  );
}

export function ResearchShell() {
  const gt = useGT();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as {
    readonly researchProjectId?: string;
    readonly branchId?: string;
    readonly findingId?: string;
  };
  const pathname = useLocation({ select: (location) => location.pathname });
  const projectsResource = useResearchProjects();
  const [dialogOpen, setDialogOpen] = useState(false);

  const activeProjectId = params.researchProjectId as ResearchProjectId | undefined;
  const activeProject = activeProjectId
    ? projectsResource.data?.find((project) => project.id === activeProjectId)
    : undefined;

  const subSectionLabel = pathname.includes("/branches/")
    ? gt("Workspace")
    : pathname.includes("/gates/")
      ? gt("Gate review")
      : pathname.endsWith("/lineage")
        ? gt("Lineage")
        : pathname.endsWith("/report")
          ? gt("Report")
          : null;

  return (
    <ResearchShellContext value={{ openNewProjectDialog: () => setDialogOpen(true) }}>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <WorkspacePageHeader
            electron={isElectron}
            className="border-b border-border bg-background"
          >
            <WorkspaceBreadcrumb ariaLabel={gt("Research breadcrumb")} className="min-w-0 flex-1">
              <WorkspaceBreadcrumbItem current={!activeProjectId}>
                <Link
                  to="/research"
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <FlaskConicalIcon aria-hidden="true" className="size-4 shrink-0" />
                  <WorkspaceBreadcrumbText>
                    <T>Research</T>
                  </WorkspaceBreadcrumbText>
                </Link>
              </WorkspaceBreadcrumbItem>

              {activeProjectId ? (
                <>
                  <WorkspaceBreadcrumbSeparator />
                  <WorkspaceBreadcrumbItem current={subSectionLabel === null}>
                    <Link
                      to="/research/$researchProjectId"
                      params={{ researchProjectId: activeProjectId }}
                      className="min-w-0 truncate hover:text-foreground"
                    >
                      <WorkspaceBreadcrumbText>
                        {activeProject?.title ?? activeProjectId}
                      </WorkspaceBreadcrumbText>
                    </Link>
                  </WorkspaceBreadcrumbItem>
                </>
              ) : null}

              {subSectionLabel ? (
                <>
                  <WorkspaceBreadcrumbSeparator />
                  <WorkspaceBreadcrumbItem current>
                    <WorkspaceBreadcrumbText>{subSectionLabel}</WorkspaceBreadcrumbText>
                  </WorkspaceBreadcrumbItem>
                </>
              ) : null}
            </WorkspaceBreadcrumb>

            <div className="flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
              {activeProjectId ? (
                <Button size="xs" variant="ghost-muted" render={<Link to="/research" />}>
                  <LayoutGridIcon aria-hidden="true" />
                  <span className="max-sm:sr-only">
                    <T>Fleet</T>
                  </span>
                </Button>
              ) : null}
              <Button size="xs" variant="outline" onClick={() => setDialogOpen(true)}>
                <PlusIcon aria-hidden="true" />
                <span className="max-sm:sr-only">
                  <T>New project</T>
                </span>
              </Button>
            </div>
          </WorkspacePageHeader>

          {activeProjectId ? <ProjectNavigationStrip researchProjectId={activeProjectId} /> : null}

          <Outlet />
        </div>

        <NewResearchProjectDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCreated={(newProjectId) => {
            void navigate({
              to: "/research/$researchProjectId",
              params: { researchProjectId: newProjectId },
            });
          }}
        />
      </SidebarInset>
    </ResearchShellContext>
  );
}
