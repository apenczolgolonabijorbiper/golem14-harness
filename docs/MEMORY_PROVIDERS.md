# Storage-independent memory providers

Harness defines logical memory and its epistemic rules. A conforming host chooses
one canonical provider, authorizes access and coordinates publication. Any host
can implement this contract without a particular host product, package, service,
command, layout or downstream release. Inference remains external.

Phase A retains the existing JSON/Git implementation and adds a supported public
record API. There is no new database dependency, automatic migration or promise
that larger JSON graphs are now supported.

## Public boundary and versions

Hosts may import these **packaged, public ES modules** from an unchanged installed
Harness. Node 22.12+ is required. Imports from other implementation modules are
private unless separately documented. No package-manager installation is needed.

| Module | Supported exports |
|---|---|
| `server/memory-contract.mjs` | `memoryContract`, `collections`, `canonical`, `digest`, `bytesDigest`, `matches`, `tokens`, `assertProvider`, `pages`, `records`, `get`, `evidenceBytes`, `changeIdentity` |
| `server/provider-memory.mjs` | `createMemory`, `semanticWrites`, `rebaseChanges` |
| `server/provider-validation.mjs` | `validateSnapshot`, `validateCandidate`, `snapshotDigest` |
| `server/processed-transfer.mjs` | `exportProcessed`, `inspectProcessed`, `combineProcessed`, `transferView`, `transferReceiptPath`, `transferArtifactId` |
| `server/memory-transfer.mjs` | `exportMemory`, `importMemory` |
| `server/cognitive-reference.mjs` | `createProviderReadView` |
| `adapters/reference-git/adapter.mjs` | `createAdapter`, including `openMemory({instance_id})` |
| `adapters/reference-json/provider.mjs` | `createJsonProvider`, `createJsonTransferReceiver` for an explicit transactional host store/sink |
| `adapters/template/memory-provider.mjs` | Application-owned provider scaffolding |
| `adapters/conformance/provider-suite.mjs` | `providerConformance(name, factory)` |

| Version dimension | Current | Refusal rule |
|---|---|---|
| Logical memory | 2; hypotheses 1 | Reject unsupported records/formats before writes; never reset/reanalyze |
| Provider / semantic changes / portable stream | 1 | `assertProvider` / `changeIdentity` / import refuse unsupported combinations |
| Host module integration API | 2 | Public modules and transactional callback obligations below |
| Physical JSON format | graph 2 + optional provider sidecar 1 | Only the reference adapter interprets it |
| Existing reference adapter CLI | 1 with `memory-provider-v1` capability | A new standalone cycle must request the capability when claiming |
| Cognition task/result | 1 | Unchanged; consumes `createProviderReadView` |

Required provider capabilities: `record-reads-v1`, `paged-evidence-v1`,
`semantic-changes-v1`, `candidate-isolation-v1`, `portable-export-v1`.
Version numbers do not imply one another. A provider must advertise only behavior
it actually supplies. Absence or incompatibility refuses explicitly.

## Ownership and complete state inventory

| State / responsibility | Authority | Treatment |
|---|---|---|
| Entities, claims, graph source descriptors | Harness semantics; provider storage | Canonical transactional `entities`, `claims`, `sources` records; stable IDs, exact sources, retained corrections |
| Original observations / indexed evidence | Host intake; Harness provenance | Canonical `observations` descriptors and paged exact source bytes; derived evidence indexes are retained artifacts |
| Processed ledger | Harness completion meaning; host transaction | Canonical `processed` records, atomically coupled to the candidate and receipt |
| Questions / answers / analysis | Harness | Canonical `questions`, with stable wording, source identity and analyzed closure |
| Hypotheses / uncertainty / premises | Harness | Canonical `hypotheses`; evidence must resolve in the same snapshot |
| Events, cycle journals, verification pointers | Harness meaning; host durability | Canonical `events`, `journals`, `verification`; append-only records, resolvable pointer pairs |
| Publication receipts | Host durability, Harness identity fields | Canonical `receipts`, atomically published with completion; never inserted after a separate successful commit |
| Older journals, events, learning receipts and auxiliary files | Existing semantic format retained | Immutable `artifacts` with stable IDs, original locator and exact bytes; existing historical pointers remain resolvable |
| Purpose, selected profile, vocabulary / retained guidance | Application supplies content; Harness defines precedence | Snapshot-pinned `policy` and identity; original configuration/text and retained run guidance are exported as artifacts |
| Read models / Markdown summaries | Host/backend | Derivative reference presentation, regenerated at completion/import; never substituted for canonical records |
| Lease/reservations, authorization, credentials, endpoint/configuration | Host | Not portable knowledge; recheck under the publication lock; no leases are imported |
| Snapshot ancestry, retention, CAS, transaction/WAL, locks and reconciliation | Host/provider | Opaque snapshot identity; history and source bytes remain snapshot-bound |
| Merge | Harness semantic intent; host freshness | `rebaseChanges` checks touched-record digests and policy; host owns ancestry and the next lease |
| Admin, backup, provider selection/switching, cutover and deployment | Host | Explicit host procedures outside this contract; no Harness migration workflow |
| Export/import | Harness invariants; host staging/durability | Paged canonical records + exact source chunks; validate in isolation before atomic archive publication |
| User request/answer schemas, learning authorization | Existing cognition contract | No duplicate task lifecycle; see `COGNITIVE_TASKS.md` |

