# Golem XIV Harness 0.7.0

This release implements the P1/P2 scope in tracker #20 (issues #21–#28). It targets
fresh graph-v2 instances, strict hypotheses-v1 records and vocabulary-v2 policies.
Old layouts, claim aliases and unversioned hypothesis records are not supported;
incompatible previous instances may be scrapped/recreated. No migration is added.
The configuration/ledger/lease/queue wrappers remain version 1.

- Source capacity rises from 500 to 10,000 with schema-derived stats.capacity and
  capacity_near_limit warnings at 80%. Linux/Windows capacity CI measures complete
  file-reading/validation/retrieval and real Git candidate paths. See
  CAPACITY_BENCHMARKS.md for payload and memory limitations.
- Raw Git batch capture replaces process-per-file snapshots, preserving exact
  bytes and CAS/index/recovery checks. A raw tree must fit the 64 MiB child budget.
- Canonical scoped external_ids support exact value/scheme/namespace lookup,
  explicitly declared prefix aliases, duplicate warnings and append-only history.
  Identifier equality never merges records automatically.
- single_valued policy detects conflicting active objects. --current and --valid-at
  filter before truncation/graph expansion, expose ties/uncertain alternatives and
  distinguish effective time from recording-time heuristics. As-of retrieval is
  not a past knowledge-state reconstruction.
- Hypotheses are parsed and validated, including version, references, confidence
  range and evidence-bearing statuses. depends_on claims use bounded unique IDs,
  iterative cycle checks and immutable history. dependency_changed prompts review
  of direct changed support/refutation without deciding truth or changing status.
- Vocabulary policy content is retained with claim guidance. Committed policy
  changes during a lease require release/reclaim. core-policies-v2 advertises the
  target checks; scaffolds can require capabilities before acquisition.
- Reusable analysis/retrieval and producer recipes cover profile adoption, targeted
  lookup, warnings/questions, semantic revision boundaries and incremental intake.
  The synthetic repeated-fetch example emits 3 observations instead of 8 while
  retaining all 3 unique revisions; no consumer app is modified.
- Tool output bounds include 1,000 warnings with total/truncation metadata,
  100 primary entities/source records and 64,000 total excerpt characters.

Local tests cover target formats and integrity, including 65 Node tests, four
Python unittest cases and Cursor/Codex installer suites. Exact hosted platform and
benchmark outcomes belong to the implementation PR. Build/manifest/checksum are
produced by the release builder; no manual manifest edits are needed.

P3 experiments and gated groups, attributed edges, units/structured values and
identity reconciliation (#29–#33) remain pending. Processed-memory transfer #18
also remains a separate feature request.
