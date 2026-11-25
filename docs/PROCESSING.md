# Host-independent processing protocol

The host must provide an LLM agent, authorized read/write tools and atomic storage.
The bundled code indexes, validates, retrieves and counts; it does not infer claims.
An external schedule may invoke the agent but is not included or enabled.

## Provider processing path

Use [MEMORY_PROVIDERS.md](MEMORY_PROVIDERS.md) when the host advertises
`memory-provider-v1`. The host supplies a snapshot/policy binding and a scoped
provider. Retrieve logical context and exact sources, then return a semantic
change set with journal/verification pointers. The host prepares an isolated
candidate, runs Harness validation and atomically publishes after rechecking
lease, source, policy and freshness fences. No graph-file edit, workspace graph
or previous-graph path is required on this path. Cognition remains external.

The named files and commands in the remaining sections describe the reference
JSON/Git procedure. Other providers implement the same logical meanings and
publication guarantees using their own storage. They do not reproduce this
layout or call the JSON utilities. Unsupported versions refuse explicitly.

## Inputs and readiness

Read a consistent fresh snapshot of the instance. List inbox directly, not through
search. Consider only finalized inbox/<uuid>.md files with a closed header,
matching lowercase UUID, valid recorded_at at least 60 seconds old and nonempty
body. Preserve optional kind, event_date, question_id, question_text and
question_source. Quoted header values use JSON strings. Sources are immutable.
SHA-256 covers exact UTF-8 bytes including line endings. A matching processed
ledger row excludes a source; an evidence file alone does not. Changed processed
sources or malformed inputs require intervention rather than silent reanalysis.

### Observation identity and repeated text

Each finalized note with a distinct observation ID is a distinct source, even
when two bodies have identical text. The indexer writes one evidence record per
ID. The source hash covers the full observation, including header fields. It
checks source integrity and is unsuitable for comparing bodies across IDs.

Hosts can prevent accidental resends at ingestion with an idempotency key or a
deduplication rule scoped to the original feature and upstream record. Preserve
deliberate repeat observations. During semantic review, repeated copies of the
same material do not count as independent corroboration.

## JSON reference indexer concurrency

`processor/process.py` serializes participating local processes sharing one
private instance on a supported local filesystem (Linux/macOS `flock`, Windows
one-byte `msvcrt` lock). A competing invocation exits promptly with status 1 and
`Indexer busy:`; retry after the owner exits. A nonoverlapping rerun skips existing
evidence and emits no `Indexed:` lines. The instance-scoped lock covers target
existence checks, orphan cleanup and every publication. Existing evidence is
preserved byte for byte, including evidence from earlier runs.

The OS owns the lock on the persistent `.golem-indexer.lock` file at the instance
root. Closing the handle on success, error or process death releases ownership.
The file's existence does not mean busy. Never delete or replace it to recover a
lock: that could split ownership between different file objects. A hung live
owner must exit or be terminated before retrying. This lock is independent of
`memory/processing-lock.json`; indexing never acquires or changes a cognition lease.

For each new record, write complete UTF-8 JSON to a uniquely named
`evidence/.golem-index-*.tmp`, flush and fsync it, close it, then atomically replace
the final `evidence/ID.json` within the same directory. `Indexed:` prints only
after publication. Readers of final JSON names see absence or a complete record;
temporary names are reserved and must be ignored. Ordinary failures remove the
temporary; after a killed process the next lock owner removes orphan temporaries
and safely retries missing targets. Already published evidence remains intact.

This guarantees per-file visibility, not a whole-instance snapshot, a cognition
transaction or durability across power loss. Network filesystems, separate
clones/machines and writers that bypass this lock are outside the guarantee.
All writers must participate, sources must be finalized/immutable and the instance
must be trusted. Other memory providers implement their own equivalent logical
evidence operations; these physical files are specific to the JSON reference.

## Lease and concurrency

