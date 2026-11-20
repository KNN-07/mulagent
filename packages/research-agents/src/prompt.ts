// @effect-diagnostics-next-line nodeBuiltinImport:off -- Role templates are package assets in source checkouts.
import * as NodeFSP from "node:fs/promises";
import type { Role } from "./roles.ts";

declare const __MULAGENT_ROLE_PROMPTS__: Record<Role, string>;
export async function rolePrompt(role: Role, directory?: URL) {
  if (!directory && typeof __MULAGENT_ROLE_PROMPTS__ !== "undefined")
    return __MULAGENT_ROLE_PROMPTS__[role];
  return NodeFSP.readFile(
    new URL(role + ".md", directory ?? new URL("../prompts/", import.meta.url)),
    "utf8",
  );
}
