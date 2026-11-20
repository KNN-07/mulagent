import {
  type ApprovalMode,
  type BackendDescription,
  type BranchId,
  type Finding,
  type FindingId,
  type Gate,
  type GateId,
  type ResearchBranch,
  type ResearchProject,
  ResearchProjectId,
} from "@t3tools/contracts";

import type { ResearchClient, ResearchProjectBudget, ResearchWorkspaceSnapshot } from "./client";
import {
  buildPlaceholderReportHtml,
  createForkedBranchRecord,
  createInitialSeedSnapshots,
  createPrunedNodeRecord,
  createSeedBackends,
  createStartedProjectSnapshot,
} from "./fixtures/mockSeedData";

type SnapshotListener = (snapshot: ResearchWorkspaceSnapshot) => void;
type ProjectsListener = (projects: ReadonlyArray<ResearchProject>) => void;

export class MockResearchClient implements ResearchClient {
  private readonly snapshots = new Map<ResearchProjectId, ResearchWorkspaceSnapshot>();
  private readonly backends: ReadonlyArray<BackendDescription>;
  private readonly snapshotListeners = new Map<ResearchProjectId, Set<SnapshotListener>>();
  private readonly projectListeners = new Set<ProjectsListener>();
  private eventSeq = 100;

  constructor(initialSnapshots?: ReadonlyArray<ResearchWorkspaceSnapshot>) {
    this.backends = createSeedBackends();
    const seeds = initialSnapshots ?? createInitialSeedSnapshots();
    for (const snapshot of seeds) {
      this.snapshots.set(snapshot.project.id, snapshot);
    }
  }

  private nextEventId(prefix: string): string {
    this.eventSeq += 1;
    return `${prefix}-${this.eventSeq}`;
  }

  private emitSnapshot(snapshot: ResearchWorkspaceSnapshot): void {
    this.snapshots.set(snapshot.project.id, snapshot);
    const listeners = this.snapshotListeners.get(snapshot.project.id);
    if (listeners) {
      for (const listener of listeners) {
        listener(snapshot);
      }
    }
    this.emitProjects();
  }

  private emitProjects(): void {
    const projects = [...this.snapshots.values()].map((snapshot) => snapshot.project);
    for (const listener of this.projectListeners) {
      listener(projects);
    }
  }

