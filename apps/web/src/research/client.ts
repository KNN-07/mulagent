import type {
  ApprovalMode,
  BackendDescription,
  BranchId,
  Finding,
  FindingId,
  Gate,
  GateId,
  IsoDateTime,
  ResearchBranch,
  ResearchProject,
  ResearchProjectId,
  ResearchRunId,
  ResearchSnapshot,
} from "@t3tools/contracts";

export interface ResearchProjectBudget {
  readonly gpuHours: number;
  readonly usd: number;
  readonly llmUsdPerWeek: number;
}

export type ResearchThreadEvent =
  | {
      readonly id: string;
      readonly kind: "user-message";
      readonly text: string;
      readonly createdAt: IsoDateTime;
    }
  | {
      readonly id: string;
      readonly kind: "agent-message";
      readonly text: string;
      readonly createdAt: IsoDateTime;
      readonly relatedFindingId?: FindingId;
    }
  | {
      readonly id: string;
      readonly kind: "file-edit";
      readonly path: string;
      readonly additions: number;
      readonly deletions: number;
      readonly createdAt: IsoDateTime;
    }
  | {
      readonly id: string;
      readonly kind: "command-run";
      readonly command: string;
      readonly durationLabel: string;
      readonly runId?: ResearchRunId;
      readonly createdAt: IsoDateTime;
    }
  | {
      readonly id: string;
      readonly kind: "lean-proved";
      readonly claimName: string;
      readonly durationLabel: string;
      readonly createdAt: IsoDateTime;
    }
  | {
      readonly id: string;
      readonly kind: "branch-pruned";
      readonly branchLabel: string;
      readonly detail: string;
      readonly createdAt: IsoDateTime;
    };

export interface HorizonComparisonRow {
  readonly horizon: number;
  readonly latentRunId: ResearchRunId;
  readonly baselineRunId: ResearchRunId;
  readonly latentValue: number;
  readonly baselineValue: number;
  readonly deltaPp: number;
  readonly significant: boolean;
}

export interface BranchLiveTelemetry {
  readonly step: number;
  readonly totalSteps: number;
  readonly seedIndex: number;
  readonly totalSeeds: number;
  readonly gpus: number;
  readonly etaMinutes: number;
  readonly runIndex: number;
  readonly totalBudgetRuns?: number;
  readonly elapsedLabel: string;
}

export interface BranchSessionItem {
  readonly id: string;
  readonly title: string;
  readonly status: "running" | "done" | "waiting";
  readonly detail: string;
  readonly ageLabel: string;
}

export interface WorkspaceFileEntry {
  readonly path: string;
  readonly name: string;
  readonly folder: string;
  readonly modified?: boolean;
  readonly locked?: boolean;
  readonly preview?: string;
}

export interface PendingWorkspaceEdit {
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
  readonly summary: string;
}

export interface BranchWorkspaceExtras {
  readonly docPath: string;
  readonly docUpdatedLabel: string;
  readonly agentPrompt: string;
  readonly thoughtDurationLabel: string;
  readonly integritySummary: string;
  readonly sessions: ReadonlyArray<BranchSessionItem>;
  readonly files: ReadonlyArray<WorkspaceFileEntry>;
  readonly pendingEdit: PendingWorkspaceEdit | null;
  readonly agentNotes: ReadonlyArray<string>;
}

export interface VenueChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly status: "yes" | "user-decision" | "missing";
}

export interface ResearchWorkspaceSnapshot extends ResearchSnapshot {
  readonly workedDurationLabel: string;
  readonly threadEvents: ReadonlyArray<ResearchThreadEvent>;
  readonly horizonSummary: ReadonlyArray<HorizonComparisonRow>;
  readonly branchLiveTelemetry: Readonly<Record<string, BranchLiveTelemetry>>;
  readonly branchWorkspaces: Readonly<Record<string, BranchWorkspaceExtras>>;
  readonly venueChecklist: ReadonlyArray<VenueChecklistItem>;
  readonly workflowYaml: string;
}

export interface ResearchClient {
  listProjects(): Promise<ReadonlyArray<ResearchProject>>;
  listBackends(): Promise<ReadonlyArray<BackendDescription>>;
  getSnapshot(researchProjectId: ResearchProjectId): Promise<ResearchWorkspaceSnapshot>;
  subscribe(
    researchProjectId: ResearchProjectId,
    onSnapshot: (snapshot: ResearchWorkspaceSnapshot) => void,
  ): () => void;
  subscribeProjects(onProjects: (projects: ReadonlyArray<ResearchProject>) => void): () => void;
  answerGate(gateId: GateId, optionIds: ReadonlyArray<string>, note?: string): Promise<Gate>;
  skipGate(gateId: GateId): Promise<Gate>;
  approveFinding(findingId: FindingId, note?: string): Promise<Finding>;
  sendBack(findingId: FindingId, note?: string): Promise<Finding>;
  reject(findingId: FindingId, note?: string): Promise<Finding>;
  pruneBranch(branchId: BranchId, reason?: string): Promise<ResearchBranch>;
  forkBranch(branchId: BranchId, title?: string): Promise<ResearchBranch>;
  startProject(
    goal: string,
    workflow: string,
    approvalMode: ApprovalMode,
    budget: ResearchProjectBudget,
    title?: string,
  ): Promise<ResearchProject>;
  getReportHtml(researchProjectId: ResearchProjectId): Promise<string>;
  postMessage(
    researchProjectId: ResearchProjectId,
    body: string,
    branchId?: BranchId,
  ): Promise<void>;
  resolvePendingEdit(
    researchProjectId: ResearchProjectId,
    branchId: BranchId,
    action: "keep" | "undo",
  ): Promise<void>;
}