A canonical provider serves one authorized instance scope. Scope is fixed when
constructed; `instance_id`, snapshot selectors and query filters cannot grant
access. Agent input cannot select a module, connection string or authorization
policy. Providers may share an implementation, but must isolate scopes.

## Provider operations

All methods except `describe()` may be asynchronous. Return copies, never mutable
references to committed state. Collections are listed by `collections` in the
contract module. Operations never accept a graph object, graph filename, SQL or
Git argument. Observation `path` is retained **logical provenance** from the
existing observation format, not an instruction to read a backend file.

| Operation | Request / response | Required semantics |
|---|---|---|
| `describe()` | Versions and capabilities | Explicit negotiation; physical format is informational |
| `open({snapshot?})` | Metadata: `instance_id`, `snapshot_id`, `logical_version`, `updated_at`, `policy_id`, `policy` | Omitted snapshot selects current committed state; returned handle immutable |
| `read({snapshot,collection,id})` | `{status:'found',record}` or `unknown` / `unavailable` | Exact ID only; unknown is absence in this snapshot, unavailable is a retention/access failure, never negative evidence |
| `scan({snapshot,collection,selector,purpose,limit,cursor})` | `{items,next_cursor}` | At most 100 rows per page; stable ID ordering; exhaust every matching physical candidate; never silently apply top-k |
| `counts({snapshot})` | Counts by collection | Counts, not record bodies; no lease required |
| `evidence({snapshot,id,offset,max_bytes})` | `status`, `base64`, `total_bytes` | Raw source byte ranges, 1..65,536 bytes; offsets are bytes; missing retained bytes are unavailable |
| `prepare({change,writes,change_digest})` | `{candidate_id,snapshot_id}` | Verify `semanticWrites`; immutable isolated overlay; no committed state or completion change |
| `publish({candidate_id,change_digest,candidate_digest})` | Durable receipt, optional new `snapshot_id` | Independently validate the exact candidate and all host fences under one transaction |
| `abort({candidate_id})` | Aborted status | Discard draft/handles; leave committed state untouched; safe repeated abort |
| `recover({idempotency_key})` | Original durable receipt or null | Receipt is authoritative even after response loss or process restart |

`selector` supports AND-combined `ids`, `refs` (OR references), `group`
(`subject_id`, `predicate`), `external` (exact scheme, namespace, value), and
normalized `tokens` (OR). The shared `matches` function defines physical matching.
It does not choose winners, merge identities or interpret facts. `purpose` is an
operation label (`lookup`, `query`, `validation`, `audit`, `export`), never an
authorization grant. Ordinary exact lookups use filtered selectors. Audits,
statistics and broad queries may enumerate pages. A host can enforce quotas by
refusing explicitly; it cannot return a falsely complete partial match set.

Cursors are opaque and bind snapshot, collection, selector, operation purpose and
scope. Reuse with a different binding refuses. Draft snapshots cannot be used as
committed snapshots. Aborted drafts expire immediately. Committed snapshots stay
valid while retained by the host; pruning makes handles/cursors explicitly
unavailable/expired, never aliases them to current state. The JSON/Git reference
supports retained ancestors of the selected instance branch; it does not promise
retention after host Git garbage collection or history rewriting.

## Retrieval and validation

`createMemory(provider)` supplies `open`, `read`, `source`, `context`, `stats`,
`warnings`, `audit`, `prepare`, `publish`, `abort`, `recover`. Lookup/ranking,
scoped external identity, current/valid-time selection, dependencies and conflict
meaning remain Harness decisions. Physical candidate queries retrieve complete
correction/temporal groups **before** output bounds. Current ties and alternatives
remain explicit; aliases and identical names do not establish identity. Source
reads are separate and snapshot-bound. Context is bounded to existing output
limits; warnings state their scope and truncation. `warnings` performs a complete
paged warning audit; it is not restricted to the context top-k.

Validation uses point reads for references/evidence, paged record audits, and
complete dependency/correction topology checks. It does not validate only the
retrieved subset. Candidate validation in this first implementation performs a
full paged audit, including previous-record history, rather than claiming
incremental validation performance. The pure in-memory ranking/statistics helpers
remain internal working-set implementations, not a mandatory provider boundary.

