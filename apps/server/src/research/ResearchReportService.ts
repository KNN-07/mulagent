import { type ResearchProjectId, ResearchOperationError } from "@t3tools/contracts";
import {
  renderReport,
  mapRunsToWandbPayloads,
  mapRunsToMlflowPayloads,
} from "@t3tools/research-report";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ResearchLedgerService from "./ResearchLedgerService.ts";

const make = Effect.gen(function* () {
  const store = yield* ResearchLedgerService.ResearchLedgerService;
  const read = Effect.fn("ResearchReportService.read")(function* (id: ResearchProjectId) {
    return yield* Effect.try({
      try: () => store.snapshot(id),
      catch: () => new ResearchOperationError({ operation: "read report" }),
    });
  });
  const html = Effect.fn("ResearchReportService.html")(function* (id: ResearchProjectId) {
    const s = yield* read(id);
    return renderReport(s, s.metrics, {
      sweeps: s.sweeps,
      branchSpecs: Object.fromEntries(s.branches.flatMap((b) => (b.spec ? [[b.id, b.spec]] : []))),
    });
  });
  const trackerExport = Effect.fn("ResearchReportService.trackerExport")(function* (
    id: ResearchProjectId,
    sink: "wandb" | "mlflow",
  ) {
    const s = yield* read(id);
    return sink === "wandb"
      ? mapRunsToWandbPayloads(s, s.metrics)
      : mapRunsToMlflowPayloads(s, s.metrics);
  });
  return { html, trackerExport };
});
export class ResearchReportService extends Context.Service<
  ResearchReportService,
  Effect.Success<typeof make>
>()("t3/research/ResearchReportService") {}
export const layer = Layer.effect(ResearchReportService, make);
