# Contributing to MulAgent

Report reproducible bugs in Issues. Include the commit, the affected client or
compute backend, steps to reproduce, and the expected and observed behavior.
For research results, include the workflow and seed when relevant. Redact private
data from logs and reports. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

Use Discussions to propose a new workflow, backend or other feature. The
[quickstart](README.md#quickstart) explains how to run MulAgent locally.

## One problem per PR

Keep each change focused. Describe the behavior it fixes, link the issue or
discussion, and include the focused checks you ran. For a visible client change,
attach a before-and-after capture. For a backend fix, include a test covering the
failure. Run `vp run check:changed` before pushing.
