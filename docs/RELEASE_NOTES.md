# Golem XIV Harness 0.9.1

- Include the standalone Interactive Architecture Explorer at
  `docs/architecture-explorer.html` in the release ZIP and integrity manifest.
- Regenerate the page from current checkout sources before every release build;
  keep the generator, template, metadata and tests repository-only.
- Release workflow retains the generated page in Git and as a separate workflow
  artifact. Lightweight CI handles explorer/docs-only changes; runtime and
  packaging changes retain full platform validation.
- No runtime schema or processing contract changes.

# Golem XIV Harness 0.9.0

- Reference Git adapter reuses immutable snapshot metadata for index checks,
  modes and reconciliation; groups index updates; compares recovery entries by
  blob identity and mode instead of reading one blob per process.
- Optional `--timings true` emits monotonic stage durations and Git command counts
  with fixed labels, including setup. Failures attach safe timing diagnostics on
  stderr. Default command responses are unchanged.
- Memory loading reads sources in bounded batches of eight, retaining exact-byte
  hashes and deterministic source ordering.
- `processor/write-candidate.mjs` consumes a structured change set, checks base
  hashes and source/lease state, preserves history and writes graph/index/journal
  drafts. Preview is the default. It does not publish or change leases/ledger.
- Added realistic-size synthetic cycle benchmarks, performance guidance and
  regression tests included in packaged release verification.

Target graph/hypothesis/vocabulary formats remain unchanged. Candidate reuse is
not implemented: adapter validate and commit still validate independently. There
is no model client, scheduler, automatic application profile or parallel writer.
See PERFORMANCE.md for the helper's scope, host responsibilities and measurements.

# Golem XIV Harness 0.8.0

VP-013 (#35) adds `memory-tool.mjs merge --base BASE --ours OURS --theirs THEIRS
--out OUT` for completed same-base candidate snapshots after the owner head moves.

- Keyed graph, queue and hypotheses merges retain history; inherited ledger rows
  remain unchanged, while newly processed IDs on both sides refuse even if equal.
- Exact source/evidence/journal bytes are preserved. Removal, divergent record
  changes, immutable file edits, duplicate run paths and changed guidance refuse.
- Both branches validate against base and the combined graph against ours.
  Same-name new entities remain separate with bounded review warnings.
- Conflicts produce JSON and exit 1 without output creation. Existing, overlapping,
  engine, symlink and nonportable output paths are refused. Snapshot budgets are
  64 MiB/50,000 entries per input; reports expose truncation metadata.
- Concurrent Markdown edits keep ours and require regeneration. Combined graphs
  also flag the index; inconsistent readable queues require repair. Such output
  is a review draft, requiring summary review and full revalidation before commit.
- Host-owned bounded source reservations may inform oldest eligible unreserved
  selection. No reservation runtime or reference claim exclusion option is added.

See CANDIDATE_MERGE.md for the complete contract. The helper never modifies inputs,
leases or Git refs and does not publish. Snapshot capture, authentication, ancestry,
source/ledger/lease checks and atomic CAS publication remain host responsibilities.
The reference adapter still completes only its own claimed sources. Selective
cross-instance processed-memory transfer (#18) remains separate.

Target formats remain graph v2, hypotheses v1 and vocabulary v2; canonical paths
only. No backward compatibility or migration layer is introduced. The release
builder runs the new regression suite plus existing runtime, conformance, Python
and installer checks, then generates the manifest, ZIP and SHA-256 checksum.
Hosted platform and capacity results are recorded in the implementation PR.
