import { ResearchProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ResearchThreadView } from "../research/ResearchThreadView";

function ResearchThreadRoute() {
  const { researchProjectId } = Route.useParams();
  return <ResearchThreadView researchProjectId={ResearchProjectId.make(researchProjectId)} />;
}

export const Route = createFileRoute("/_chat/research/$researchProjectId/")({
  component: ResearchThreadRoute,
});
