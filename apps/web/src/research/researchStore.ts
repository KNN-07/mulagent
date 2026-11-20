import type { BackendDescription, ResearchProject, ResearchProjectId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import type { ResearchClient, ResearchWorkspaceSnapshot } from "./client";
import { MockResearchClient } from "./mockClient";

interface AsyncResource<Value> {
  readonly status: "loading" | "ready" | "error";
  readonly data: Value | null;
  readonly error: string | null;
}

const LOADING_PROJECTS: AsyncResource<ReadonlyArray<ResearchProject>> = {
  status: "loading",
  data: null,
  error: null,
};

const LOADING_BACKENDS: AsyncResource<ReadonlyArray<BackendDescription>> = {
  status: "loading",
  data: null,
  error: null,
};

const LOADING_SNAPSHOT: AsyncResource<ResearchWorkspaceSnapshot> = {
  status: "loading",
  data: null,
  error: null,
};

const LOADING_FLEET: AsyncResource<ReadonlyArray<ResearchWorkspaceSnapshot>> = {
  status: "loading",
  data: null,
  error: null,
};

const LOADING_REPORT: AsyncResource<string> = {
  status: "loading",
  data: null,
  error: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ResearchClientStore {
  private readonly researchClient: ResearchClient;
  private projectsState: AsyncResource<ReadonlyArray<ResearchProject>> = LOADING_PROJECTS;
  private backendsState: AsyncResource<ReadonlyArray<BackendDescription>> = LOADING_BACKENDS;
  private fleetState: AsyncResource<ReadonlyArray<ResearchWorkspaceSnapshot>> = LOADING_FLEET;
  private readonly snapshotStates = new Map<
    ResearchProjectId,
    AsyncResource<ResearchWorkspaceSnapshot>
  >();
  private readonly reportStates = new Map<ResearchProjectId, AsyncResource<string>>();

  private readonly projectsListeners = new Set<() => void>();
  private readonly backendsListeners = new Set<() => void>();
  private readonly fleetListeners = new Set<() => void>();
  private readonly snapshotListeners = new Map<ResearchProjectId, Set<() => void>>();
  private readonly reportListeners = new Map<ResearchProjectId, Set<() => void>>();

  private readonly activeClientUnsubs = new Map<ResearchProjectId, () => void>();
  private activeProjectsUnsub: (() => void) | null = null;
  private projectsLoaded = false;
  private backendsLoaded = false;
  private fleetLoaded = false;

  constructor(initialClient: ResearchClient) {
    this.researchClient = initialClient;
  }

  getClient(): ResearchClient {
    return this.researchClient;
  }

  private ensureProjectsSubscription(): void {
    if (this.activeProjectsUnsub !== null) return;
    this.activeProjectsUnsub = this.researchClient.subscribeProjects((projects) => {
      this.projectsState = { status: "ready", data: projects, error: null };
      for (const listener of this.projectsListeners) listener();
      if (this.fleetListeners.size > 0) {
        void this.refreshFleet();
      }
    });
  }

  private teardownProjectsSubscriptionIfIdle(): void {
    if (this.projectsListeners.size === 0 && this.fleetListeners.size === 0) {
      this.activeProjectsUnsub?.();
      this.activeProjectsUnsub = null;
    }
  }

  private refreshProjects(): void {
    void this.researchClient.listProjects().then(
      (projects) => {
        this.projectsState = { status: "ready", data: projects, error: null };
        for (const listener of this.projectsListeners) listener();
      },
      (error) => {
        this.projectsState = { status: "error", data: null, error: errorMessage(error) };
        for (const listener of this.projectsListeners) listener();
      },
    );
  }

  private refreshBackends(): void {
    void this.researchClient.listBackends().then(
      (backends) => {
        this.backendsState = { status: "ready", data: backends, error: null };
        for (const listener of this.backendsListeners) listener();
      },
      (error) => {
        this.backendsState = { status: "error", data: null, error: errorMessage(error) };
        for (const listener of this.backendsListeners) listener();
      },
    );
  }

  private async refreshFleet(): Promise<void> {
    const projects = await this.researchClient.listProjects().then(
      (list) => list,
      (error) => {
        this.fleetState = { status: "error", data: null, error: errorMessage(error) };
        for (const listener of this.fleetListeners) listener();
        return null;
      },
    );
    if (!projects) return;
    const snapshots = await Promise.all(
      projects.map((project) => this.researchClient.getSnapshot(project.id)),
    ).then(
      (list) => list,
      (error) => {
        this.fleetState = { status: "error", data: null, error: errorMessage(error) };
        for (const listener of this.fleetListeners) listener();
        return null;
      },
    );
    if (!snapshots) return;
    for (const snapshot of snapshots) {
      this.snapshotStates.set(snapshot.project.id, {
        status: "ready",
        data: snapshot,
        error: null,
      });
    }
    this.fleetState = { status: "ready", data: snapshots, error: null };
    for (const listener of this.fleetListeners) listener();
  }

  subscribeProjects = (listener: () => void): (() => void) => {
    this.projectsListeners.add(listener);
    this.ensureProjectsSubscription();
    if (!this.projectsLoaded) {
      this.projectsLoaded = true;
      this.refreshProjects();
    }
    return () => {
      this.projectsListeners.delete(listener);
      this.teardownProjectsSubscriptionIfIdle();
    };
  };

  getProjectsState = (): AsyncResource<ReadonlyArray<ResearchProject>> => this.projectsState;

  subscribeBackends = (listener: () => void): (() => void) => {
    this.backendsListeners.add(listener);
    if (!this.backendsLoaded) {
      this.backendsLoaded = true;
      this.refreshBackends();
    }
    return () => {
      this.backendsListeners.delete(listener);
    };
  };

  getBackendsState = (): AsyncResource<ReadonlyArray<BackendDescription>> => this.backendsState;

  subscribeFleet = (listener: () => void): (() => void) => {
    this.fleetListeners.add(listener);
    this.ensureProjectsSubscription();
    if (!this.fleetLoaded) {
      this.fleetLoaded = true;
      void this.refreshFleet();
    }
    return () => {
      this.fleetListeners.delete(listener);
      this.teardownProjectsSubscriptionIfIdle();
    };
  };

  getFleetState = (): AsyncResource<ReadonlyArray<ResearchWorkspaceSnapshot>> => this.fleetState;

  subscribeSnapshot(projectId: ResearchProjectId, listener: () => void): () => void {
    let listeners = this.snapshotListeners.get(projectId);
    if (!listeners) {
      listeners = new Set();
      this.snapshotListeners.set(projectId, listeners);
    }
    listeners.add(listener);

    if (!this.activeClientUnsubs.has(projectId)) {
      const unsub = this.researchClient.subscribe(projectId, (snapshot) => {
        this.snapshotStates.set(projectId, { status: "ready", data: snapshot, error: null });
        const set = this.snapshotListeners.get(projectId);
        if (set) {
          for (const cb of set) cb();
        }
        if (this.reportListeners.has(projectId)) {
          this.refreshReportHtml(projectId);
        }
      });
      this.activeClientUnsubs.set(projectId, unsub);
    }

    if (!this.snapshotStates.has(projectId)) {
      this.snapshotStates.set(projectId, LOADING_SNAPSHOT);
      void this.researchClient.getSnapshot(projectId).then(
        (snapshot) => {
          this.snapshotStates.set(projectId, { status: "ready", data: snapshot, error: null });
          const set = this.snapshotListeners.get(projectId);
          if (set) {
            for (const cb of set) cb();
          }
        },
        (error) => {
          this.snapshotStates.set(projectId, {
            status: "error",
            data: null,
            error: errorMessage(error),
          });
          const set = this.snapshotListeners.get(projectId);
          if (set) {
            for (const cb of set) cb();
          }
        },
      );
    }

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.snapshotListeners.delete(projectId);
        this.activeClientUnsubs.get(projectId)?.();
        this.activeClientUnsubs.delete(projectId);
      }
    };
  }

  getSnapshotState(projectId: ResearchProjectId): AsyncResource<ResearchWorkspaceSnapshot> {
    return this.snapshotStates.get(projectId) ?? LOADING_SNAPSHOT;
  }

  refreshReportHtml(projectId: ResearchProjectId): void {
    void this.researchClient.getReportHtml(projectId).then(
      (html) => {
        this.reportStates.set(projectId, { status: "ready", data: html, error: null });
        const set = this.reportListeners.get(projectId);
        if (set) {
          for (const cb of set) cb();
        }
      },
      (error) => {
        this.reportStates.set(projectId, {
          status: "error",
          data: null,
          error: errorMessage(error),
        });
        const set = this.reportListeners.get(projectId);
        if (set) {
          for (const cb of set) cb();
        }
      },
    );
  }

  subscribeReportHtml(projectId: ResearchProjectId, listener: () => void): () => void {
    let listeners = this.reportListeners.get(projectId);
    if (!listeners) {
      listeners = new Set();
      this.reportListeners.set(projectId, listeners);
    }
    listeners.add(listener);
    if (!this.reportStates.has(projectId)) {
      this.reportStates.set(projectId, LOADING_REPORT);
      this.refreshReportHtml(projectId);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.reportListeners.delete(projectId);
      }
    };
  }

  getReportState(projectId: ResearchProjectId): AsyncResource<string> {
    return this.reportStates.get(projectId) ?? LOADING_REPORT;
  }
}

