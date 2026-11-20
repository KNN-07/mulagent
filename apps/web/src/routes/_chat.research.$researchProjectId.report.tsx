import { ResearchProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ReportView } from "../research/ReportView";

function ResearchReportRoute() {
  const { researchProjectId } = Route.useParams();
  return <ReportView researchProjectId={ResearchProjectId.make(researchProjectId)} />;
}

export const Route = createFileRoute("/_chat/research/$researchProjectId/report")({
  component: ResearchReportRoute,
});
