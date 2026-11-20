import { createFileRoute } from "@tanstack/react-router";

import { FleetView } from "../research/FleetView";
import { useResearchShellActions } from "../research/ResearchShell";

function ResearchFleetRoute() {
  const { openNewProjectDialog } = useResearchShellActions();
  return <FleetView onOpenNewProject={openNewProjectDialog} />;
}

export const Route = createFileRoute("/_chat/research/")({
  component: ResearchFleetRoute,
});
