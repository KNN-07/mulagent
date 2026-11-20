// @effect-diagnostics-next-line nodeBuiltinImport:off - The Node-facing adapter runs pi-ai in a Bun subprocess.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import type { AssistantMessage, Effort, ModelSpec } from "@oh-my-pi/pi-ai";
import type { Role } from "./roles.ts";

export type ModelFamily = "openai" | "anthropic" | "google";

export interface ModelRoute {
  readonly family: ModelFamily;
  readonly model: ModelSpec;
  readonly reasoning: `${Effort}`;
  readonly costConfigured?: boolean;
}

export interface ModelRouterConfig {
  readonly roles: Readonly<Record<Exclude<Role, "critic">, ModelRoute>>;
  readonly critics: Readonly<Record<ModelFamily, ModelRoute>>;
}

function route(
  family: ModelFamily,
  id: string,
  api: ModelSpec["api"],
  baseUrl: string,
  reasoning: ModelRoute["reasoning"],
): ModelRoute {
  return {
    family,
    reasoning,
    model: {
      id,
      name: id,
      api,
      provider: family,
      baseUrl,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: null,
      maxTokens: null,
    },
  };
}

const sol = route("openai", "gpt-6.2-sol", "openai-responses", "https://api.openai.com/v1", "low");
const astra = route(
  "openai",
  "gpt-6.2-astra",
  "openai-responses",
  "https://api.openai.com/v1",
  "high",
);
const fable = route(
  "anthropic",
  "claude-fable-5-2",
  "anthropic-messages",
  "https://api.anthropic.com",
  "high",
);
const hydrogen = route(
  "google",
  "gemini-4-hydrogen",
  "google-generative-ai",
  "https://generativelanguage.googleapis.com/v1beta",
  "low",
);

export const defaultModelRouterConfig: ModelRouterConfig = {
  roles: {
    scout: sol,
    surveyor: astra,
    ideator: fable,
    tournament: astra,
    noveltySearch: hydrogen,
    novelty: astra,
    planner: astra,
    analyst: astra,
    writer: astra,
    prover: astra,
    backTranslation: fable,
    debug: sol,
  },
  critics: { openai: fable, anthropic: astra, google: fable },
};

export class ModelRouter {
  readonly #config: ModelRouterConfig;

  constructor(config: ModelRouterConfig = defaultModelRouterConfig) {
    for (const family of ["openai", "anthropic", "google"] as const) {
      if (config.critics[family].family === family) {
        throw new Error(`The critic for ${family} must use a different model family`);
      }
    }
    this.#config = config;
  }

  select(role: Role, authorFamily?: ModelFamily): ModelRoute {
    if (role !== "critic") return this.#config.roles[role];
    if (authorFamily === undefined || !Object.hasOwn(this.#config.critics, authorFamily)) {
      throw new Error("Critic routing requires the author's model family");
    }
    const critic = this.#config.critics[authorFamily];
    if (critic.family === authorFamily)
      throw new Error("The critic must use a different model family");
    return critic;
  }
}

export interface CompletionRequest {
  readonly route: ModelRoute;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

type TokenUsage = Omit<AssistantMessage["usage"], "cost">;

export interface CompletionResult {
  readonly text: string;
  readonly usage?: TokenUsage;
  readonly costUsd?: number;
}

export type Complete = (
  request: CompletionRequest,
  signal?: AbortSignal,
) => Promise<CompletionResult>;

export function createPiAiCompletion({
  bun = "bun",
  timeoutMs = 300_000,
  worker = NodeURL.fileURLToPath(new URL("./piAiWorker.ts", import.meta.url)),
}: {
  readonly bun?: string;
  readonly timeoutMs?: number;
  readonly worker?: string;
} = {}): Complete {
  return (request, signal) =>
    new Promise((resolve, reject) => {
      const child = NodeChildProcess.execFile(
        bun,
        ["--no-env-file", worker],
        { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) },
        (error, stdout) => {
          if (error) {
            reject(new Error(`pi-ai worker failed (${error.code ?? error.signal ?? error.name})`));
            return;
          }
          try {
            const response: { readonly error: string } | CompletionResult = JSON.parse(stdout);
            if ("error" in response) throw new Error(response.error);
            if (typeof response.text !== "string") throw new Error("Invalid pi-ai worker response");
            resolve(response);
          } catch (error) {
            reject(error);
          }
        },
      );
      child.stdin?.on("error", reject);
      child.stdin?.end(JSON.stringify(request));
    });
}
