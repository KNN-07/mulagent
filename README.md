<img src="assets/icon.svg" width="64" height="64" alt="">

# MulAgent

MulAgent is an open-source harness for autonomous machine learning research. Agents survey
literature, plan and run experiments, review findings, and assemble reports. The research ledger
tracks every run, and approval gates let you review decisions before work continues.

The web and desktop clients open to the research fleet. Coding threads are available from the
sidebar. The mobile client connects to MulAgent environments for coding workflows.

<!-- Screenshot placeholder: the Research fleet with a project awaiting gate review. -->

## Quickstart

Install Vite+ on Linux or macOS and open a new shell so `vp` is on your path.

```sh
curl -fsSL https://vite.plus | bash
```

```sh
git clone https://github.com/KNN-07/mulagent.git
cd mulagent
vp i
vp run dev
```

Open the web URL printed by the dev runner. To configure a local CPU backend,
record experiment metrics and review your first run, follow the
[research setup guide](docs/user/research.md).

For architecture and research workflows, see the [research harness guide](docs/internals/research-harness.md).

MulAgent is distributed under the [MIT License](LICENSE). See [NOTICE](NOTICE) for upstream credits.
