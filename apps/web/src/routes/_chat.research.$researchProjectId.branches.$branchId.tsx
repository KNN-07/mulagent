import { BranchId, ResearchProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { BranchWorkspaceView } from "../research/BranchWorkspaceView";

function ResearchBranchWorkspaceRoute() {
  const { researchProjectId, branchId } = Route.useParams();
  return (
    <BranchWorkspaceView
      researchProjectId={ResearchProjectId.make(researchProjectId)}
      branchId={BranchId.make(branchId)}
    />
  );
}

export const Route = createFileRoute("/_chat/research/$researchProjectId/branches/$branchId")({
  component: ResearchBranchWorkspaceRoute,
});
