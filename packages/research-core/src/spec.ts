// @effect-diagnostics-next-line nodeBuiltinImport:off -- Specs are hashed inside synchronous SQLite transactions.
import { createHash } from "node:crypto";
import type { ExperimentSpec } from "@t3tools/contracts";

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + Array.from(value, canonicalJson).join(",") + "]";
  if (
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const fields = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return (
      "{" + fields.map(([key, v]) => JSON.stringify(key) + ":" + canonicalJson(v)).join(",") + "}"
    );
  }
  throw new Error("Expected finite JSON data");
}

export type SpecWithSplit = ExperimentSpec & { readonly splitHash?: string };

export function specHash(spec: SpecWithSplit): string {
  const { specHash: _hash, ...contents } = spec;
  return createHash("sha256").update(canonicalJson(contents)).digest("hex");
}

export function freezeSpec(spec: SpecWithSplit, frozenAt: string) {
  const frozen = { ...spec, frozenAt };
  return { ...frozen, specHash: specHash(frozen) };
}
