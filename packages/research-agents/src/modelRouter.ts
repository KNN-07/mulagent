import * as Schema from "effect/Schema";
import type { Role } from "./roles.ts";

export type ModelFamily = "openai" | "anthropic" | "google";

const routeFields = { model: Schema.NonEmptyString, effort: Schema.Literals(["low", "high"]) };
const modelRoute = Schema.Union([
  Schema.Struct({
    ...routeFields,
    family: Schema.Literal("openai"),
    instanceId: Schema.Literal("codex"),
  }),
  Schema.Struct({
    ...routeFields,
    family: Schema.Literal("anthropic"),
    instanceId: Schema.Literal("claudeAgent"),
  }),
  Schema.Struct({
    ...routeFields,
    family: Schema.Literal("google"),
    instanceId: Schema.Literal("antigravity"),
  }),
]);
export type ModelRoute = typeof modelRoute.Type;

export interface ModelRouterConfig {
  readonly roles: Readonly<Record<Exclude<Role, "critic"> | "coder" | "hardCoder", ModelRoute>>;
  readonly critics: Readonly<Record<ModelFamily, ModelRoute>>;
}

const sol = { family: "openai", instanceId: "codex", model: "gpt-6.2-sol", effort: "low" } as const;
const astra = { ...sol, model: "gpt-6.2-astra", effort: "high" } as const;
const fable = {
  family: "anthropic",
  instanceId: "claudeAgent",
  model: "claude-fable-5-2",
  effort: "high",
} as const;
const hydrogen = {
  family: "google",
  instanceId: "antigravity",
  model: "gemini-4-hydrogen",
  effort: "low",
} as const;
const neon = { ...hydrogen, model: "gemini-4-neon", effort: "high" } as const;

export const defaultModelRouterConfig: ModelRouterConfig = {
  roles: {
    scout: sol,
    surveyor: hydrogen,
    ideator: fable,
    tournament: astra,
    noveltySearch: hydrogen,
    novelty: sol,
    planner: astra,
    analyst: astra,
    writer: astra,
    prover: astra,
    backTranslation: fable,
    coder: neon,
    hardCoder: astra,
    debug: sol,
  },
  critics: { openai: fable, anthropic: astra, google: fable },
};

const decodeOverrides = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      roles: Schema.optional(Schema.Record(Schema.String, modelRoute)),
      critics: Schema.optional(Schema.Record(Schema.String, modelRoute)),
    }),
  ),
  { onExcessProperty: "error" },
);

export function routerFromJson(source: string) {
  const overrides = decodeOverrides(source);
  for (const group of ["roles", "critics"] as const) {
    for (const key of Object.keys(overrides[group] ?? {})) {
      if (!Object.hasOwn(defaultModelRouterConfig[group], key))
        throw new Error("Unknown research route: " + key);
    }
  }
  return new ModelRouter({
    roles: { ...defaultModelRouterConfig.roles, ...overrides.roles },
    critics: { ...defaultModelRouterConfig.critics, ...overrides.critics },
  });
}

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

  select(role: Role | "coder" | "hardCoder", authorFamily?: ModelFamily): ModelRoute {
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
