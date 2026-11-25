# Selective processed-observation transfer — optional contract 1.1.0 operations

Normative companions: docs/PROCESSED_TRANSFER.md, MEMORY_PROVIDERS.md,
MEMORY_MODEL.md, schemas/processed-transfer.schema.json and COMMON.sudo.md.
No inference, application selection policy, automatic profile installation or
identity resolution is part of these operations. JSON/Git is one host binding.

```sudolang
ExportProcessed(provider, pinnedSnapshot, observationIDs) {
  Require explicit nonempty unique string IDs (maximum 10000); sort selection
  Read committed metadata, every logical collection and exact observation bytes
  Audit entire pinned snapshot using PROVIDER validation; refuse invalid source
  ExpandClosure(selection) until fixed point
  Retain all provenance/opaque records conservatively (see below)
  Build sorted logical rows, evidence map of ID -> canonical base64(raw bytes)
  value = {format:"golem-processed-observations",version:1,logical_version:2,
           origin:originalMetadata,selected:sortedSelection,rows,evidence}
  bundle = value + {sha256:CanonicalDigest(value)}
  InspectProcessed(bundle); return bundle; never write source provider
}
```

Closure uses sets keyed by collection and ID; a missing key refuses naming the
collection/ID. Every included observation requires its source and processed row.
A source question_id pulls its question. Pull entities with any included source;
pull claims citing any included source, or superseding any included claim. Every
included entity pulls ALL source_ids. Every included claim pulls subject,
attribution and entity-valued object, all cited observations, supersedes and
optional depends_on. Pull questions whose original or analysis observations
intersect included observations; each question pulls all those observations.
Pull events touching included observations/questions, and both event references.
Pull hypotheses touching included claims/observations, then ALL their support,
refutation and observation IDs. Iterate until no insertion. Pending dependencies
refuse rather than triggering cognition. Selected IDs are separate from expanded
included IDs; caller reviews expansion before authorizing destination writes.

Include ALL journals, verification, receipts and artifacts from the source
snapshot because legacy/opaque records do not declare their dependency lists.
This is conservative provenance closure, not a minimal-disclosure/redaction API.
Exclude leases/reservations and derived summaries as portable knowledge; keep
policy only as original pinned metadata/artifacts, never active destination
configuration. Provider credentials/transactions are host-owned, never provider
records. Do not interpret original artifact locators as destination write paths.

Inspect: reject unknown top-level fields/versions, checksum drift, unsorted or
duplicate records, noncanonical base64, source-byte hash drift, duplicate artifact
locators (NFC, case-insensitive), missing evidence and incomplete closure. Apply
full provider audit, including source parsing, quote exactness, graph dependencies,
correction topology, questions/hypotheses and journal-verification pointer pairs.
Every ledger run resolves to a typed journal ID or retained artifact locator;
noncanonical output locators must resolve to artifacts. Canonical typed graph,
ledger, hypothesis, queue, provider-state and summary outputs use retained rows
or derivative rendering. Preserve ledger rows unchanged. Recursively resolve
archived artifact pointers inside retained transfer receipts; verify their bundle
digest, cap nesting at 32. Return isolated state only; no published handles.

```sudolang
CombineProcessed(destination, base, bundle, {id,at}) {
  Require explicit stable nonblank ID <=1000 chars and finite UTC time
  InspectProcessed(bundle); read all destination base records and bytes
  Require source/destination policy representations canonically identical
  Require at >= base.updated_at and source.updated_at
  Reject ANY existing observation/source/processed ID, even identical rows,
    naming duplicate source ID; reject all other typed-record collisions,
    including cross entity/claim IDs; do not merge, rename or delete
  Copy base; append imported typed rows except source artifacts; append exact sources
  Keep destination metadata/policy/instance ownership; update logical time to at
  Private snapshot token = "transfer:" + CanonicalDigest([base,id,bundle.sha256])
  Add destination artifact at memory/transfers/CanonicalDigest(id)/transfer.json
    with ID "artifact-" + CanonicalDigest(path), pretty JSON(2 spaces)+LF bytes
  Receipt embeds entire checksummed bundle; fields format="golem-processed-transfer-receipt",
    version=1,id,base_snapshot,bundle_sha256,at,origin=sourceSnapshot,
    selected,included=sortedExpandedObservationIDs,bundle
  Sort all rows; audit WHOLE candidate against destination previous history
  Return isolated state + receipt; no publication
}
ImportProcessed(request) {
  Inspect bundle before even considering an idempotent retry
  Under exclusive host transaction: read authoritative physical destination
  Existing same ID + same bundle digest -> original receipt; conflicting digest -> refuse
  Require expected base and no processing lease (expired leases also require release)
  Host independently checks ownership/source/policy/freshness bindings
  CombineProcessed; materialize exact observations, typed state and receipt archive
  Preserve destination opaque files; never install source artifacts over live paths
  Regenerate derivative summaries; decode exact candidate and audit history again
  Require exact logical row equality after encoding; recheck physical fences
  Atomic commit/CAS knowledge + receipt; return summary + actual snapshot_id
}
RecoverTransfer(id) = original durable receipt summary or null
```

JSON/Git binding: use adapter mutex (no borrowed cognition lease), attached branch
and expected-head update-ref. Before CAS require every committed working byte and
protocol file matches HEAD, no conflicting staged entries, no untracked overwrite,
and unchanged head/lease/source/policy. No async callback between final fences and
CAS. Rejection writes no live files/commit/receipt; unreachable Git objects are
permitted. Preserve concurrent unrelated intake. Pre-CAS interruption has no
receipt. Post-CAS response loss recovers committed receipt without another commit;
existing adapter pending-marker reconciliation restores local files/index on next
locked operation. Hard process death can leave a mutex requiring operator review.
Do not manufacture physical identity equality for original snapshot locators.

CLI provider-tool additions (existing operations unchanged): export-processed uses
--snapshot and --request {observation_ids}; inspect-processed reads bundle request
and returns sha256,selected,included,counts; import-processed reads
{bundle,base_snapshot,id,at}; recover-transfer uses --key ID. Instance path and
instance-id are explicit host binding options, not authorization in logical APIs.
