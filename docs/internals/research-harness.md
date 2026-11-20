# Research harness

MulAgent is a fork of T3 Code that adds an autonomous ML research loop. Agents read papers,
propose ideas, run experiments on any compute backend, check every result, and write reports.
The human approves at gates. This page records the decisions every module depends on.

## Non-negotiable rules

1. **Provenance.** Agents never type a result. Every number in a finding, report or UI comes from
   a `RunMetric` row in the ledger, with its `ResearchRunId`. Reports render numbers only from
   ledger queries.
2. **Doer and judge are separate.** A critic in a fresh context, from the other model family,
   tries to break each finding: Claude Fable critiques GPT Astra/Sol work and vice versa.
3. **Frozen specs.** An `ExperimentSpec` is hashed when approved (`specHash`). The integrity
   checker flags any run whose code changed the metric, split, seeds, baseline or locked eval.
4. **Every run is reported**, including discarded, crashed and pruned ones.
5. **At least 3 seeds and a CI per claim**, or the claim is labelled preliminary.
6. **State lives in the ledger**, never in an agent's context. Any agent can crash and restart.

## Shared types

`packages/contracts/src/research.ts` holds the domain schemas (project, workflow node, branch,
spec, run, metric, finding, gate, Lean claim, backend, job, snapshot). Every module uses them.
Change them only additively, and only in the owning workstream (the server integration).

## Packages and owners

| Path                         | Contents                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/research-core`     | Ledger (SQLite via `node:sqlite`, migrations), workflow YAML parser and DAG runner (fan-out, prune, join k-of-N, loop-back as new nodes, resume), gates and decision questions, budgets, integrity checks (spec diff, leakage, sanity, stats with bootstrap CIs), scale-ladder promotion. Pure library, no server imports.                                                                                        |
| `packages/research-backends` | `Backend` interface (`describe`, `submit`, `status`, `logs`, `cancel`, `fetch`) and adapters: local (process or Docker/Podman), SSH, SLURM, PBS (batch scripts, `squeue`/`sacct`/`qstat` queue checking, multi-node via `--nodes`/`select=`, preemption-safe checkpoints), Kubernetes, and a cloud adapter (Modal, RunPod). A scheduler matches a `ResourceRequest` to backends by cost, queue wait and priority. |
| `packages/research-agents`   | Role prompts and runners for scout, surveyor, ideator (Elo tournament), novelty, planner, analyst, critic, writer, prover. Literature clients: Semantic Scholar, arXiv, OpenAlex. Lean helpers (`lake build`, `#print axioms` check). Uses `@oh-my-pi/pi-ai` for direct model calls.                                                                                                                              |
| `packages/research-report`   | Self-contained HTML report generated from a `ResearchSnapshot` plus metrics: findings, run tables, best-so-far charts (inline SVG), lineage, every number linked to its run. Also the W&B and MLflow sink mappings on the TypeScript side.                                                                                                                                                                        |
| `python/mulagent`            | Python SDK used inside experiment jobs: `log_metric`, `log_run`, emits `METRIC name=value` lines (omp autoresearch-compatible) and writes to the ledger over HTTP, with optional W&B and MLflow mirroring. `mulagent-job` entrypoint for backends.                                                                                                                                                                |
| `apps/server/src/research`   | Effect services wiring research-core, backends, agents and report into the server; RPC methods; MCP tools so agents can call the ledger, gates and scheduler; workflow agents run as T3 threads on Claude, Codex or Gemini providers.                                                                                                                                                                             |
| `apps/web/src/research`      | Research UI: research thread with decision questions, branch workspace (results doc + agent panel), gate review, lineage graph, fleet view, report view. Visual reference: `docs/internals/research-mockups/`.                                                                                                                                                                                                    |

## Workflow files

Workflows live in `workflows/*.yaml` at the project root (defaults ship in
`packages/research-core/workflows/`): `research`, `reproduce`, `survey`, `prove`, `hillclimb`.
A node names its `agent`, `needs`, optional `gate`, `mode` (`fanout`, `tournament`, `join`) and
`budget_hours`. Loop-back always creates new nodes, so history stays acyclic.

## Hillclimb

Hillclimb follows omp's `autoresearch` protocol: editable files listed, eval locked at a commit,
a fixed time budget per run, keep only if the holdout improves, log every run including crashes.
Runs print `METRIC name=value` lines that the SDK and the runner both parse.
