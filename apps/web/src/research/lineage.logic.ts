import type {
  BackendDescription,
  BranchId,
  ExperimentSpec,
  ResearchBranch,
  Run,
  RunMetric,
  ScaleRung,
  WorkflowNode,
} from "@t3tools/contracts";

import { latestMetricValueByRun } from "./chart.logic";

export type LineageTone = "main" | "info" | "guest" | "muted" | "success" | "warning";

export interface LineageLane {
  readonly id: string;
  readonly branchId: BranchId | null;
  readonly label: string;
  readonly title: string;
  readonly tone: LineageTone;
  readonly laneIndex: number;
}

export interface LineageLaneSegment {
  readonly laneIndex: number;
  readonly tone: LineageTone;
  readonly top: boolean;
  readonly bottom: boolean;
}

export type LineageNodeMarker = "filled" | "hollow" | "warning" | "pruned";

export interface LineageGraphRow {
  readonly node: WorkflowNode;
  readonly laneIndex: number;
  readonly tone: LineageTone;
  readonly marker: LineageNodeMarker;
  readonly activeLanes: ReadonlyArray<LineageLaneSegment>;
  readonly bridgeSpan: {
    readonly fromLane: number;
    readonly toLane: number;
    readonly kind: "fanout" | "merge";
  } | null;
}

export type RungProgressState = "passed" | "active" | "pending" | "pruned";

export interface BranchScaleRungItem {
  readonly rung: ScaleRung;
  readonly state: RungProgressState;
}

export interface BranchInspectorStats {
  readonly bestMetric: number | null;
  readonly totalRuns: number;
  readonly keptRuns: number;
  readonly crashedRuns: number;
  readonly backendLabel: string;
  readonly rungs: ReadonlyArray<BranchScaleRungItem>;
}

const SCALE_RUNGS: ReadonlyArray<ScaleRung> = ["toy", "small", "target"];

function toneForBranch(branch: ResearchBranch, index: number): LineageTone {
  if (branch.kind === "lean") return "success";
  if (branch.status === "pruned") return "muted";
  const palette: ReadonlyArray<LineageTone> = ["info", "guest", "warning", "info"];
  return palette[index % palette.length] ?? "info";
}

function buildLineageLanes(branches: ReadonlyArray<ResearchBranch>): ReadonlyArray<LineageLane> {
  const lanes: LineageLane[] = [
    {
      id: "main",
      branchId: null,
      label: "main",
      title: "",
      tone: "main",
      laneIndex: 0,
    },
  ];
  let experimentIdx = 0;
  for (const branch of branches) {
    const tone = toneForBranch(branch, branch.kind === "lean" ? 0 : experimentIdx);
    if (branch.kind !== "lean" && branch.status !== "pruned") {
      experimentIdx += 1;
    }
    lanes.push({
      id: branch.id,
      branchId: branch.id,
      label: branch.label,
      title: branch.title,
      tone,
      laneIndex: lanes.length,
    });
  }
  return lanes;
}

function markerForNode(node: WorkflowNode): LineageNodeMarker {
  if (node.status === "waiting-gate" || node.status === "waiting-question") return "warning";
  if (node.status === "pruned") return "pruned";
  if (node.verdict !== undefined || node.kind === "prove" || node.kind === "custom") {
    return "filled";
  }
  return "hollow";
}

