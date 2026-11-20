import type { ExperimentSpec, Run, RunMetric } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useState } from "react";

import { computeBestSoFarChart, DEFAULT_CHART_GEOMETRY, type BestSoFarPoint } from "./chart.logic";
import { formatMetricValue } from "./researchPresentation";

interface BestSoFarChartProps {
  readonly runs: ReadonlyArray<Run>;
  readonly metrics: ReadonlyArray<RunMetric>;
  readonly spec: Pick<ExperimentSpec, "metric" | "higherIsBetter" | "baseline">;
  readonly scopeLabel?: string;
}

export function BestSoFarChart({ runs, metrics, spec, scopeLabel }: BestSoFarChartProps) {
  const gt = useGT();
  const [selectedRunNumber, setSelectedRunNumber] = useState<number | null>(null);
  const model = computeBestSoFarChart(runs, metrics, spec, DEFAULT_CHART_GEOMETRY);

  const selectedPoint: BestSoFarPoint | null =
    selectedRunNumber === null
      ? model.bestPoint
      : (model.points.find((point) => point.runNumber === selectedRunNumber) ?? model.bestPoint);

  const chartDescription = gt(
    "Best {metric} after each run: {best} across {total} runs, {kept} kept, {crashed} crashed.",
    {
      metric: spec.metric,
      best: formatMetricValue(model.bestValue),
      total: model.counts.total,
      kept: model.counts.kept,
      crashed: model.counts.crashed,
    },
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-info" aria-hidden="true" />
            <T>kept</T>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full border border-muted-foreground"
              aria-hidden="true"
            />
            <T>discarded</T>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-destructive" aria-hidden="true">
              ×
            </span>
            <T>crash</T>
          </span>
          {model.baselineValue !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-3 border-t border-dashed border-muted-foreground"
                aria-hidden="true"
              />
              <T>
                baseline <Var>{formatMetricValue(model.baselineValue)}</Var>
              </T>
            </span>
          ) : null}
        </div>
        {selectedPoint ? (
          <span className="font-mono text-foreground tabular-nums">
            <T>
              Run <Var>{selectedPoint.runNumber}</Var>:{" "}
              <Var>{formatMetricValue(selectedPoint.value)}</Var>
            </T>
          </span>
        ) : null}
      </div>

      <svg
        viewBox={`0 0 ${DEFAULT_CHART_GEOMETRY.width} ${DEFAULT_CHART_GEOMETRY.height}`}
        className="block w-full max-w-xl"
        role="img"
        aria-label={chartDescription}
      >
        <line
          x1={model.plotLeft}
          y1={model.xAxisY}
          x2={model.plotRight}
          y2={model.xAxisY}
          stroke="currentColor"
          className="text-border"
        />

        {model.baselineY !== null && model.baselineValue !== null ? (
          <g className="text-muted-foreground">
            <line
              x1={model.plotLeft}
              y1={model.baselineY}
              x2={model.plotRight}
              y2={model.baselineY}
              stroke="currentColor"
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <text
              x={model.plotRight}
              y={model.baselineY - 5}
              textAnchor="end"
              fontSize="9"
              fill="currentColor"
            >
              {gt("baseline {value}", { value: formatMetricValue(model.baselineValue) })}
            </text>
          </g>
        ) : null}

        {model.stepPath ? (
          <path
            d={model.stepPath}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-info"
          />
        ) : null}

        {model.points.map((point) => {
          const isSelected = selectedPoint?.runNumber === point.runNumber;
          if (point.kind === "crash") {
            return (
              <g
                key={point.runId}
                className="cursor-pointer text-destructive"
                onMouseEnter={() => setSelectedRunNumber(point.runNumber)}
                onClick={() => setSelectedRunNumber(point.runNumber)}
              >
                <path
                  d={`M${point.x - 3} ${point.y - 3}l6 6M${point.x + 3} ${point.y - 3}l-6 6`}
                  stroke="currentColor"
                  strokeWidth={1.5}
                />
              </g>
            );
          }

          if (point.kind === "kept") {
            return (
              <circle
                key={point.runId}
                cx={point.x}
                cy={point.y}
                r={isSelected ? 3.5 : 2.5}
                fill="currentColor"
                className="cursor-pointer text-info"
                onMouseEnter={() => setSelectedRunNumber(point.runNumber)}
                onClick={() => setSelectedRunNumber(point.runNumber)}
              />
            );
          }

          return (
            <circle
              key={point.runId}
              cx={point.x}
              cy={point.y}
              r={isSelected ? 3.5 : 2.5}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeDasharray={point.kind === "running" ? "1.5 1.5" : undefined}
              className="cursor-pointer text-muted-foreground"
              onMouseEnter={() => setSelectedRunNumber(point.runNumber)}
              onClick={() => setSelectedRunNumber(point.runNumber)}
            />
          );
        })}

        {model.bestPoint && model.bestValue !== null ? (
          <text
            x={model.bestPoint.x}
            y={Math.max(12, model.bestPoint.y - 7)}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
            className="text-foreground"
          >
            {formatMetricValue(model.bestValue)}
          </text>
        ) : null}

        <g fontSize="9" fill="currentColor" textAnchor="middle" className="text-muted-foreground">
          {model.ticks.map((tick) => (
            <text key={tick.ordinal} x={tick.x} y={DEFAULT_CHART_GEOMETRY.height - 8}>
              {tick.ordinal}
            </text>
          ))}
        </g>
      </svg>

      <p className="text-xs text-muted-foreground">
        {scopeLabel ? (
          <T>
            Best <Var>{spec.metric}</Var> after each run · <Var>{model.counts.total}</Var> runs,{" "}
            <Var>{model.counts.kept}</Var> kept, <Var>{model.counts.crashed}</Var> crashed · scope:{" "}
            <Var>{scopeLabel}</Var>
          </T>
        ) : (
          <T>
            Best <Var>{spec.metric}</Var> after each run · <Var>{model.counts.total}</Var> runs,{" "}
            <Var>{model.counts.kept}</Var> kept, <Var>{model.counts.crashed}</Var> crashed
          </T>
        )}
      </p>
    </div>
  );
}
