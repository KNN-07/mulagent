import { ResearchProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { LineageView } from "../research/LineageView";

function ResearchLineageRoute() {
  const { researchProjectId } = Route.useParams();
  return <LineageView researchProjectId={ResearchProjectId.make(researchProjectId)} />;
}

export const Route = createFileRoute("/_chat/research/$researchProjectId/lineage")({
  component: ResearchLineageRoute,
});
