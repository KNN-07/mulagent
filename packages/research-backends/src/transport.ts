// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodeChildProcess from "node:child_process";
import { baseSshArgs, shellSingleQuote } from "@t3tools/ssh/command";
export const quote = shellSingleQuote;
export const shell = (argv: readonly string[]) => argv.map(quote).join(" ");
export type Execute = (program: string, args: readonly string[], stdin?: string) => Promise<string>;
export const execute: Execute = (program, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      program,
      args,
      { maxBuffer: 16 * 1024 * 1024 },
      (err, out, stderr) =>
        err ? reject(new Error(stderr.trim() || err.message, { cause: err })) : resolve(out),
    );
    child.stdin?.on("error", () => {}).end(stdin);
  });
export function transport(run: Execute, host?: string): Execute {
  if (!host) return run;
  const args = baseSshArgs(
    { alias: host, hostname: host, username: null, port: null },
    { batchMode: "yes" },
  );
  return (program, argv, stdin) =>
    run("ssh", [...args, "--", host, shell([program, ...argv])], stdin);
}
