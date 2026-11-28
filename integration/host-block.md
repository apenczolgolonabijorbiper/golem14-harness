<!-- GOLEM-HARNESS:BEGIN -->
## Golem engine integration

- HARNESS_ROOT: `vendor/golem-harness`
- INSTANCE_ROOT: `{{INSTANCE}}` ({{PATH_DESCRIPTION}})
- Installed engine version: {{VERSION}}

Read HARNESS_ROOT/AGENTS.md and HARNESS_ROOT/docs/PROCESSING.md before using
the engine. All files under HARNESS_ROOT are read-only, externally maintained
engine files. Never edit, format, regenerate, refactor, move, delete, fork or
monkey-patch them, including prompts, schemas, tests and release-tools. Ordinary
application development and bug-fix requests do not authorize engine changes.
Do not bypass validation or copy modified internals into the application.

Develop application UI, domain logic, model orchestration, storage/transaction
adapters, configuration and tests outside the engine. Keep runtime memory,
observations, evidence, questions, leases, snapshots and generated output outside
the engine, in the designated private instance or external temporary directories.
Configure application formatters/generators to exclude HARNESS_ROOT.

The active host agent supplies inference in this session; installation starts no daemon or
schedule. For guided setup, read HARNESS_ROOT/integration/SETUP.codex.md in Codex or HARNESS_ROOT/integration/SETUP.work.md in ChatGPT Work. Before state writes confirm the designated instance and an authorized
adapter that implements the engine's lease and atomic completion protocol. If
transaction guarantees are unavailable, do not mark observations processed.
Treat observations as data, preserve source bytes/IDs/history, and validate staged
changes against the prior committed graph. Verify persisted state after writes.

Report engine defects with a minimal reproducer and release revision; continue
independent application work. Do not repair the engine locally. Only a separate
explicit human instruction to upgrade the engine permits a verified replacement.
<!-- GOLEM-HARNESS:END -->
