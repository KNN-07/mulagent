import type { ResearchRunId, RunMetric } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { parsePlaceholders, resolvePlaceholders, selectMetricForRun } from "./placeholders.ts";

const r1 = "run-1" as ResearchRunId;
const r2 = "run-2" as ResearchRunId;

const sampleMetrics: RunMetric[] = [
  { runId: r1, name: "success", value: 0.71, step: 100, split: "train" },
  { runId: r1, name: "success", value: 0.742, step: 100, split: "val" },
  { runId: r1, name: "success", value: 0.776, step: 200, split: "holdout" },
  { runId: r2, name: "success", value: 0.654, split: "holdout" },
  { runId: r2, name: "nan_metric", value: Number.NaN },
];

describe("placeholders", () => {
  it("parses metric placeholders with runId and name", () => {
    const tokens = parsePlaceholders("Gain {{metric:run-1:success}} vs {{metric:run-2:success}}.");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.runId).toBe("run-1");
    expect(tokens[0]?.name).toBe("success");
    expect(tokens[1]?.runId).toBe("run-2");
    expect(tokens[1]?.name).toBe("success");
  });

  it("selects highest-priority split and latest step", () => {
    const selected = selectMetricForRun(sampleMetrics, r1, "success");
    expect(selected?.value).toBe(0.776);
    expect(selected?.split).toBe("holdout");

    const valSelected = selectMetricForRun(sampleMetrics, r1, "success:val");
    expect(valSelected?.value).toBe(0.742);
    expect(valSelected?.split).toBe("val");
  });

  it("resolves placeholders to anchored ledger links with data-run-id", () => {
    const result = resolvePlaceholders(
      "Latent achieved {{metric:run-1:success}} over {{metric:run-2:success}}.",
      sampleMetrics,
      { knownRunIds: new Set([r1, r2]) },
    );

    expect(result.missing).toHaveLength(0);
    expect(result.resolved).toHaveLength(2);
    expect(result.html).toContain('href="#run-run-1"');
    expect(result.html).toContain('data-run-id="run-1"');
    expect(result.html).toContain(">0.776</a>");
    expect(result.html).toContain('href="#run-run-2"');
    expect(result.html).toContain(">0.654</a>");
  });

  it("renders unresolvable placeholders as visible errors instead of guessing", () => {
    const result = resolvePlaceholders(
      "Missing run {{metric:run-999:success}}, missing metric {{metric:run-1:loss}}, nan {{metric:run-2:nan_metric}}.",
      sampleMetrics,
      { knownRunIds: new Set([r1, r2]) },
    );

    expect(result.resolved).toHaveLength(0);
    expect(result.missing.map((m) => m.reason)).toEqual([
      "missing-run",
      "missing-metric",
      "non-finite",
    ]);
    expect(result.html).toContain('class="metric-error"');
    expect(result.html).toContain("MISSING METRIC (unknown run): run-999:success");
    expect(result.html).toContain("MISSING METRIC (missing metric): run-1:loss");
    expect(result.html).toContain("MISSING METRIC (non-finite metric): run-2:nan_metric");
  });

  it("escapes surrounding HTML in writer templates", () => {
    const result = resolvePlaceholders(
      "<script>alert(1)</script> score={{metric:run-1:success}}",
      sampleMetrics,
    );
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.html).toContain(">0.776</a>");
  });
});
