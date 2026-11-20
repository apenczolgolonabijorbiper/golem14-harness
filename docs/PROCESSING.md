# Host-independent processing protocol

The host must provide an LLM agent, authorized read/write tools and atomic storage.
The bundled code indexes, validates, retrieves and counts; it does not infer claims.
An external schedule may invoke the agent but is not included or enabled.

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

## Lease and concurrency

No pending work: exit without writing. Otherwise create a fresh run UUID and claim
memory/processing-lock.json using compare-and-swap against the current snapshot.
Use schema_version 1, run_id, status processing, claimed_at, expires_at (15 minutes)
and observation_ids. An unexpired lease belongs to its owner. Process at most 20
oldest sources per cycle. Renew before expiry using compare-and-swap; stop on lost
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
   claimed guidance_identity and retained run snapshot). The released lease has `schema_version: 1`, `status: idle`,
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
   source bytes. If the snapshot changed, preserve concurrent intake, merge and
   revalidate the complete candidate against the fresh prior graph. Atomically
   commit all staged changes against the verified head, then verify saved state.

On error, discard the candidate and release only your own lease with status
error and no transcript content. Leave inputs pending for a clean retry.

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