export function buildLineageGraph(
  nodes: ReadonlyArray<WorkflowNode>,
  branches: ReadonlyArray<ResearchBranch>,
): {
  readonly lanes: ReadonlyArray<LineageLane>;
  readonly rows: ReadonlyArray<LineageGraphRow>;
} {
  const lanes = buildLineageLanes(branches);
  const laneByBranchId = new Map<BranchId, LineageLane>();
  for (const lane of lanes) {
    if (lane.branchId !== null) {
      laneByBranchId.set(lane.branchId, lane);
    }
  }

  // Newest nodes appear at the top (matching git-log / Branches mockup order).
  const ordered = [...nodes].sort((a, b) => {
    const ta = Date.parse(a.startedAt ?? "");
    const tb = Date.parse(b.startedAt ?? "");
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
    return 0;
  });

  // Track vertical span [firstRow, lastRow] for each lane (top=0, bottom=n-1).
  const laneMinRow = new Map<number, number>();
  const laneMaxRow = new Map<number, number>();

  const fanoutRowIndex = ordered.findIndex(
    (node) => node.branchId === undefined && (node.kind === "custom" || node.key === "fanout"),
  );
  const mergeRowIndex = ordered.findIndex(
    (node) => node.branchId === undefined && node.kind === "merge",
  );

  for (let rowIdx = 0; rowIdx < ordered.length; rowIdx += 1) {
    const node = ordered[rowIdx];
    if (!node) continue;
    const lane = node.branchId ? (laneByBranchId.get(node.branchId) ?? lanes[0]) : lanes[0];
    if (!lane) continue;
    const prevMin = laneMinRow.get(lane.laneIndex);
    const prevMax = laneMaxRow.get(lane.laneIndex);
    laneMinRow.set(lane.laneIndex, prevMin === undefined ? rowIdx : Math.min(prevMin, rowIdx));
    laneMaxRow.set(lane.laneIndex, prevMax === undefined ? rowIdx : Math.max(prevMax, rowIdx));
  }

  // Main lane runs across all rows; child lanes begin at fanoutRowIndex (bottom) and rise to merge or latest branch node.
  if (ordered.length > 0) {
    laneMinRow.set(0, 0);
    laneMaxRow.set(0, ordered.length - 1);
  }
  for (const lane of lanes) {
    if (lane.laneIndex === 0) continue;
    const branch = branches.find((candidate) => candidate.id === lane.branchId);
    if (fanoutRowIndex !== -1) {
      const existingMax = laneMaxRow.get(lane.laneIndex);
      laneMaxRow.set(
        lane.laneIndex,
        existingMax === undefined ? fanoutRowIndex : Math.max(existingMax, fanoutRowIndex),
      );
    }
    if (mergeRowIndex !== -1 && branch && branch.status !== "pruned") {
      const existingMin = laneMinRow.get(lane.laneIndex);
      laneMinRow.set(
        lane.laneIndex,
        existingMin === undefined ? mergeRowIndex : Math.min(existingMin, mergeRowIndex),
      );
    }
  }

  const rows: LineageGraphRow[] = ordered.map((node, rowIdx) => {
    const lane = node.branchId ? (laneByBranchId.get(node.branchId) ?? lanes[0]!) : lanes[0]!;
    const activeLanes: LineageLaneSegment[] = [];

    for (const candidate of lanes) {
      const minRow = laneMinRow.get(candidate.laneIndex);
      const maxRow = laneMaxRow.get(candidate.laneIndex);
      if (minRow === undefined || maxRow === undefined) continue;
      if (rowIdx < minRow || rowIdx > maxRow) continue;
      activeLanes.push({
        laneIndex: candidate.laneIndex,
        tone: candidate.tone,
        top: rowIdx > minRow,
        bottom: rowIdx < maxRow,
      });
    }

    let bridgeSpan: LineageGraphRow["bridgeSpan"] = null;
    if (rowIdx === fanoutRowIndex && lanes.length > 1) {
      bridgeSpan = { fromLane: 0, toLane: lanes.length - 1, kind: "fanout" };
    } else if (rowIdx === mergeRowIndex && lanes.length > 1) {
      const mergedMax = activeLanes.reduce(
        (max, seg) => (seg.bottom ? Math.max(max, seg.laneIndex) : max),
        0,
      );
      if (mergedMax > 0) {
        bridgeSpan = { fromLane: 0, toLane: mergedMax, kind: "merge" };
      }
    }

    return {
      node,
      laneIndex: lane.laneIndex,
      tone: lane.tone,
      marker: markerForNode(node),
      activeLanes,
      bridgeSpan,
    };
  });

  return { lanes, rows };
}

export function computeBranchStats(
  branch: ResearchBranch,
  runs: ReadonlyArray<Run>,
  metrics: ReadonlyArray<RunMetric>,
  spec: ExperimentSpec | undefined,
  backends: ReadonlyArray<BackendDescription>,
): BranchInspectorStats {
  const branchRuns = runs.filter((run) => run.branchId === branch.id);
  const metricName = spec?.metric ?? "success_h32";
  const higherIsBetter = spec?.higherIsBetter ?? true;
  const valuesByRun = latestMetricValueByRun(metrics, metricName);

  const relevantRuns = spec
    ? branchRuns.filter(
        (run) => valuesByRun.has(run.id) || run.verdict === "crash" || run.status === "running",
      )
    : branchRuns;
  const effectiveRuns = relevantRuns.length > 0 ? relevantRuns : branchRuns;

  let bestMetric: number | null = null;
  let keptRuns = 0;
  let crashedRuns = 0;

  for (const run of effectiveRuns) {
    if (run.verdict === "keep") keptRuns += 1;
    if (run.verdict === "crash" || run.status === "failed") crashedRuns += 1;
    const value = valuesByRun.get(run.id);
    if (value !== undefined) {
      if (bestMetric === null || (higherIsBetter ? value > bestMetric : value < bestMetric)) {
        bestMetric = value;
      }
    }
  }

  const backendId = branchRuns.find((run) => run.backendId !== undefined)?.backendId;
  const backendLabel =
    (backendId ? backends.find((backend) => backend.id === backendId)?.label : undefined) ??
    backends[0]?.label ??
    "local";

  const currentRungIdx = SCALE_RUNGS.indexOf(branch.rung);
  const rungs: BranchScaleRungItem[] = SCALE_RUNGS.map((rung, index) => {
    if (index < currentRungIdx) return { rung, state: "passed" };
    if (index === currentRungIdx) {
      if (branch.status === "pruned" || branch.status === "failed") {
        return { rung, state: "pruned" };
      }
      if (branch.status === "done" || branch.status === "promoted") {
        return { rung, state: "passed" };
      }
      return { rung, state: "active" };
    }
    return { rung, state: "pending" };
  });

  return {
    bestMetric,
    totalRuns: effectiveRuns.length,
    keptRuns,
    crashedRuns,
    backendLabel,
    rungs,
  };
}