The JSON backend still parses/scans/materializes full files. Paged APIs remove
the physical-format requirement; they do not eliminate JSON costs, change logical
capacity limits, increase the Git reference's 64 MiB child-output envelope, or
establish support for a 100 MB graph. Broad neighborhoods can still be expensive.

## Semantic changes and publication

A change has `provider_version:1`, opaque `base_snapshot`, `policy_id`, `lease_id`,
`run_id`, `attempt_id`, `idempotency_key`, UTC `at`, `sources:[{id,sha256}]`, and
`operations`. It contains semantic intent, never replacement graph files.

| Operation | Fields / rule |
|---|---|
| `add_entity`, `add_claim` | `record`; ID must be new; canonical logical record schema applies |
| `extend_entity` | `id`, optional `aliases`, `source_ids`, `external_ids`; additions only |
| `set_claim_status` | `id`, `status`; active to superseded/retracted; old content retained |
| `put_question` | `record`; wording/source identity retained; closure needs analyzed evidence |
| `put_hypothesis` | `record`; premises must exist, confidence/uncertainty semantics preserved |
| `append_event` | `record` with ID, reserved `observation_id`, `question_id`, `answer`, `answered_at` |
| `append_journal` | `record` with run ID, pinned `policy_id`, semantic `review`, `model`, `verification_id` |
| `append_verification` | `record` with attempt ID, `run_id`, `result`; retain observed configuration/limitations as needed |

Sources are completed by the host transaction, not a model-supplied processed
flag. Exactly one host candidate assembly component writes completion records:
`semanticWrites` derives CAS-bound record writes and one processed/source row per
claimed source, preserving prior records. The agent supplies semantic operations
and source identities; it must not also append completion rows. The provider's
isolated candidate must contain these records before validation. A logical
provider need not expose `processed.json` or filesystem staging. Audits reject
duplicate IDs (`processed: duplicate/invalid ID`) separately from source integrity
failures; records are never silently deduplicated.
Every cycle requires a journal and separate resolvable verification record, even
if the verification result is a qualified or limited result. A deterministic
fixture must never claim actual-model evaluation.

| State | Allowed transition / effect |
|---|---|
| Committed snapshot + owned lease | Prepare isolated candidate; no committed draft leakage |
| Prepared | Audit against base; compute canonical candidate digest; errors abort |
| Validated | Publish only after independently rechecking everything below |
| Published, response delivered or lost | Recover the original receipt by idempotency key; do not reprocess sources |
| Prepared / validated but interrupted before CAS | No receipt/completion exists; retry or rebuild an attempt |
| Aborted / expired | Candidate handle refuses; committed knowledge stays intact |

Publication must serialize against host writers and independently recheck:
base freshness, lease ownership/expiry and reservations, exact source identities
and bytes, pinned policy, semantic-write digest, full candidate validity/history and exact correspondence to `semanticWrites`,
and candidate digest. The exact validated candidate, source completion, lease
release and receipt must commit atomically. A caller's previous validation is
insufficient. A provider must not expose a partial commit or successful receipt
before its durable commit point. Host writers must use the host's coordination
protocol; editing live backend files bypasses that protocol and requires
intervention. The reference detects dirty source/policy/protocol/output files at
its fences and reconciles local files/index after committed response loss.

The digest covers the candidate's logical records, pinned policy and exact source
bytes. The publication envelope appends its own receipt atomically; the receipt
contains the pre-envelope candidate digest, avoiding a circular self-hash. Prior
receipts are immutable candidate content. The returned `snapshot_id`, when
present, is a physical-provider handle assigned at commit; the stored receipt
identity is the idempotency key and digest, not a fabricated future Git SHA.
A recovery result never pretends that a later current head is the original
publication snapshot.

An identical prepared retry returns the same candidate. Conflicting use of an
idempotency key refuses. After publication, `prepare` tells callers to recover;
`publish` on a retained candidate returns its original receipt. After candidate
loss/restart, recover by key, then open a fresh committed snapshot. Providers must
check source/policy/lease/freshness again even if validation previously passed.

`rebaseChanges(provider, change, newSnapshot)` compares all touched prior-record
hashes and pinned guidance. Conflicting edits or duplicate source completion
refuse. It does not infer ancestry, merge identities or publish. Abort an old
prepared attempt before rebasing; the host reviews/rebinds the next attempt and
lease. The legacy directory merge tool remains a JSON-reference utility.

## Standalone JSON/Git use

Initialize a new external instance once and commit it to its own attached-branch
repository as described in `ADAPTERS.md`. Never reinitialize existing knowledge.
The following launcher explicitly selects the reference backend:

