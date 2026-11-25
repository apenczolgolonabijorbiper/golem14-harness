# Candidate writing and completed snapshot merge

Normative companions: PERFORMANCE.md (writer ABI), CANDIDATE_MERGE.md,
PROCESSING.md (verification pointer) and schemas/formats.schema.json.

## write-candidate

Input --root, --changes JSON (<=8 MiB), --apply true|false (default false).
Change set schema 1: run UUID, exact graph/index base hashes, review (nonblank
<=64000), model (nonblank one line <=200, unknown if unavailable), optional at,
entities[], entity_additions[], claims[], claim_statuses[], questions[],
hypotheses collection, events[], base_files_sha256. Reject unexpected fields.
Arrays max 20000 (events max 20). at defaults clock UTC.

```sudolang
WriteCandidate(change) {
  Require owned healthy unexpired lease; no recovery/malformed observations
  Bind exact base graph/index, current and retained guidance, claimed source bytes
  Load unmodified snapshot; refuse any claimed source already graphed/processed
  Add claimed sources to graph and simulated ledger for preflight ONLY
  Append entities/claims; extend existing entities by unique source/alias/external IDs
  Apply each retained active claim terminal-status change at most once
  Assemble explicit question/hypothesis/chat-event semantic artifacts
  Validate graph against previous; validate hypotheses and readable questions
  Assemble graph/index/journal and artifact drafts; preflight every destination
  If preview: report only; write nothing
  If apply: recheck HEAD/lease/guidance/source/base bytes immediately before writes
  Write each draft atomically; on error restore only bytes still equal to ours
  Return draft paths and counts; require adapter validation and commit separately
}
```

Entity additions reference existing IDs (including just-added entities), one per
ID; deduplicate each appended field by compact JSON, preserve first insertion
position and last equal value. Claim status edits only active->superseded|retracted
on preexisting claims, one per ID. Graph.updated_at = at. Writer never edits real
ledger/lease. Question updates merge on ID, preserve collection.updated_at;
validate allowed fields id/status/text/source_observation_id/created_at/answer/
analysis; analysis source IDs must be resulting graph sources. If changes nonempty,
write JSON queue plus readable renderer: `# Questions\n\n`, each `## ID (STATUS)`
then fenced text block, choosing max(3, longest backtick run +1) fence length;
join entries with LF, retain literal multiline text. Hypotheses is a complete
replacement collection, validated. Chat event exact keys observation_id,
question_id,answer,answered_at; answer <=64000, nonblank; must match a claimed
observation and known question (and source.question_id if present). Unique target
memory/events/chat/OBSERVATION.json, never replace prior event or run journal.

Every optional artifact path to be written requires base_files_sha256[path]
equal exact existing hash or null for absent. Unknown hash keys refuse. Before
writing, refuse unsafe parent/file types and preexisting journal/event. On a new
file use exclusive publication (no overwrite); on replacement compare old hash
then atomic rename. Best-effort rollback preserves any concurrent third-party edit.
This is draft assembly, not a multi-file transactional publication promise.

Journal/index exact templates are retained in fixtures/expected text artifacts.
Journal must contain `guidance_version: IDENTITY` on its own line, explicit source
IDs/hashes, semantic review and truthful pending verification. Index removes old
`- Graph: ...` lines, appends counts, cycle review and journal pointer. The host
chooses a durable verification location BEFORE validation; a title alone does not
prove completion. Never edit a validated journal without revalidation.
Result: at,mode preview|draft-written,run_id,files (graph,index,journal then artifact
insertion order),entities_added,claims_added,requires:`adapter candidate validation and commit`.

## merge

Inputs --base/--ours/--theirs completed coherent directory snapshots and absent
--out. No lease copying (memory/processing-lock.json excluded), no publication or
Git ancestry claims. Capture raw files except top-level .git; cap 50000 entries,
50000 files, 64 MiB, 128 components. COMMON path/isolation rules apply.
Validate all three snapshots and readable queues before merge.

```sudolang
MergeSnapshots(B, O, T) {
  Reject changed guidance/config/purpose/selected files in either branch
  For keyed collections: union record IDs in B,O,T encounter order
  Reject removed base records; reject competing changes to the same record
  For processed ledger: retain base rows exactly; reject same new source in both
  updated_at = latest O/T timestamp; other metadata uses three-way equality
  Preserve immutable inbox/evidence/runs/events base bytes
  Reject new colliding run paths even if bytes equal
  Three-way merge other files; differing summaries choose ours, mark regeneration
  Validate branch history vs base and merged history vs ours
  Re-read inputs; refuse concurrent mutation; preflight portable path collisions
  If conflicts: create no output
  Else exclusively create output and write raw/merged files; never edit inputs
  On write failure: remove only the output directory created by this call
}
```

Keyed collections: graph sources/entities/claims; ledger observations; queue
questions; hypotheses hypotheses. Existing immutable file deletion refuses.
If both branch graphs changed, always regenerate memory/index.md; if readable
queue misses ID/text, regenerate questions/queue.md. Report possible_duplicate_entity
for distinct new O/T IDs with same [type,NFKC-trimmed-collapsed-lowercase label].
Warnings/conflicts cap 1000 with total/returned/truncated summaries. Return
merged counts, conflicts, needs_regeneration sorted, warnings,
base_checked_by:`host`; successful assembly also requires_review, validation
(history_against ours, readable_queue_consistent, publication_checked false).
Kinds: invalid_snapshot,guidance_changed,record_removed,ledger_history_changed,
source_processed_twice,record_changed_both,file_removed,immutable_file_changed,
run_collision,file_changed_both,invalid_branch_history,invalid_merged_history,
merge_refused. Any conflict exits 1; summaries needing regeneration are not errors
but require host review before later independent publication.
