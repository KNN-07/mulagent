# Running a research project

Open **Research** in the web or desktop client and choose **New project**. Enter a goal, choose a workflow and set the approval policy and compute budget. Each branch runs its experiments in a Git worktree. Open a gate to answer a question or approve a job. The report links measured values to their runs and includes their integrity verdicts.

## Configure a compute backend

Place `research-backends.yaml` beside the environment’s `settings.json` and restart the server. A local CPU backend can use this configuration.

```yaml
backends:
  - description:
      id: local
      kind: local
      label: Local CPU
      gpusTotal: 0
      usdPerGpuHour: 0
      healthy: true
      preemptible: false
    workRoot: /var/tmp/mulagent-jobs
    maxConcurrent: 2
    spendCapUsd: 0
```

Choose an absolute, writable `workRoot` outside the project checkout. Local jobs use `rsync` to stage the workspace. Install Python and the MulAgent SDK in the job environment. For workers on another host or inside a container, set `MULAGENT_LEDGER_URL` in the server environment to an HTTP(S) origin the worker can reach. The default uses the server’s loopback address and port. The server supplies each job with this URL, its run ID, its seed and a run-specific bearer token.

## Record evidence

Log the frozen metric and its matched baseline on the `holdout` split. Log initial and final `loss` on the `train` split and record the training and test example IDs as `trainIds` and `testIds` parameters. When the spec freezes a split hash, include the measured `splitHash`. A pinned evaluation file must match its Git blob before and after the command. The server checks the SDK receipt and the process exit before publishing the result.

For a multi-seed comparison, use the same change label for the planned seeds and record the same code and data hashes for the matched runs. The report marks evidence preliminary until the integrity checker has all planned seeds, at least three distinct seeds, and a confidence interval that excludes zero.