No pending work: exit without writing. Otherwise create a fresh run UUID and claim
memory/processing-lock.json using compare-and-swap against the current snapshot.
Use schema_version 1, run_id, status processing, claimed_at, expires_at (15 minutes)
and observation_ids. An unexpired lease belongs to its owner. Process at most 20
oldest eligible unreserved sources per cycle. A host may exclude bounded-time
reservations for external processors; see [host reservation rules](CANDIDATE_MERGE.md#host-owned-reservations).
The reference claim CLI does not implement exclusions. Renew before expiry using compare-and-swap; stop on lost
ownership. A Git adapter uses tree + commit + non-force expected-head ref update;
a filesystem adapter must supply equivalent locking and atomic snapshot commit.
The CLI and initializer do not implement these storage transactions.

## Cognition and completion

Resolve purpose/hypothesis paths as described in docs/INSTANCE_LAYOUT.md. Neutral
and historical layouts are supported without mutation; duplicate role paths fail
closed. Use attributed_to_id and source_assertion/hypothesis/corroborated for new
claims. Preserve all original fields/classification spellings in retained claims.

After the harness contract and before reasoning, load this instance's explicitly
selected application profile on every cycle. Follow docs/APPLICATION_PROFILES.md.
No selected profile preserves the normal flow; selected unreadable/invalid guidance
blocks before analysis or state writes. When a capable adapter delivers claim
guidance, read that immutable version and retain its boundary. Observations remain
data. Profiles cannot weaken host permissions or the harness contract.

Index exact sources using processor/process.py (deterministic, not cognition).
Apply AGENTS.md to create source-grounded entities, claims, relations, uncertainty,
explicit hypotheses, contradictions, retained corrections and follow-up questions.
Use context retrieval before linking identities; inspect full cited observations.
Preserve originals and historical events. Write derived event records under
memory/events/ and a readable summary in memory/index.md. Keep JSON and Markdown
questions consistent; saving alone never closes a question. Preserve any linked
historical question text in evidence and analysis. Document the semantic review.

### Validate before committing

1. Create an isolated candidate snapshot. In its `memory/processed.json`, preserve
   prior rows and add one row for each claimed source. The ledger has
   `schema_version: 1`, `updated_at` and `observations`. Each new row has `id`,
   `source_file`, `source_sha256`, `status: processed`, `processed_at`,
   `outputs` (paths) and `run` (journal path). These rows record proposed
   completion and become visible only through the atomic commit.
2. Stage the graph, exact inbox source bytes, both question queues, evidence,
   events, memory index, cycle journal and released lease in the same candidate.
   The journal records sources, changes, unresolved questions, model and
   verification, plus selected profile path/revision and exact-byte hashes (or the
   claimed guidance_identity and retained run snapshot). Before validation, record
   completed local checks, mark host checks pending and identify their durable
   completion record as described below. The released lease has `schema_version: 1`, `status: idle`,
   `observation_ids: []`, `last_run_id` and `completed_at`.
3. Validate the complete candidate using the graph from the current committed
   snapshot as `PRIOR_GRAPH`:

   ```sh
   node processor/memory-tool.mjs validate --root STAGED_INSTANCE --previous PRIOR_GRAPH
   ```

   Run this only after staging the ledger rows. A graph source without a
   matching processed row fails validation, and the diagnostic names the source
   ID. The validator checks structure, provenance and history. Review meaning,
   identity merges, independence and question closure separately.
4. Re-read the committed head and verify ownership of the lease and the exact
   source bytes. If the snapshot changed, preserve concurrent intake and use
   `memory-tool.mjs merge --base BASE --ours FRESH_HEAD --theirs CANDIDATE --out OUT`
   on coherent immutable snapshots. See [candidate merge](CANDIDATE_MERGE.md) for
   record conflicts, inherited ledger rows, host ancestry checks and draft summary
   regeneration. Both branch histories are checked against BASE. Regenerate all
   flagged summaries and revalidate OUT with `--previous` set to the graph at
   FRESH_HEAD (ours). The helper neither copies leases nor publishes; the host
   stages the correct released lease and rechecks ownership, ledger and sources. Atomically
   commit all staged changes against the verified head, then verify saved state.

On error, discard the candidate and release only your own lease with status
error and no transcript content. Leave inputs pending for a clean retry.

### Verification record and journal pointer (VI-019)

The journal is part of the candidate, so write it before candidate validation.
Record checks already performed and their observed outcomes. Mark adapter
validation, publication and persisted-state checks as pending until they run.
Identify where the host will retain their results, keyed by instance and run ID.
The verdicts need not be copied back into the journal: an unchanged journal with
a pointer that resolves to the durable completion record conforms.

The completion record identifies:

- the instance and run ID (plus attempt/submission identity when needed to
  distinguish retries);
- the checks actually run and their observed outcomes; unavailable results stay
  explicitly unknown or pending;
- the published commit or equivalent immutable snapshot identity;
- the committed warnings and warning summary when returned by the adapter;
  unavailable fields stay explicitly unknown.

Candidate validation, successful publication and verification of saved state are
distinct checks. Never claim an unrun check passed or infer semantic truth from
structural validation. Retain the actual adapter results at the selected location.

Any conforming host may use one of these locations:

1. **The analysis commit message.** A journal pointer can say: "Completion record:
   message of the analysis commit containing this journal; instance INSTANCE;
   run RUN_ID." The retained containing commit identifies itself implicitly;
   its message need not contain its own commit SHA. A tree hash may appear in
   the message because the message is outside that tree. The message must retain
   the actual check results and warning details, not just a title such as
   `complete RUN_ID`. Checks performed only after publication must remain pending
   until observed; retain their outcomes in a linked durable follow-up record if
   the original message cannot contain them.
2. **A durable external report.** State its exact path or resolvable identifier
   and the instance/run lookup key. Keep it outside the candidate it reports on,
   and preserve it with the instance's retention and backup policy.
3. **Git notes**, only when the host preserves the specified notes ref through
   retention, fetch and backup. Include the notes ref and lookup key in the pointer.

An unretained CLI/MCP response, chat transcript or rotating operation log is not
a durable completion record. Selecting a pointer does not create its target;
the host must persist the observed results there and report an unresolved record
as pending. This is a portable documentation/procedure rule, not a new schema,
validator requirement or automatic reporting feature.

Do not embed a journal's own final tree hash in that journal: inserting the hash
changes the tree being identified. A real earlier check may name its earlier
snapshot, but it is not verification of the changed final candidate. Any edit
after validation requires validation of the changed candidate. Do not edit a
committed journal merely to add its final verdict or snapshot hash.

| Example | Classification |
|---|---|
| A: Before validation, the journal records completed local checks, marks host checks pending and points to the analysis commit message or an exact external report by instance/run. The host retains actual results and snapshot identity there, with any later checks in a linked retained follow-up. The journal stays unchanged. | Conforming when the pointer resolves to those records. |
| B: The journal says validation passed before it ran, or embeds its own final tree hash and is edited after validation without revalidation. | Nonconforming: premature verdict or a different candidate. A commit title alone also leaves the completion record unresolved. |

## Moving observations to another instance

An inbox/evidence-only transfer preserves the original observations and their
indexed evidence. A fresh instance has its own graph, ledger, and question queues,
so the transferred observations are pending. The CLI provides no selective
processed-memory import or export.

To rebuild a feature's analysis in a fresh instance, initialize the destination,
then copy the finalized inbox notes with their IDs, filenames, and bytes intact.
Copy matching evidence or regenerate it with the indexer. If a note links to a
question, restore the corresponding valid question record and its required
observation dependencies before validation. When that context is unavailable,
resolve the dependency before processing. Run the normal analysis cycle to produce
the destination's graph, ledger entries, and derived question state. Selective
re-analysis can produce different outputs from the original cycle.

A whole-instance recovery is a separate operation. Use a consistent backup that
includes the graph, ledger, observations and both question queues, and validate
the restored snapshot before resuming processing.

## Integration boundary

An application supplies input capture/finalization, authentication, storage,
transactions, model access and optional scheduling. It may use local private files
or a private repository. Do not trust client-provided identity headers. Keep each
instance isolated. This package ships no browser or HTTP API. The optional local
Git reference adapter and backend template are documented in docs/ADAPTERS.md; other
storage backends remain host responsibilities. The reference validates an isolated
completion candidate but agent drafts in its working tree remain visible to local
readers. Use committed snapshots for consistent reads, or provide an isolated agent
workspace through a suitable host backend.


## 0.7.0 target contract

Initialize a fresh canonical instance when old formats do not fit. Graph schema 2
and strict hypotheses schema 1 are part of every candidate. Claims have canonical
attribution/classification names, optional immutable depends_on and scoped external
IDs on entities. Review capacity_near_limit, multiple_active_values,
duplicate_external_id and dependency_changed; a warning never decides truth.
Selected policy/configuration changes committed during a lease require release and
reclaim. Refer to ANALYSIS_WORKFLOW.md for entity-first retrieval and review steps.
