import type {
  ApprovalMode,
  BranchStatus,
  Finding,
  IntegrityVerdict,
  LeanClaim,
  RunVerdict,
  ScaleRung,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import type { LineageTone } from "./lineage.logic";

export type ResearchBadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "info"
  | "success"
  | "warning"
  | "error";

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  "ask-always": msg("Ask at every step"),
  "ask-risky": msg("Ask for risky actions"),
  autonomous: msg("Autonomous"),
};

export const BRANCH_STATUS_LABELS: Record<BranchStatus, string> = {
  running: msg("Running", { $context: "research branch status" }),
  promoted: msg("Promoted", { $context: "research branch status" }),
  done: msg("Done", { $context: "research branch status" }),
  pruned: msg("Pruned", { $context: "research branch status" }),
  failed: msg("Failed", { $context: "research branch status" }),
};

export const SCALE_RUNG_LABELS: Record<ScaleRung, string> = {
  toy: msg("toy", { $context: "experiment scale ladder rung" }),
  small: msg("small", { $context: "experiment scale ladder rung" }),
  target: msg("target", { $context: "experiment scale ladder rung" }),
};

export const RUN_VERDICT_LABELS: Record<RunVerdict, string> = {
  keep: msg("keep", { $context: "experiment run verdict" }),
  discard: msg("discard", { $context: "experiment run verdict" }),
  crash: msg("crash", { $context: "experiment run verdict" }),
  "checks-failed": msg("checks failed", { $context: "experiment run verdict" }),
  pending: msg("running", { $context: "experiment run verdict" }),
};

export const FINDING_STATUS_LABELS: Record<Finding["status"], string> = {
  draft: msg("Draft", { $context: "research claim status" }),
  "critic-passed": msg("Ready for review", { $context: "research claim status" }),
  "critic-broken": msg("Critic broke claim", { $context: "research claim status" }),
  approved: msg("Approved", { $context: "research claim status" }),
  rejected: msg("Rejected", { $context: "research claim status" }),
  "sent-back": msg("Sent back", { $context: "research claim status" }),
};

export const INTEGRITY_VERDICT_LABELS: Record<IntegrityVerdict, string> = {
  trusted: msg("trusted", { $context: "experiment integrity verdict" }),
  preliminary: msg("preliminary", { $context: "experiment integrity verdict" }),
  rejected: msg("rejected", { $context: "experiment integrity verdict" }),
  unchecked: msg("unchecked", { $context: "experiment integrity verdict" }),
};

export const LEAN_STATUS_LABELS: Record<LeanClaim["status"], string> = {
  open: msg("open", { $context: "Lean theorem proof status" }),
  proven: msg("proven", { $context: "Lean theorem proof status" }),
  disproved: msg("disproved", { $context: "Lean theorem proof status" }),
  rejected: msg("rejected", { $context: "Lean theorem proof status" }),
};

export function branchStatusBadgeVariant(status: BranchStatus): ResearchBadgeVariant {
  switch (status) {
    case "running":
      return "info";
    case "promoted":
      return "success";
    case "done":
      return "secondary";
    case "pruned":
      return "outline";
    case "failed":
      return "error";
  }
}

export function findingStatusBadgeVariant(status: Finding["status"]): ResearchBadgeVariant {
  switch (status) {
    case "approved":
    case "critic-passed":
      return "success";
    case "critic-broken":
    case "rejected":
      return "error";
    case "sent-back":
      return "warning";
    case "draft":
      return "secondary";
  }
}

export function runVerdictBadgeVariant(verdict: RunVerdict): ResearchBadgeVariant {
  switch (verdict) {
    case "keep":
      return "success";
    case "crash":
    case "checks-failed":
      return "error";
    case "pending":
      return "info";
    case "discard":
      return "secondary";
  }
}

export const LINEAGE_LANE_BG: Record<LineageTone, string> = {
  main: "bg-muted-foreground",
  info: "bg-info",
  guest: "bg-guest",
  muted: "bg-border",
  success: "bg-success",
  warning: "bg-warning",
};

export function formatMetricValue(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

export function formatShortRelativeAge(isoDate: string | undefined, referenceMs: number): string {
  if (!isoDate) return "-";
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return "-";
  const diffMinutes = Math.max(0, Math.round((referenceMs - parsed) / 60_000));
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

export function projectMonogram(title: string): string {
  const words = title
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  return title.slice(0, 2).toUpperCase();
}
