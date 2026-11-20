// @effect-diagnostics nodeBuiltinImport:off - Lean runs as a subprocess from a Promise-based library.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

export interface LeanDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
}

export function parseLeanDiagnostics(output: string): LeanDiagnostic[] {
  const diagnostics: LeanDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const lake = /^(error|warning|info): (.+?):(\d+):(\d+):\s*(.*)$/.exec(line);
    const lean = /^(.+?):(\d+):(\d+):\s*(error|warning|info):\s*(.*)$/.exec(line);
    const [severity, file, row, column, message] = lake
      ? lake.slice(1)
      : lean
        ? [lean[4], lean[1], lean[2], lean[3], lean[5]]
        : [];
    if (
      (severity === "error" || severity === "warning" || severity === "info") &&
      file &&
      message !== undefined
    ) {
      diagnostics.push({ severity, file, line: Number(row), column: Number(column), message });
      continue;
    }
    const general = /^(error|warning|info):\s*(.*)$/.exec(line);
    if (general?.[1] === "error" || general?.[1] === "warning" || general?.[1] === "info") {
      diagnostics.push({ severity: general[1], message: general[2] ?? "" });
      continue;
    }
    const last = diagnostics.at(-1);
    if (last && line.trim() && !/^[✔✖⚠]|^Build |^Some required/.test(line)) {
      diagnostics[diagnostics.length - 1] = { ...last, message: `${last.message}\n${line}` };
    }
  }
  return diagnostics;
}

const standardAxioms = new Set(["propext", "Classical.choice", "Quot.sound"]);

export interface AxiomAudit {
  readonly theorem: string;
  readonly axioms: readonly string[];
  readonly disallowed: readonly string[];
  readonly accepted: boolean;
}

export function parseLeanAxioms(output: string): AxiomAudit[] {
  const audits: AxiomAudit[] = [];
  const pattern =
    /^'([^\r\n]+)' (?:does not depend on any axioms(?=\s*$)|depends on axioms:\s*\[([^\]]*)\](?=\s*$))/gm;
  for (const match of output.matchAll(pattern)) {
    const theorem = match[1];
    if (theorem === undefined) continue;
    const listed = match[2]?.trim();
    const axioms = listed ? listed.split(",").map((axiom) => axiom.trim()) : [];
    const disallowed = axioms.filter((axiom) => !standardAxioms.has(axiom));
    audits.push({ theorem, axioms, disallowed, accepted: disallowed.length === 0 });
  }
  return audits;
}

interface LakeOptions {
  readonly lake?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

const run = NodeUtil.promisify(NodeChildProcess.execFile);

async function runLake(projectDir: string, args: string[], options: LakeOptions) {
  try {
    const output = await run(options.lake ?? "lake", args, {
      cwd: projectDir,
      timeout: options.timeoutMs ?? 300_000,
      maxBuffer: 8 * 1024 * 1024,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return { ...output, exitCode: 0 };
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      typeof error.code !== "number" ||
      !("stdout" in error) ||
      typeof error.stdout !== "string" ||
      !("stderr" in error) ||
      typeof error.stderr !== "string"
    )
      throw error;
    return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
  }
}

export async function buildLeanProject(projectDir: string, options: LakeOptions = {}) {
  const output = await runLake(projectDir, ["build"], options);
  return {
    ...output,
    diagnostics: [...parseLeanDiagnostics(output.stdout), ...parseLeanDiagnostics(output.stderr)],
  };
}

function assertLeanNames(names: readonly string[]) {
  const segment = "[\\p{L}_][\\p{L}\\p{N}_'?!]*";
  const dottedName = new RegExp(`^${segment}(?:\\.${segment})*$`, "u");
  if (
    !names.length ||
    names.some((name) => !dottedName.test(name) || name.startsWith("_root_.")) ||
    new Set(names).size !== names.length
  ) {
    throw new Error("Expected distinct, fully qualified Lean names");
  }
}

export async function auditLeanTheorems(
  projectDir: string,
  modules: readonly string[],
  theorems: readonly string[],
  options: LakeOptions = {},
) {
  assertLeanNames(modules);
  assertLeanNames(theorems);
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "research-lean-"));
  try {
    const file = NodePath.join(dir, "AxiomAudit.lean");
    await NodeFSP.writeFile(
      file,
      [
        ...modules.map((name) => `import ${name}`),
        "set_option pp.fullNames true",
        ...theorems.map((name) => `#print axioms _root_.${name}`),
        "",
      ].join("\n"),
    );
    const output = await runLake(projectDir, ["env", "lean", file], options);
    if (output.exitCode !== 0)
      throw new Error(
        `Lean axiom audit failed (exit ${output.exitCode})\n${output.stdout}${output.stderr}`,
      );
    const audits = parseLeanAxioms(output.stdout);
    return theorems.map((theorem) => {
      const matches = audits.filter((audit) => audit.theorem === theorem);
      if (matches.length !== 1 || matches[0] === undefined) {
        throw new Error(`Expected exactly one axiom result for ${theorem}`);
      }
      return matches[0];
    });
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
}

export async function verifyLeanProject(
  projectDir: string,
  modules: readonly string[],
  theorems: readonly string[],
  options: LakeOptions = {},
) {
  const build = await buildLeanProject(projectDir, options);
  const audits =
    build.exitCode === 0 ? await auditLeanTheorems(projectDir, modules, theorems, options) : [];
  return {
    accepted: build.exitCode === 0 && audits.every((audit) => audit.accepted),
    build,
    audits,
  };
}
