# Analysis-cycle performance

Measure host/agent time separately from deterministic adapter time. A small inbox
does not imply a cheap reasoning task: fragmented revision history, repeated
schema discovery and a generated cycle script can dominate the elapsed cycle.
This release reduces deterministic overhead and supplies reusable draft assembly.
It does not select a model, schedule work or decide domain semantics.

## Measure before tuning

The reference Git CLI accepts an optional flag on all six commands:

```sh
node adapters/reference-git/adapter.mjs validate --instance ../private-instance --run RUN_UUID --outputs memory/events/event.md --timings true
node adapters/reference-git/adapter.mjs commit --instance ../private-instance --run RUN_UUID --outputs memory/events/event.md --timings true
```

Success JSON adds `timings`. Failure after adapter construction emits a
`GOLEM_TIMINGS ` JSON line on stderr before the ordinary refusal. Without this
flag, success and failure output retain the usual format. The factory accepts
`timings: true`; failures expose `error.timings`.

| Field | Meaning |
|---|---|
| operation | Reference adapter command |
| elapsed_ms | Monotonic elapsed duration of this operation, excluding construction |
| setup | Construction elapsed time and Git counters; reported separately, not added to elapsed_ms |
| phases | Calls and elapsed_ms for snapshot, scan, index_check, build_tree, materialize, validator, candidate, source_check, publish and recovery when reached |
| counts | Candidate tree files/bytes, output files, claimed sources and graph sizes when candidate validation succeeds |
| git | Total calls/elapsed_ms and counts/durations grouped by fixed Git subcommand |

Phases nest and overlap: candidate includes validator, materialization and other
work; publish includes recovery. Do not sum them. Cached snapshot calls may take
almost no time. For CLI wall time also allow for Node startup, result serialization
and host tool transport. `setup` describes one factory construction; reused factory
objects repeat that same setup metadata rather than measuring it again.

Metrics collect no arguments, source text, paths, subprocess output or credentials.
Normal adapter result fields are unchanged and can still contain private paths
and guidance. Failures during factory construction have no operation report.
Concurrent operations on one factory must use separate factory objects when
collecting metrics, since counters are per object.

Record host timestamps for instruction loading, eligibility, claim, input loading,
retrieval, model inference, draft generation, validation, repairs and publication.
Record the installed release, host OS, Node/Git versions, source bytes, graph
entity/claim/source counts and candidate file count. Use provider-reported token
counts when available; record unknown measurements as unknown. Tool command time
alone cannot explain model or orchestration delays. Metrics are diagnostic output,
not additional private files automatically stored in the instance.

## Reusable candidate writer

`processor/write-candidate.mjs` targets an external, dedicated local Git instance
supported by the reference adapter. It reads committed lease state using status;
it never acquires, renews or releases a lease. Other backends require their own
draft integration. Read the contract, purpose, selected guidance, relevant memory
and full claimed observations; perform identity retrieval and semantic review first.

Supply a UTF-8 JSON change set outside the instance, normally in host scratch:

```json
{
  "schema_version": 1,
  "run_id": "00000000-0000-4000-8000-000000000001",
  "base_graph_sha256": "EXACT_SHA256_OF_CURRENT_GRAPH_BYTES",
  "base_index_sha256": "EXACT_SHA256_OF_CURRENT_INDEX_BYTES",
  "entities": [],
  "entity_additions": [],
  "claims": [],
  "claim_statuses": [],
  "review": "Describe sources reviewed, changes, uncertainties, alternatives, warnings and unresolved questions.",
  "model": "unknown"
}
```

Replace example identifiers and hashes with actual values. Use the host-reported
model identifier, or `unknown` if unavailable. The two hashes cover the exact
working-tree bytes, not reserialized JSON. Unknown top-level/change-operation
fields fail. The CLI bounds the input change-set file at 8 MiB.

| Field | Behavior |
|---|---|
| entities | Append complete schema-valid entity records with new opaque ent-UUID IDs |
| entity_additions | Entries `{id, source_ids?, aliases?, external_ids?}` append unique values to an existing entity; identity fields are retained |
| claims | Append complete schema-valid clm-UUID claims, including exact quotations and attribution; no claim fields are inferred |
| claim_statuses | Entries `{id, status}` set retained active claims to superseded or retracted; replacement/history rules still validate |
| review | Required agent-written semantic review, retained in index and run journal; never synthesized by this helper |