  private findSnapshotByGate(gateId: GateId): ResearchWorkspaceSnapshot | undefined {
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.gates.some((gate) => gate.id === gateId)) return snapshot;
    }
    return undefined;
  }

  private findSnapshotByFinding(findingId: FindingId): ResearchWorkspaceSnapshot | undefined {
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.findings.some((finding) => finding.id === findingId)) return snapshot;
    }
    return undefined;
  }

  private findSnapshotByBranch(branchId: BranchId): ResearchWorkspaceSnapshot | undefined {
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.branches.some((branch) => branch.id === branchId)) return snapshot;
    }
    return undefined;
  }

  async listProjects(): Promise<ReadonlyArray<ResearchProject>> {
    return [...this.snapshots.values()].map((snapshot) => snapshot.project);
  }

  async listBackends(): Promise<ReadonlyArray<BackendDescription>> {
    return this.backends;
  }

  async getSnapshot(researchProjectId: ResearchProjectId): Promise<ResearchWorkspaceSnapshot> {
    const snapshot = this.snapshots.get(researchProjectId);
    if (!snapshot) {
      throw new Error(`Unknown research project: ${researchProjectId}`);
    }
    return snapshot;
  }

  subscribe(researchProjectId: ResearchProjectId, onSnapshot: SnapshotListener): () => void {
    let listeners = this.snapshotListeners.get(researchProjectId);
    if (!listeners) {
      listeners = new Set();
      this.snapshotListeners.set(researchProjectId, listeners);
    }
    listeners.add(onSnapshot);
    return () => {
      listeners.delete(onSnapshot);
      if (listeners.size === 0) {
        this.snapshotListeners.delete(researchProjectId);
      }
    };
  }

  subscribeProjects(onProjects: ProjectsListener): () => void {
    this.projectListeners.add(onProjects);
    return () => {
      this.projectListeners.delete(onProjects);
    };
  }

  async answerGate(gateId: GateId, optionIds: ReadonlyArray<string>, note?: string): Promise<Gate> {
    const snapshot = this.findSnapshotByGate(gateId);
    if (!snapshot) {
      throw new Error(`Unknown gate: ${gateId}`);
    }
    const nowIso = new Date().toISOString();
    let updatedGate: Gate | undefined;
    const gates = snapshot.gates.map((gate) => {
      if (gate.id !== gateId) return gate;
      updatedGate = {
        ...gate,
        status: "answered",
        answer: {
          optionIds: [...optionIds],
          ...(note?.trim() ? { note: note.trim() } : {}),
        },
        answeredAt: nowIso,
      };
      return updatedGate;
    });
    if (!updatedGate) {
      throw new Error(`Unknown gate: ${gateId}`);
    }
    const chosenLabels = updatedGate.options
      .filter((option) => optionIds.includes(option.id))
      .map((option) => option.label)
      .join(", ");
    const threadEvents = [
      ...snapshot.threadEvents,
      {
        id: this.nextEventId("gate"),
        kind: "user-message" as const,
        text: note?.trim() ? `${chosenLabels} (${note.trim()})` : chosenLabels,
        createdAt: nowIso,
      },
    ];
    this.emitSnapshot({
      ...snapshot,
      project: { ...snapshot.project, updatedAt: nowIso },
      gates,
      threadEvents,
    });
    return updatedGate;
  }

  async skipGate(gateId: GateId): Promise<Gate> {
    const snapshot = this.findSnapshotByGate(gateId);
    if (!snapshot) {
      throw new Error(`Unknown gate: ${gateId}`);
    }
    const nowIso = new Date().toISOString();
    let updatedGate: Gate | undefined;
    const gates = snapshot.gates.map((gate) => {
      if (gate.id !== gateId) return gate;
      updatedGate = {
        ...gate,
        status: "skipped",
        answeredAt: nowIso,
      };
      return updatedGate;
    });
    if (!updatedGate) {
      throw new Error(`Unknown gate: ${gateId}`);
    }
    this.emitSnapshot({
      ...snapshot,
      project: { ...snapshot.project, updatedAt: nowIso },
      gates,
    });
    return updatedGate;
  }

  private updateFindingStatus(
    findingId: FindingId,
    status: Finding["status"],
    note?: string,
  ): Finding {
    const snapshot = this.findSnapshotByFinding(findingId);
    if (!snapshot) {
      throw new Error(`Unknown finding: ${findingId}`);
    }
    const nowIso = new Date().toISOString();
    let updatedFinding: Finding | undefined;
    const trimmedNote = note?.trim();
    const findings = snapshot.findings.map((finding) => {
      if (finding.id !== findingId) return finding;
      const caveats =
        status === "approved" && trimmedNote && !finding.caveats.includes(trimmedNote)
          ? [...finding.caveats, trimmedNote]
          : finding.caveats;
      updatedFinding = {
        ...finding,
        status,
        caveats,
      };
      return updatedFinding;
    });
    if (!updatedFinding) {
      throw new Error(`Unknown finding: ${findingId}`);
    }
    const gates = snapshot.gates.map((gate) => {
      if (gate.kind !== "claims" || gate.status !== "open") return gate;
      return {
        ...gate,
        status: "answered" as const,
        answer: {
          optionIds: [status],
          ...(trimmedNote ? { note: trimmedNote } : {}),
        },
        answeredAt: nowIso,
      };
    });
    const nodes = snapshot.nodes.map((node) => {
      if (node.kind !== "merge" || node.status !== "waiting-gate") return node;
      return {
        ...node,
        status: status === "approved" ? ("done" as const) : ("running" as const),
        verdict: status,
      };
    });
    const threadEvents = trimmedNote
      ? [
          ...snapshot.threadEvents,
          {
            id: this.nextEventId("finding"),
            kind: "user-message" as const,
            text: `${updatedFinding.label} (${status}): ${trimmedNote}`,
            createdAt: nowIso,
          },
        ]
      : snapshot.threadEvents;

    this.emitSnapshot({
      ...snapshot,
      project: { ...snapshot.project, updatedAt: nowIso },
      findings,
      gates,
      nodes,
      threadEvents,
    });
    return updatedFinding;
  }

  async approveFinding(findingId: FindingId, note?: string): Promise<Finding> {
    return this.updateFindingStatus(findingId, "approved", note);
  }

  async sendBack(findingId: FindingId, note?: string): Promise<Finding> {
    return this.updateFindingStatus(findingId, "sent-back", note);
  }

  async reject(findingId: FindingId, note?: string): Promise<Finding> {
    return this.updateFindingStatus(findingId, "rejected", note);
  }

  async pruneBranch(branchId: BranchId, reason?: string): Promise<ResearchBranch> {
    const snapshot = this.findSnapshotByBranch(branchId);
    if (!snapshot) {
      throw new Error(`Unknown branch: ${branchId}`);
    }
    const nowIso = new Date().toISOString();
    let prunedBranch: ResearchBranch | undefined;
    const branches = snapshot.branches.map((branch) => {
      if (branch.id !== branchId) return branch;
      prunedBranch = { ...branch, status: "pruned" };
      return prunedBranch;
    });
    if (!prunedBranch) {
      throw new Error(`Unknown branch: ${branchId}`);
    }
    const prunedNode = createPrunedNodeRecord(prunedBranch, reason);
    const threadEvents = [
      ...snapshot.threadEvents,
      {
        id: this.nextEventId("prune"),
        kind: "branch-pruned" as const,
        branchLabel: prunedBranch.label,
        detail: reason?.trim() || prunedBranch.title,
        createdAt: nowIso,
      },
    ];
    this.emitSnapshot({
      ...snapshot,
      project: { ...snapshot.project, updatedAt: nowIso },
      branches,
      nodes: [...snapshot.nodes, prunedNode],
      threadEvents,
    });
    return prunedBranch;
  }

  async forkBranch(branchId: BranchId, title?: string): Promise<ResearchBranch> {
    const snapshot = this.findSnapshotByBranch(branchId);
    if (!snapshot) {
      throw new Error(`Unknown branch: ${branchId}`);
    }
    const source = snapshot.branches.find((branch) => branch.id === branchId);
    if (!source) {
      throw new Error(`Unknown branch: ${branchId}`);
    }
    const nowIso = new Date().toISOString();
    const { branch, node } = createForkedBranchRecord(source, snapshot.branches.length, title);
    this.emitSnapshot({
      ...snapshot,
      project: { ...snapshot.project, updatedAt: nowIso },
      branches: [...snapshot.branches, { ...branch, spec: source.spec }],
      nodes: [...snapshot.nodes, node],
    });
    return branch;
  }

  async startProject(
    goal: string,
    workflow: string,
    approvalMode: ApprovalMode,
    budget: ResearchProjectBudget,
    title?: string,
  ): Promise<ResearchProject> {
    const trimmedGoal = goal.trim();
    const derivedTitle =
      title?.trim() ||
      trimmedGoal
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32) ||
      `research-${this.snapshots.size + 1}`;
    const slugBase = derivedTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let idCandidate = ResearchProjectId.make(slugBase || `research-${this.snapshots.size + 1}`);
    let suffix = 2;
    while (this.snapshots.has(idCandidate)) {
      idCandidate = ResearchProjectId.make(`${slugBase}-${suffix}`);
      suffix += 1;
    }
    const snapshot = createStartedProjectSnapshot(
      {
        id: idCandidate,
        title: derivedTitle,
        goal: trimmedGoal,
        workflow,
        approvalMode,
        budget,
      },
      this.backends,
    );
    this.emitSnapshot(snapshot);
    return snapshot.project;
  }

  async getReportHtml(researchProjectId: ResearchProjectId): Promise<string> {
    const snapshot = await this.getSnapshot(researchProjectId);
    return buildPlaceholderReportHtml(snapshot);
  }

  async postMessage(
    researchProjectId: ResearchProjectId,
    body: string,
    branchId?: BranchId,
  ): Promise<void> {
    const snapshot = this.snapshots.get(researchProjectId);
    const trimmed = body.trim();
    if (!snapshot || !trimmed) return;
    const nowIso = new Date().toISOString();
    if (branchId) {
      const existing = snapshot.branchWorkspaces[branchId];
      if (existing) {
        this.emitSnapshot({
          ...snapshot,
          project: { ...snapshot.project, updatedAt: nowIso },
          branchWorkspaces: {
            ...snapshot.branchWorkspaces,
            [branchId]: {
              ...existing,
              agentNotes: [...existing.agentNotes, trimmed],
            },
          },
        });
        return;
      }
    }
    this.emitSnapshot({
      ...snapshot,
      project: { ...snapshot.project, updatedAt: nowIso },
      threadEvents: [
        ...snapshot.threadEvents,
        {
          id: this.nextEventId("msg"),
          kind: "user-message",
          text: trimmed,
          createdAt: nowIso,
        },
      ],
    });
  }

  async resolvePendingEdit(
    researchProjectId: ResearchProjectId,
    branchId: BranchId,
    _action: "keep" | "undo",
  ): Promise<void> {
    const snapshot = this.snapshots.get(researchProjectId);
    if (!snapshot) return;
    const existing = snapshot.branchWorkspaces[branchId];
    if (!existing) return;
    const nowIso = new Date().toISOString();
    this.emitSnapshot({
      ...snapshot,
      project: { ...snapshot.project, updatedAt: nowIso },
      branchWorkspaces: {
        ...snapshot.branchWorkspaces,
        [branchId]: {
          ...existing,
          pendingEdit: null,
        },
      },
    });
  }
}
