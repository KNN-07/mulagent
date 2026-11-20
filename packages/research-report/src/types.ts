import type { RunMetric } from "@t3tools/contracts";

export interface BranchSpecOption {
  readonly metric?: string | undefined;
  readonly higherIsBetter?: boolean | undefined;
  readonly baseline?: number | undefined;
  readonly split?: RunMetric["split"] | undefined;
}

export interface SweepRowSpec {
  readonly label: string;
  readonly metric?: string | undefined;
  readonly treatmentRunIds: ReadonlyArray<string>;
  readonly baselineRunIds?: ReadonlyArray<string> | undefined;
  readonly baselineValue?: number | undefined;
  readonly note?: string | undefined;
}

export interface SweepTableSpec {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly metric: string;
  readonly split?: RunMetric["split"] | undefined;
  readonly higherIsBetter?: boolean | undefined;
  readonly unit?: string | undefined;
  readonly rows: ReadonlyArray<SweepRowSpec>;
}

export interface RenderReportOptions {
  readonly title?: string | undefined;
  readonly template?: string | undefined;
  readonly primaryMetric?: string | undefined;
  readonly higherIsBetter?: boolean | undefined;
  readonly baseline?: number | undefined;
  readonly baselines?: Readonly<Record<string, number>> | undefined;
  readonly branchSpecs?: Readonly<Record<string, BranchSpecOption>> | undefined;
  readonly sweeps?: ReadonlyArray<SweepTableSpec> | undefined;
  readonly generatedAt?: string | undefined;
  readonly precision?: number | undefined;
}

export interface WandbRunPayload {
  readonly runId: string;
  readonly name: string;
  readonly project: string;
  readonly group: string;
  readonly jobType: string;
  readonly state: "running" | "finished" | "failed" | "killed";
  readonly notes: string;
  readonly tags: ReadonlyArray<string>;
  readonly config: Readonly<Record<string, string | number | boolean | null>>;
  readonly summary: Readonly<Record<string, string | number | boolean | null>>;
  readonly history: ReadonlyArray<Readonly<Record<string, number>>>;
}

export interface MlflowParam {
  readonly key: string;
  readonly value: string;
}

export interface MlflowMetric {
  readonly key: string;
  readonly value: number;
  readonly timestamp: number;
  readonly step: number;
}

export interface MlflowTag {
  readonly key: string;
  readonly value: string;
}

export interface MlflowRunPayload {
  readonly runId: string;
  readonly experimentName: string;
  readonly runInfo: {
    readonly runName: string;
    readonly status: "SCHEDULED" | "RUNNING" | "FINISHED" | "FAILED" | "KILLED";
    readonly startTimeMs: number;
    readonly endTimeMs?: number | undefined;
  };
  readonly params: ReadonlyArray<MlflowParam>;
  readonly metrics: ReadonlyArray<MlflowMetric>;
  readonly tags: ReadonlyArray<MlflowTag>;
}
