import { createFileRoute } from "@tanstack/react-router";

import { ResearchShell } from "../research/ResearchShell";

export const Route = createFileRoute("/_chat/research")({
  component: ResearchShell,
});
