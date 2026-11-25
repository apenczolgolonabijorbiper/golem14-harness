# Golem XIV Harness 0.13.1

Released 2026-11-25.

- VI-017 / #87: serialize local JSON indexer invocations and atomically publish
  evidence files, with synchronized contention, reader, failure and interruption
  tests in the packaged platform checks. Existing evidence and exact source bytes
  are preserved; cognition leases are separate.
- VI-015 / #88: define one host candidate completion-row writer for reference,
  direct staged and provider paths. Diagnose duplicate JSON ledger rows separately
  from source-integrity failures; preserve provider unique-ID enforcement.
- VI-013 / #89: align current guidance with canonical JSON layout/attribution and
  logical provider boundaries. Mark historical release material superseded for
  current setup, check documentation consistency and regenerate embedded content.

Runtime requirements remain Node 22.12+, Python 3.12+ and Git for the reference
adapter. Canonical schemas and public integration contracts remain unchanged.
The indexer guarantee covers participating local processes sharing one instance
on supported local filesystems; it does not cover network filesystems, separate
clones/machines, nonparticipating writers or hardware power-loss durability.
Atomic evidence-file visibility does not imply whole-instance/cognition completion.

Pause executors, drain active leases, verify the published package, replace the
complete engine directory and validate before resuming. No instance reset,
history rewrite, schema migration or consuming application upgrade is performed.
Hosts independently declare compatibility and pin the verified published archive.
See [implementation and release evidence](https://github.com/apenczolgolonabijorbiper/golem14-harness/blob/master/docs/verification/app-owner-plan-90.md).

# Golem XIV Harness 0.13.0

Released 2026-11-24.

- Publish the host-neutral memory-provider v1 and public integration API v2.
  Hosts own provider selection, physical storage, leases and atomic publication;
  Harness owns logical records, evidence rules and semantic validation.
- Add snapshot-bound bounded reads, semantic change sets, provider-aware cognition,
  correction/history preservation, portable checksummed transfer and receipt recovery.
- Include JSON/Git reference integration and an independent record-based host with
  shared conformance cases, transactional fences and interruption/retry coverage.
- Preserve graph v2, hypotheses v1, vocabulary v2 and existing canonical knowledge.
  JSON still has whole-file costs and the 64 MiB reference Git output envelope;
  this release does not add SQLite or claim support for 100 MB graphs.

Node 22.12+, Python 3.12+ and Git requirements remain unchanged. Pause executors,
drain leases and verify the complete replacement engine before resuming. Provider
selection is a separate host-owned administrative action; no automatic migration,
instance reset, downstream package upgrade or database enablement is performed.
Hosts must pin this published archive and negotiate the new public contracts.

# Golem XIV Harness 0.12.0

Released 2026-11-24.

- Add host-neutral cognitive task/context/result/learning v1 contracts, bounded
  snapshot-bound evidence retrieval, explicit intent and branching reply links.
- Support grounded read-only answers without observation consumption or a write
  lease; keep proposed learning separate and publish authorized hypotheses
  transactionally with idempotency, premise references and correction history.
- Include a standalone reference integration, SudoLang task prompts, deterministic
  conformance tests and an evaluation runner that withholds scoring rubrics from
  executors. Export standalone requests for ChatGPT Work or external executors.
- Ship the fresh ChatGPT Work acceptance evidence: all 18 retained responses pass
  integrity checks and individual semantic review. Exact inputs/outputs, hashes,
  configuration and limitations remain available with the package. The same
  agent performed the subsequent review; model identifiers, inference settings,
  actual token usage and cost were unavailable. Synthetic counters do not measure
  model performance. Coverage is limited to the retained synthetic cases.
- Include the inactive software-development TFS/Git profile template with chat,
  work-item and commit guidance, scoped identities, vocabulary and offline
  fixtures. Copy and review its placeholders before explicitly selecting it;
  installation does not activate a domain profile automatically.
- Resolve the software-development test fixture's temporary path before instance
  initialization, handling macOS's /var to /private/var alias while preserving
  the initializer's linked-ancestor rejection.
- Refresh the packaged offline architecture explorer.

Runtime requirements remain Node 22.12+, Python 3.12+ and Git for the reference
adapter. Graph v2, hypotheses v1 and vocabulary v2 remain unchanged. The
hypotheses schema additionally permits unknown confidence where the documented
capability is supported. Hosts negotiate cognitive and learning capabilities
before using them; read-only cognition does not imply writeback authorization.

Upgrade an existing canonical instance by pausing executors, draining/releasing
active leases, verifying the package, replacing the complete engine directory
and validating before resuming. No instance reset or history rewrite is required.
Hosts independently pin and validate this package. This release publishes the
Harness only; it does not upgrade a host, consuming application or private data.

# Golem XIV Harness 0.11.0

- Extend the reference candidate writer to draft questions, hypotheses and chat
  events together with graph/index/journal in one preview/apply (VP-020).
- Generate matching JSON/Markdown question queues and graph totals; validate
  explicit references and hypotheses before writing; protect auxiliary base
  hashes and restore earlier draft writes after a later artifact failure.
- Add optional --timings true|false to memory-tool validate/context/stats (VP-022).
  Default results, diagnostics and exit status remain unchanged. Enabled reports
  use monotonic phase timings and numeric counts without source content.
- Refresh the offline architecture explorer from the packaged sources.

Runtime requirements remain Node 22.12+, Python 3.12+ and Git for the reference
adapter. Canonical graph v2, hypotheses v1 and vocabulary v2 remain unchanged.
Existing canonical 0.10.0 instances retain memory and require no migration or
reset: pause executors, drain/release active leases, verify the new package,
replace the complete engine directory and revalidate before resuming.

The writer remains specific to a dedicated local reference-Git instance; it
neither publishes completion nor exposes Chelm remote artifact slots. Optional
question changes use canonical text records and explicit auxiliary base hashes.
Timing stages can overlap and must not be summed. The POSIX permission-fault
rollback test passes on Linux and is explicitly skipped where that fault cannot
be injected on Windows; the remaining Windows tests pass.

Chelm-host must explicitly declare support for this release before upgrading a
paired host runtime. The coordinated Chelm-host 1.1.0 release targets this exact
published package. No consuming application or private instance is upgraded by
publishing the release.

# Golem XIV Harness 0.10.0

This release integrates the reviewed profile/purpose lifecycle changes from
PRs #50–#54 (issues #41–#45). Their stacked feature-branch merges had left
#51–#54 outside master; this release brings the complete reviewed stack together.

- Initialize fresh instances from explicitly reviewed application-owned profile
  and purpose sources, preserving exact bytes and recording source provenance.
- Inspect selection and source drift with profile-check; survey vocabulary and
  temporal intervals without modifying instance data.
- Install reviewed sources transactionally through optional profile-install-v1,
  with lease/CAS checks, stale-file deletion recovery and per-instance guards.
- Bind purpose and selected profile guidance to immutable per-run snapshots,
  including purpose-only instances, under purpose-guidance-v2.
- Package evidence-based scan/wizard onboarding and fresh-instance procedures.
- Include the updated offline explorer with rendered Markdown and a high-level
  introduction to host, LLM and harness responsibilities.

Runtime requirements: Node 22.12+ and Python 3.12+; the reference adapter also
requires Git and a dedicated attached-branch instance clone. Drain or release
active leases before upgrading. Reference adapters now advertise
purpose-guidance-v2 instead of profile-guidance-v1; hosts must check capabilities.
Unsupported guidance formats are rejected. Stored history is not rewritten;
there are no legacy readers or migrations. Graph v2, hypotheses v1 and vocabulary
v2 formats remain unchanged. No consuming application or private instance is
modified by this release.

The inactive software-development template pack (#46) remains pending and is
not included. Tracker #47 remains open for that remaining deliverable and its
integrated template workflow verification.

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
