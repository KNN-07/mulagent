import * as NodeStreamConsumers from "node:stream/consumers";
import { completeSimple, getEnvApiKey } from "@oh-my-pi/pi-ai";
import type { Effort } from "@oh-my-pi/pi-ai";
import * as DateTime from "effect/DateTime";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { CompletionRequest, CompletionResult } from "./modelRouter.ts";

async function complete(request: CompletionRequest): Promise<CompletionResult> {
  const { route, systemPrompt, userPrompt } = request;
  const model = buildModel(route.model);
  const apiKey = getEnvApiKey(model.provider);
  if (!apiKey) throw new Error(`Missing pi-ai credentials for ${model.provider}`);
  const response = await completeSimple(
    model,
    {
      systemPrompt: [systemPrompt],
      messages: [
        {
          role: "user",
          content: userPrompt,
          timestamp: DateTime.toEpochMillis(DateTime.nowUnsafe()),
        },
      ],
    },
    {
      apiKey,
      reasoning: route.reasoning as Effort,
      cacheRetention: "none",
      hideThinkingSummary: true,
    },
  );
  if (response.stopReason !== "stop") {
    throw new Error(`Model ${model.id} ended with ${response.stopReason}`);
  }
  const { cost, ...usage } = response.usage;
  return {
    text: response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
    usage,
    ...(route.costConfigured ? { costUsd: cost.total } : {}),
  };
}

try {
  const request: CompletionRequest = JSON.parse(await NodeStreamConsumers.text(process.stdin));
  process.stdout.write(JSON.stringify(await complete(request)));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ error: error instanceof Error ? error.message : "pi-ai request failed" }),
  );
}
