# Selective transfer of processed observations (VI-007 / #18)

Harness can transfer selected processed observations into an existing instance
without calling inference or reconstructing their analysis. Observation IDs,
exact raw bytes/hashes, applicable knowledge and completion rows are retained.
The destination owns the resulting snapshot and keeps its existing history.
The original instance is never written. This differs from observation-only
restore/re-analysis and from whole-snapshot archive import.

## Bundle and dependency closure

The public module `server/processed-transfer.mjs` exports:

| Function | Contract |
|---|---|
| `exportProcessed(provider, snapshot, observationIds)` | Audit an immutable source snapshot; return a version-1 `golem-processed-observations` JSON bundle |
| `inspectProcessed(bundle)` | Check checksum, canonical IDs/bytes, complete closure and semantic validity; return an isolated logical state |
| `combineProcessed(provider, baseSnapshot, bundle, {id, at})` | Build and audit a combined isolated candidate against destination history; no publication |
| `transferView(states)` | Private-state validation view for host materialization checks; no writes |
| `transferReceiptPath(id)`, `transferArtifactId(id)` | Stable identity for the retained destination receipt/archive |

The explicit, nonempty, unique selection is sorted. Starting from those sources,
repeat until stable: include graph-source and processed rows; assertions citing
included observations; entities supported by those observations and all entities
referenced by included claims; every entity's source observations; claim premises,
correction predecessors and successors; linked questions and their original and
analyzed observations; associated answer events; and hypotheses touching included
claims/observations, with all their evidence. Every included observation must be
processed. Missing or pending dependencies refuse; they are never quietly dropped.
This can expand the selection. Inspect `selected` versus `rows.observations`
before authorizing publication; there is no application-specific selection rule.

Historic journals and opaque files do not declare machine-readable dependency
lists. Version 1 conservatively retains **all journals, verification records,
publication receipts and opaque artifacts from the pinned source snapshot**.
This may include material beyond the selected observations. It does not promise
redaction or minimal disclosure. The manifest contains the original snapshot,
instance, policy and metadata. Every collection is ordered by ID; exact source
bytes use canonical base64. `sha256` is the canonical JSON digest of all fields
except itself. This detects corruption, not publisher authenticity; hosts own
transport trust and authorization. No source lease or reservations are imported.

## Destination transaction

`createJsonProvider` exposes `importProcessed({bundle, base_snapshot, id, at})`
and `recoverTransfer({id})`. Host stores supporting import must supply an atomic
`transaction` with `checkTransfer(binding)`, `load` and `publish` callbacks.
`checkTransfer` must independently enforce freshness, ownership, lease exclusion
and physical source/policy consistency under the same publication lock. A host
without that binding refuses. Other providers can use the shared bundle checker,
combiner and validator with their own storage; no JSON/Git layout is required.

The JSON/Git reference implements import under its exclusive adapter mutex and
expected-head Git CAS. Pause cognition and release any processing lease first;
even an expired processing lease requires explicit release/reconciliation. The
import does not claim observations or impersonate their original processor.

Require exact equality of source and destination policy representations. Version 1
refuses different guidance rather than reinterpreting old conclusions, installing
profiles or weakening destination vocabulary. UTC `at` must be no earlier than
either snapshot's update time. Source/graph/processed IDs already present in the
destination refuse, even identical bytes. Entity/claim collisions (including
cross-collection collisions), and all other typed-record collisions, also refuse.
No identity merge, rename, source deduplication or history removal occurs.

The host combines records and exact observations in isolation, audits the entire
candidate against destination history, materializes it, reopens and validates
that exact result, and checks that no logical records changed during encoding.
It regenerates derivative summaries. Immediately before atomic publication it
rechecks destination head, lease, working bytes and index. Dirty destinations,
untracked target collisions and concurrent publication refuse without overwriting
local work. New nonconflicting intake remains available. No live destination or
source file is written before the CAS succeeds. Temporary Git objects may remain
unreachable after rejection; no partial committed memory/receipt is exposed.

## Provenance, receipts and recovery

The destination adds `memory/transfers/SHA256(canonicalJSON(id))/transfer.json`.
This receipt embeds the complete checksummed bundle and records selected/included
source IDs, original snapshot, destination base, transfer ID and time. Original
artifact locators resolve within that retained bundle's `rows.artifacts`, where
bytes remain base64; they are never installed over destination paths. Graph and
queue output locators refer to the retained typed rows, with summaries derivative.
Imported ledger/journal rows retain their original bytes/fields. This locator rule
also applies recursively when transferring imported knowledge again (maximum 32
archival layers). Old snapshot identifiers remain origin metadata; no physical
Git hash equivalence or old destination ancestry is fabricated.

Before the commit point, interruption leaves no completion/receipt. Retry with
the same base, or inspect a moved head and rebuild against it. After the commit
point, a lost response is resolved by `recoverTransfer({id})`; the receipt and
knowledge were committed together. The adapter's existing pending marker restores
working files/index on its next locked operation. Hard process death can leave a
mutex directory requiring operator inspection, as for other adapter operations.

A repeated import with the same transfer ID and bundle returns the original
receipt without another commit; another bundle with that ID refuses. A new ID
for already imported observations refuses with the duplicate source ID. Immediate
success additionally returns the destination `snapshot_id`; durable recovery does
not substitute the later current head for the original commit identity.

## Standalone JSON/Git launcher

Initialize/commit a destination only if it is new. Never reinitialize existing
knowledge. Put request/bundle files outside both instance repositories so they do
not become observations or committed knowledge accidentally.

```sh
node processor/provider-tool.mjs export-processed --instance /private/A --instance-id A --snapshot SOURCE_COMMIT --request selection.json > bundle.json
node processor/provider-tool.mjs inspect-processed --instance /private/B --instance-id B --request bundle.json
node processor/provider-tool.mjs import-processed --instance /private/B --instance-id B --request transfer-request.json
node processor/provider-tool.mjs recover-transfer --instance /private/B --instance-id B --key transfer-001
node processor/provider-tool.mjs audit --instance /private/B --instance-id B
```

`selection.json` contains `{"observation_ids":["SOURCE_UUID_1","SOURCE_UUID_2"]}`.
`transfer-request.json` contains `bundle` (the full object), explicit
`base_snapshot` (B's reviewed current commit), stable `id` and UTC `at`.
Authorization is supplied by the host, not by an ID or a request-file path.

## Acceptance

Run `node --test server/processed-transfer.test.mjs` and the release builder.
Synthetic tests transfer two of three processed observations into nonempty B,
validate both logical and JSON views, retain B's prior history, refuse duplicates
with source IDs, preserve exact source/artifact bytes, follow correction/question/
hypothesis closure, refuse missing dependencies and collisions, protect leases,
local/staged changes, and exercise source/policy drift, concurrent head movement,
invalid combined candidates, pre-CAS interruption, lost responses and re-export.
Source A is checked unchanged around success and publication-fault cases.
Portable conformance also exercises the retained deterministic transfer scenario.
Retained local results: [16 acceptance cases](validation/processed-transfer-linux-2026-11-25.log).
No actual-model evaluation, downstream integration or migration is needed. The
reference JSON/Git 64 MiB child-output envelope is unchanged; retained archives
count toward it. Conservative/nested provenance can increase storage size.
