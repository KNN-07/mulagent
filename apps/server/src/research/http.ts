import { ResearchRunId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as ResearchComputeService from "./ResearchComputeService.ts";
import * as Layer from "effect/Layer";
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const service = yield* ResearchComputeService.ResearchComputeService;
    return HttpRouter.add(
      "POST",
      "/api/research/runs/:runId/:operation",
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;
        const id = params.runId,
          op = params.operation;
        if (!id || !op || !["metrics", "params", "artifacts", "status", "finish"].includes(op))
          return HttpServerResponse.empty({ status: 404 });
        const req = yield* HttpServerRequest.HttpServerRequest;
        const auth = req.headers.authorization;
        if (!auth?.startsWith("Bearer ") || !service.authorize(id, auth.slice(7)))
          return HttpServerResponse.empty({ status: 401 });
        const body = yield* req.json;
        yield* service.ingest(ResearchRunId.make(id), auth.slice(7), op, body);
        return HttpServerResponse.empty({ status: 204 });
      }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 400 }))),
    );
  }),
);