```sh
node processor/provider-tool.mjs claim --instance /private/instance --instance-id my-instance
node processor/provider-tool.mjs context --instance /private/instance --instance-id my-instance --snapshot SNAPSHOT --request context-options.json
node processor/provider-tool.mjs apply --instance /private/instance --instance-id my-instance --request semantic-changes.json
node processor/provider-tool.mjs recover --instance /private/instance --instance-id my-instance --key cycle-key
```

Claim returns the snapshot and immutable guidance. A provider-capable claim
captures reserved original source bytes in the committed intake snapshot. Use the
returned base/policy/lease/source identities when producing semantic changes.
`apply` prepares, validates and publishes in one process; it never asks an agent
to generate a workspace graph or supply `--previous`. `open`, `stats`, `warnings`,
`audit`, `rebase` and streaming `export` are also supported. Evidence paging is
available via the public module API. CLI request paths are launcher inputs, not
fields in the provider-neutral contract.

For a host integration:

```js
import {createMemory} from './vendor/golem-harness/server/provider-memory.mjs';
const memory = createMemory(hostAuthorizedProvider);
const snapshot = await memory.open();
const context = await memory.context(snapshot.snapshot_id, {entity_id:'ent-example'});
const candidate = await memory.prepare(hostReviewedSemanticChanges);
const receipt = await memory.publish(candidate);
```

Host-owned providers import the public validators; they do not copy/fork private
semantic code. `createProviderReadView` connects a provider to the existing
cognition task/result protocol. The old `createMemoryReadView({state,...})` helper
is JSON fixture support; it is not the required host integration boundary.

## Portable export/import and migration prerequisites

`exportMemory(provider, snapshotIds)` yields a checksummed stream: versioned
manifest; each snapshot's original identity, pinned metadata and logical digest;
paged logical records; exact evidence chunks; snapshot ends; final checksum.
Canonical JSON sorts object keys, retains array order and uses exact JSON
scalars. Record order is stable by ID. Each event extends a SHA-256 checksum
chain; logical digests compare record IDs/content and exact evidence independently
of physical snapshot/instance identity.

`importMemory(stream, receiver)` requires an isolated host receiver with `begin`,
`snapshot`, `record`, `evidence`, `seal`, `publish`, `abort`. It verifies the chain,
stream/snapshot scope, source chunk sequence, full semantic audit and logical
equivalence before calling `publish` once. Duplicate records, missing evidence,
corruption and incomplete streams fail with staging discarded. Receivers retain
multiple snapshots, IDs/history, original source hashes, pinned policy, receipts
and journal/verification pointers. Imported snapshot IDs are new; the sink must
retain a durable original-to-imported snapshot alias map for old citations and
receipt references. It must not claim physical identity equality. Old provenance
locators remain metadata, not required physical paths for another provider.

The independent record receiver is a contract fixture. The JSON receiver restores
JSON-origin archives, including the original guidance/configuration artifacts,
into an explicit host archive sink. It does not invent missing JSON configuration
for an arbitrary provider's policy representation. Refuse unsupported imports
instead. The host supplies atomic staging/archive durability; no provider is
switched and no active instance is overwritten by these functions. Backups,
cutover/reverse migration and any optional future database implementation remain
host responsibilities.

## Selective processed-observation transfer

[PROCESSED_TRANSFER.md](PROCESSED_TRANSFER.md) defines the optional version-1
selective bundle, closure, isolated combination and destination transaction. It
adds processed knowledge to an existing instance; the archive import above keeps
its existing semantics. JSON providers expose `importProcessed` / `recoverTransfer`;
their host store must implement the explicit `checkTransfer` publication binding.
No provider capability is implied for a host that lacks this binding.

## Conformance and retained evidence

Run `node --test adapters/conformance/provider.test.mjs`. The same suite exercises
the JSON/Git reference and an independent record-map provider/minimal host.
The latter has no graph/file/Git dependency and rejects unfiltered ordinary
lookups. Fault controls cover pre/post-publication interruption, stale base,
source/policy drift, lease expiry, candidate seals, retries and lost responses.
The test provider is not a production database.

New vendors can call `providerConformance(name,factory)`. The factory returns
`provider`, `reserve(change)`, `expire()`, `changeSource()`, `changePolicy()`,
`advance()`, `interrupt('before'|'after')`, and `reopen()` for isolated synthetic
instances. Its initial logical corpus is `providers/corpus.mjs`. Fault controls
are trusted test seams, never model-loaded hooks.

The package builder includes/runs these tests, the existing regression suite and
installer checks. Supported platform CI retains observed job results; unrun or
pending platforms are not claimed as passing. See `MEMORY_PROVIDER_ACCEPTANCE.md`.
No host-specific issue, migration or release blocks Harness acceptance. Actual
LLM conformance is tracked separately in `COGNITIVE_CONFORMANCE.md`.