const researchStore = new ResearchClientStore(new MockResearchClient());

export function getResearchClient(): ResearchClient {
  return researchStore.getClient();
}

export function refreshResearchReport(projectId: ResearchProjectId): void {
  researchStore.refreshReportHtml(projectId);
}

export function useResearchProjects(): AsyncResource<ReadonlyArray<ResearchProject>> {
  return useSyncExternalStore(researchStore.subscribeProjects, researchStore.getProjectsState);
}

export function useResearchBackends(): AsyncResource<ReadonlyArray<BackendDescription>> {
  return useSyncExternalStore(researchStore.subscribeBackends, researchStore.getBackendsState);
}

export function useResearchFleet(): AsyncResource<ReadonlyArray<ResearchWorkspaceSnapshot>> {
  return useSyncExternalStore(researchStore.subscribeFleet, researchStore.getFleetState);
}

export function useResearchSnapshot(
  projectId: ResearchProjectId,
): AsyncResource<ResearchWorkspaceSnapshot> {
  return useSyncExternalStore(
    (listener) => researchStore.subscribeSnapshot(projectId, listener),
    () => researchStore.getSnapshotState(projectId),
  );
}

export function useResearchReportHtml(projectId: ResearchProjectId): AsyncResource<string> {
  return useSyncExternalStore(
    (listener) => researchStore.subscribeReportHtml(projectId, listener),
    () => researchStore.getReportState(projectId),
  );
}
