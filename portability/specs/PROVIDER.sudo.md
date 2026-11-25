# Logical memory providers and transfer

Normative companions: MEMORY_PROVIDERS.md, MEMORY_PROVIDER_ACCEPTANCE.md,
MEMORY_MODEL.md and schemas/formats.schema.json. Storage selection, user
authorization and transaction serialization are host duties; provider-neutral
operations must not interpret application configuration paths as permission.

Contract versions: provider 1, logical 2, host_api 2; capabilities
record-reads-v1,paged-evidence-v1,semantic-changes-v1,candidate-isolation-v1,
portable-export-v1. Collections in fixed order: observations,sources,entities,
claims,processed,questions,hypotheses,events,journals,verification,receipts,artifacts.

## physical primitives

Inputs always carry immutable snapshot token (open may omit to select current).
open returns instance_id,snapshot_id,logical_version,updated_at,policy_kinds,
policy_id,policy guidance. counts returns exact counts. read(collection,id) returns
{status:found,record} or {status:unknown}; evidence may additionally be unavailable.
Never conflate unavailable with unknown. scan(selector,purpose,limit=100,cursor=null)
returns {items,next_cursor}; limit integer 1..100, sorted IDs, continuation bound
to snapshot/collection/selector/purpose, refuse expired/mismatched/repeated tokens.
Selector conjunction: ids membership; refs any of subject/attribution/object,
source_ids,source observation refs,supersedes,depends_on; group exact subject+
predicate; external canonical exact triple; tokens any exact normalized token in
ID/label/aliases/external values/kind/predicate/object scalar/quotes. No top-k,
recency filtering or authorization by selectors. evidence(id,offset=0,max_bytes=
65536) returns base64 exact raw bytes and total_bytes; offset safe nonnegative,
max 1..65536, offset<=size, unknown/unavailable status if missing. Consumers page
until total, reject zero progress, oversize and inconsistent lengths.

JSON physical mapping: graph.sources/entities/claims, processed.observations,
queue.questions,hypotheses.hypotheses. Parse inbox descriptors with body omitted;
retain raw bytes separately. Auxiliary events/journals/verification/receipts live
in memory/provider-state.json with provider_version:1 and policy_kinds. All files
not represented by typed collections, lease or derived summaries become artifacts
{id:"artifact-"+canonicalDigest(path),origin_locator:path,base64}. Never lose
opaque artifact bytes. Policy kinds use current processing source kinds else saved
policy_kinds. encode uses pretty JSON+LF, graph/collections updated_at=current
logical time, derives index and queue summaries (fixtures capture exact bytes).

## host API

read returns record/null (unavailable errors); source forwards evidence ranges;
open/stats use primitives; stats follows MEMORY. audit performs full paged
validation (never trusts counts alone) with MEMORY invariants, plus event,
journal->verification, verification->journal and receipt digest provenance.
Previous snapshot audit preserves every record in every collection; only entity
mutable fields, active claim terminal status, monotonic question closure and
hypotheses changes are permitted. Questions additionally retain text/source/
created_at; all other collections are immutable.

context physically fetches matching entity/token/claim-ID/source references,
then full adjacency for requested 1..3 hops plus complete single-valued temporal
subject/predicate groups BEFORE harness ranking. Deduplicate and sort claims and
entities by ID; fetch all source references. Run MEMORY retrieval with snapshot
time and bound policy, cap warnings 100 and include scope (snapshot vs retrieval
dependency closure), snapshot_id,policy_id,knowledge warning. Only authorized
provider handle defines instance; options never switch it.
warnings(limit default100,1..1000) reads complete source bytes, hypotheses and
policy; returns warnings,total,truncated.

## semantic change prepare / publish / abort / recover / rebase

Change keys only provider_version:1,base_snapshot,policy_id,lease_id,run_id,
attempt_id,idempotency_key,sources,operations,at. Identity strings nonblank <=1000;
sources unique <=20 {id,sha256}; operations <=20000; change digest is canonical
JSON SHA-256. Input operation shapes in schemas/formats; no arbitrary file writes.

```sudolang
Prepare(change) {
  Bind base policy; expand explicit operations into isolated logical writes
  Each write = {collection,id,before_digest:canonicalOldOrNull,record}
  Append claimed source descriptors and processed rows automatically
  Require retained run journal with policy_id and verification_id=attempt_id
  Require verification record for that attempt with run_id and nonblank result
  Provider independently reconstructs writes and checks change digest
  Reject idempotency-key conflict; exact retained receipt requires recover
  Stage private candidate only; validate full history and EXACT requested writes
  Seal candidate digest; abort candidate on validation failure
}
Publish(candidate) {
  Under host transaction re-read authoritative current snapshot and receipt
  If same key already published and digest matches: return receipt
  Require base,policy,owned unexpired lease,run=lease_id,source reservation matches
  Recheck physical bytes/guidance using host binding check; reconstruct intent
  Revalidate candidate and digest; publish completion + receipt + idle lease atomically
}
```

Ops add_entity/add_claim add only; extend_entity appends unique canonical values
to aliases/source_ids/external_ids; set_claim_status active->terminal only;
put_question retains text/source and closed status; put_hypothesis replaces row;
append_event requires reserved observation; append_journal/append_verification
append only. Unknown ops refuse. Automatic processed rows include source_file,
source_sha256,status:processed,processed_at:change.at,run:run_id,
verification_id:attempt_id. Retained journal ID=run_id and verification ID=attempt_id
are required even for empty semantic work. Candidate validation rejects unrelated
additions/modifications/removals, metadata/policy drift, missing writes.

Candidate tokens and draft snapshots expire with provider process; abort removes
them and is idempotent. recover reads durable receipt by idempotency_key, null
if absent; never retry with a new key after response loss. Receipt binds id,
provider_version,run_id,attempt_id,base_snapshot,policy_id,change_digest,
candidate_digest,published_at,verification_id; immediate publish adds snapshot_id,
durable JSON receipt cannot contain its own unknown commit hash. Rebase computes
writes against original base, requires same policy and every touched new-base
record's digest == before_digest; only changes base_snapshot, never silently merges
conflicting semantics or duplicate completion.

Snapshot digest: canonical digest of parts. First part canonical digest of
{logical_version,updated_at,policy_id,policy}; then each fixed collection name and
sorted [recordID,canonicalDigest(record)] pairs; then evidence entries
["evidence",observationID,SHA256(raw)] in provider scan order. Final digest seals
all logical state including opaque artifacts. Receipt added after sealing is an
intentional post-candidate publication record.

## export / import

Export explicit nonempty unique snapshot IDs; compact JSONL chain initialized
canonicalDigest({format:"golem-logical-memory",version:1}). For every value except
end: checksum=canonicalDigest([previousChecksum,value]); emit value+checksum.
Emit manifest (format/version/logical_version/normalization/snapshots), then for
each snapshot: snapshot with origin_snapshot/meta/logical_digest, records in fixed
collection and ID order, evidence pages <=65536 with offset/total_bytes/base64,
end_snapshot. Final end carries prior checksum, no further chaining.
Import validates every checksum, manifest, snapshot scope/order/uniqueness,
evidence offsets/totals and full termination; requires host receiver begin,
snapshot,record,evidence,seal,publish,abort. Duplicate records/artifact paths refuse.
Stage only; seal each snapshot, full audit and logical digest equality before
publish. Any error including truncated tail/data after end aborts all staging.
Host atomic sink publishes only after entire stream verified; no live provider
cutover is implied. Returned snapshot IDs are aliases, not physical hash equality.