Before preview/apply, include an explicit `Completion record:` pointer in `review`,
keyed by instance and run ID. Choose the message of the analysis commit containing
the journal, an exact external report location or retained Git notes, following
[the verification-pointer rule](PROCESSING.md#verification-record-and-journal-pointer-vi-019).
For example: `Completion record: message of the analysis commit containing this
journal; instance INSTANCE; run RUN_ID.` Use this option only when the host retains
the actual results there; a generic commit title is insufficient.

The generated verification section records only the local structural preflight
as passed and marks host checks pending. The writer preserves the pointer in
`review`; it does not choose a report location, create a report or populate a
commit message. The reference adapter's `complete RUN_ID` message is only a label,
so its caller must select and retain a separate report unless another host adapter
supplies the full commit-message record. Retain checks performed after publication
in a linked durable follow-up when necessary. No change-set or memory schema is
added; pointer selection is the host/agent's procedural responsibility.

Missing operation arrays mean empty arrays. Duplicate IDs or repeated updates,
invalid provenance/quotations and invalid history refuse before draft writes.
Claimed graph sources are assembled from the lease and exact observed bytes.
The helper updates the graph timestamp, appends a cycle review to the existing
index and creates the run journal with source hashes, model and claimed guidance
identity when present. Existing run journals are preserved by refusing overwrite.

Preview first, then apply the same reviewed change set:

```sh
node processor/write-candidate.mjs --root ../private-instance --changes ../scratch/changes.json
node processor/write-candidate.mjs --root ../private-instance --changes ../scratch/changes.json --apply true
```

Preview performs structural checks and returns file names/counts without writes.
Apply rechecks committed head, lease, source bytes and draft base hashes, then
always drafts `memory/graph.json`, `memory/index.md` and `memory/runs/RUN.md`; optional cycle artifacts are described below.
It preflights regular-file destinations and rejects symlinks/unsafe directories.
Use one draft writer in an isolated agent workspace; these working-tree writes
are not an atomic transaction or a lock against other local editors. On an I/O
error it attempts to restore completed writes still matching its own output;
after termination or partial I/O inspect/preserve drafts and restore this cycle's
files before retrying. It refuses a graph already containing the claimed sources.

The helper preserves current questions and hypotheses and checks them for
structural consistency. Supplying those records remains the agent/host's responsibility. The writer can assemble both queues, hypotheses and chat events; evidence indexing remains the indexer's responsibility. Write and
review those artifacts as required before adapter completion. Draft preflight is
not proof of semantic truth, committed history integrity or transaction validity.
It uses a proposed ledger only in memory; it never writes the ledger or lease.

Finish with the normal adapter candidate validate, commit and persisted-state
verification. Include additional event files in `--outputs`. The helper's three
files are already mandatory adapter paths. A successful draft response explicitly
states that adapter validation and commit remain required. Do not pass the input
change-set file as an output or commit host scratch accidentally.

## Host orchestration and input quality

- Keep an explicitly selected domain profile concise and commit it before claim.
  Define identifiers, predicates, state-history conventions and evidence strength
  once. The agent still reads claimed guidance each cycle. Configuration is
  application-owned; no profile or vocabulary is inferred automatically here.
- Deliver complete software revision records with upstream IDs, revision order,
  timestamps and original text. Do not cut mid-line. Preserve immutable source
  bytes and provenance; use a new source for a corrected ingestion record.
- Batch independent reads and reuse already-read unchanged instructions within
  the session. Recheck state and claimed guidance as required; avoid repeated
  command/help discovery and generated transaction scripts.
- Observe background process completion using the host's execution-session wait
  facility instead of a fixed sleep. Do not invent a sleep/wait command in the
  adapter. If no observations are eligible, return without writes and let the
  host invoke another cycle when ready. The 60-second age gate is unchanged.
- Renew only when the remaining lease duration warrants it. Preserve ownership,
  expiry and error handling. Never remove integrity checks to improve a timing.

## Reproducible benchmarks

```sh
node tools/benchmark-cycle.mjs 5,10,20 3
node tools/benchmark-capacity.mjs 500,2000,5000,10000 256
node tools/benchmark-capacity.mjs 2000 2048
```

The cycle probe creates fresh synthetic external instances, uses approximately
3.5 KB bodies (about 70 KB for 20 sources), and opens a fresh adapter per operation
to match CLI cache lifetime. It reports JSON lines with wall time and metrics for
status, claim, candidate validation and commit. Fixture setup and synthetic graph
generation are excluded. `model_ms: null` means no inference was measured. Compare
medians and tail latency on the same host; do not equate synthetic adapter timing
with end-to-end agent throughput. Cleanup removes the synthetic instances.

The capacity probe remains the source of large-graph resource-envelope evidence.
Git tree/index metadata and index updates are now batched; writing each raw blob
still uses one hash-object process. Full-tree capture/materialization, source
integrity checks and independent validation at commit remain. Bounded source
reads use batches of eight; their benefit depends on filesystem latency.

## Follow-up work

Use measured phase/counter data to prioritize persistent immutable candidate reuse
(with freshness/ownership/policy/source checks), remaining blob-write batching or
source parse caching. None is enabled in this release. Compare end-to-end batch
sizes with semantic-quality checks before considering parallel preparation.
The reference still has one processing lease and no concurrent writer backend.

## Local implementation evidence

On Linux with Node 24.22.3, three repetitions per batch compared the baseline
master revision `3af16df` with these changes, using the cycle probe above and a
fresh adapter per operation. Median milliseconds including factory construction:

| Batch | Baseline validate | Updated validate | Baseline commit | Updated commit |
|---|---:|---:|---:|---:|
| 5 | 228.0 | 145.5 | 354.2 | 219.2 |
| 10 | 258.6 | 171.7 | 400.9 | 200.9 |
| 20 | 387.4 | 193.4 | 548.5 | 250.7 |

The updated 20-source probe recorded 39 Git calls in validation and 57 in commit,
excluding each factory's three setup Git calls. This small synthetic graph and
local filesystem do not establish Windows or application/model latency. Three
samples are preliminary evidence, not a reliable tail-latency estimate. The
existing capacity fixture at 500 sources/5,000 entities/20,000 claims also passed;
its single-run timing is not used to claim a speedup. CI runs cycle probes on
Linux and Windows and packaged correctness checks on Linux, Windows and macOS.


## Complete cycle drafts (VP-020)

The reference writer supports a dedicated local Git instance owned by the reference
adapter. It is not a remote Chelm artifact-upload API or a generic contract-v1
adapter binding. It never infers claims, leases, evidence or ledger completion.

Optional change-set fields (schema_version remains 1):

| Field | Meaning |
|---|---|
| questions | Array of full canonical records keyed by id: id, text, status, source_observation_id; optional created_at, answer, analysis. Updates merge by ID; unmentioned records survive. Closed records need analysis.status=answered and analysis.source_observation_ids. Empty array changes nothing. |
| hypotheses | Full schema-1 replacement document, including collection updated_at. No record uncertainty field; updated_at must cover record timestamps. |
| events | Array of observation_id, question_id, answer, answered_at; each targets a claimed observation and a known question, matching any source question_id. Existing events are never overwritten. |
| base_files_sha256 | Required map for every optional output: existing bytes' SHA-256, or null for a new event. Include both question queue paths. |
| at | Optional UTC timestamp used for graph/journal generation. Preview returns at; reuse it for predictable apply content. |

Omitted sections preserve existing bytes. Preview makes no directories/files and
lists the exact planned outputs; it aggregates independent semantic diagnostics.
Apply rechecks the current head, owned lease, guidance, source bytes and base
files. It creates safe missing event directories, writes temporary files before
replacement and restores only its own still-matching outputs after failure.
Existing unrelated drafts are preserved. The output files still need adapter
validate/commit; run memory-tool validate after publication (the real ledger is
still pending before completion). Queue Markdown uses literal text fences;
graph totals are computed while unrelated index prose is retained.

## Memory command timings (VP-022)

validate, context and stats accept --timings true|false. Omitted/false preserves
existing output bytes and exit behavior. True adds timings with elapsed_ms,
phases, counts and git, using fixed names only. Validation stages are load,
schema, graph (identities/questions), provenance (ledger/sources/entities),
claims, history and hypotheses. Profile loading is separate. Context also
measures query/render; stats measures stats. Stages skipped after an earlier
failure are absent. No validation pass is repeated. Counters/Git are empty when
no work is recorded. Durations exclude process startup and final JSON encoding.
On failure the original diagnostic and nonzero exit remain; enabled timing is
one additional JSON object on stderr. Timings describe work, never correctness.
