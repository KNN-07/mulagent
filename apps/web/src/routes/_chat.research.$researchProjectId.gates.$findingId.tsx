import { FindingId, ResearchProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { GateReviewView } from "../research/GateReviewView";

function ResearchGateReviewRoute() {
  const { researchProjectId, findingId } = Route.useParams();
  return (
    <GateReviewView
      researchProjectId={ResearchProjectId.make(researchProjectId)}
      findingId={FindingId.make(findingId)}
    />
  );
}

export const Route = createFileRoute("/_chat/research/$researchProjectId/gates/$findingId")({
  component: ResearchGateReviewRoute,
});
