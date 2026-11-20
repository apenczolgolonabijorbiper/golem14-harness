# Golem XIV Harness 0.6.1

This patch bounds child processes that could block adapter conformance checks,
and clarifies complete engine replacement during upgrades.

- Fixture and adapter Git/validator commands time out after 60 seconds; a whole
  conformance CLI call has 180 seconds. Stdin is closed unless supplying explicit
  bytes. Git credential/terminal prompts are disabled. Synthetic fixture commits
  disable inherited signing and hooks.
- Timeout errors identify the command and retain available partial stderr.
  GOLEM_TRACE_COMMANDS=1 logs synchronous children before they start. See ADAPTERS.md
  for PowerShell diagnosis and the expected Windows result. The original reporting
  machine's specific stalled command has not been established.
- Upgrade by replacing the entire engine directory, removing stale release-tools/
  and other obsolete engine files. Preserve external instance data and host files.
- A denied symlink privilege produces a diagnostic for that assertion only; other
  unsafe-path checks remain active.
- Processed-memory transfer (VI-007) remains future work. Observation-only transfer
  preserves observations but requires destination re-analysis; copying individual
  graph or ledger fragments is unsupported.

Local packaged checks pass 45 Node tests, four Python unittest cases and both
installer regression scripts. Windows/macOS results are recorded in the PR.

Regression checks exercise a deliberately stalled child, EOF/noninteractive Git,
exact binary input, and the existing conformance, memory and installer suites.
The 0.6.0 layout and claim compatibility rules are unchanged.

VI-011 clarification after a complete workstation run: 0.6.0 passes all 17
conformance tests in about 18 minutes, with overlapping workloads. The reported
non-completion is withdrawn. Missing child timeouts remain confirmed; workstation
performance improvement is not claimed. See ADAPTERS.md for measured durations
and the distinction between child limits and hosted CI's job budget.
