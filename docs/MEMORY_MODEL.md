# Source-grounded memory model (0.7.0)

The graph is version 2. It contains sources, entities and claims. Sources preserve
UUID, inbox path, exact UTF-8 SHA-256 and recorded_at. Every processed ledger row
must resolve to a graph source and vice versa. Entities have an opaque ID, coarse
type, label, aliases, source_ids, created_at, uncertainty and optional stable kind.
Claims use attributed_to_id and classification source_assertion, hypothesis or
corroborated. Entity-valued objects represent relations; scalar objects represent
values. There is no automatic truth evaluation or semantic embedding service.

Only the target format is supported. Previous runtime/instance formats may be
scrapped and recreated with the initializer. No legacy reader, alias conversion,
layout migration or rollback workflow is provided. Historical release documents
remain historical evidence, not setup instructions for this version.

The physical paths and graph-file procedures below describe the JSON reference.
Other [memory providers](MEMORY_PROVIDERS.md) enforce the same logical schemas,
evidence and history rules through records, without requiring these files.

## Provenance and history

Each claim cites exact nonempty body quotations. Subject, attribution and object
entities must include every cited observation in their source_ids. asserted_at
copies a cited source's recorded_at exactly; it is not an upstream authoring date.
valid_time represents evidenced effective time, with explicit precision. Recording,
upstream assertion and validity time must not be conflated.

Within a target-format instance, retain source identity/bytes and old claims.
Retained claim fields (including depends_on) are immutable except status. Correct
through new claims and supersedes; do not reactivate superseded/retracted claims.
Entity type, stable kind, created_at, retained source IDs and external IDs are
protected. A changing domain category is a claim, not a mutation of stable kind.

## Scoped external identifiers

An entity may have up to 64 external_ids, each {scheme, namespace, value}. Scheme
is a lowercase slug; namespace and value are nonempty trimmed strings (500/1000
characters maximum). Identity is the exact triple, including case. No implicit
URL/path normalization, suffix extraction or commit-hash abbreviation is performed.
Identifiers are append-only. Aliases and labels do not establish equivalence.

Exact lookup uses separate arguments to avoid ambiguity with colons in namespaces:

```sh
node processor/memory-tool.mjs context --root ../instance --external-id 1001 --scheme record --namespace https://synthetic.invalid/catalog
```

A query matches exact identifier values or configured prefix+value forms, as whole
whitespace-delimited tokens (or the entire query for values containing spaces).
Declare prefixes in a vocabulary v2 file. A bare value matching several scopes
returns alternatives, never an automatic merge. duplicate_external_id warns when
two entities share the same scoped key. Distinct namespaces do not collide.

## Temporal retrieval

Declare single_valued predicates in vocabulary v2. context --current true selects
active claims per subject/predicate before output truncation and graph expansion.
Exact effective starts no later than evaluation time outrank partial/as-reported
bounds and recording-time snapshots; alternatives remain explicit. Partial or
as-reported bounds use valid_time.from_uncertain only when no exact start is
available, with unresolved=true. Expired intervals and future starts are not current. If no known
start exists, latest asserted_at is a labelled asserted_at_heuristic, not proof of
current truth. At the latest time all tied candidates are returned, subject to the
output bound. current_selection records selection basis, selected IDs, alternative
IDs, unresolved state and alternatives_truncated; current_ties identifies differing
values with equal selection times. Other evidence is not erased or superseded.
Missing time/competing active values remain a review obligation.

context --valid-at 2026-01-15T00:00:00Z selects intervals whose known bounds contain
that time. Endpoints are inclusive; overlapping endpoints can return both claims.
A null bound is open; both bounds null or precision unknown is excluded and counted
in hidden.unknown_time. hidden.valid_time/current count other temporal exclusions.
Combining --current and --valid-at uses the supplied time for selection. This is
valid-time retrieval under the graph's current correction/retraction knowledge,
NOT reconstruction of what was known at a past transaction time. Explicit status
filters still apply; current single-valued selection uses active claims only.

## Hypotheses and dependencies

memory/hypotheses.json is strict JSON with schema_version 1, updated_at and a
hypotheses array. Each record requires id, statement, status, support, refutation,
confidence and updated_at. Optional confidence_basis/model are bounded strings;
observation_ids references graph sources. Status is open/supported/refuted/withdrawn;
confidence is 0..1 and is an analyst assessment, not a calibrated probability.
supported requires support; refuted requires refutation. Empty arrays are valid
for open/withdrawn. IDs are unique within the collection. Record timestamps cannot
exceed the collection timestamp. Support/refutation IDs must resolve to claims.

Malformed JSON names the file. Missing/unsupported version, invalid shape, unknown
claim/source IDs, out-of-range confidence, duplicate hypothesis IDs and unsupported
status are errors, also during adapter candidate validation. No legacy warning-only
mode exists. validateHypotheses diagnostics include the resolved path and record ID
or schema path: hypothesis claim not found, hypothesis source not found, duplicate
hypothesis ID, hypothesis updated after collection, hypothesis status needs evidence.

Claims may list at most 128 unique depends_on claim IDs. Missing, self-referential
or cyclic dependencies fail. Iterative topology validation is O(V+E) and stack-safe.
Exact source quotation and entity provenance remain mandatory. Direct dependencies
on superseded/retracted evidence produce dependency_changed for active claims and
open/supported hypotheses, naming both IDs. Support and refutation changes both
matter. This does not change conclusion status/confidence, propagate truth or do
unbounded transitive review. Reverse-impact retrieval is not added in this release.

## Retrieval and resource bounds

The deterministic CLI validates the full target snapshot before context/stats.
Lexical normalized tokens, aliases, values and source quotes seed ranking; optional
predicate/type/kind/status filters and up to three graph hops are available.
Related-claim expansion uses the temporally selected graph, never reintroducing an
excluded claim. No match is not proof of missing evidence: pending inputs and
unfetched records are outside processed knowledge.

Output is at most 100 claims, 100 primary entities and 100 source records; supporting
entities close returned claim endpoints. Source excerpts have a 4,000-character
per-source and 64,000-character total budget, with explicit truncation. These
excerpt limits do not truncate exact quotations embedded in the returned claims;
use a smaller claim limit when quotations themselves are large. Follow the
original citations before drawing conclusions from excerpts. expansion_budget is
at most 20,000. Sources have 10,000 slots, entities 5,000, claims 20,000; each claim
has at most 32 source quotations. Profiles cannot raise engine limits.
stats.capacity derives used/limit for each collection from the schema. Near-limit
warnings start at ceil(80% * limit). Exceeding a limit fails before publication.
See CAPACITY_BENCHMARKS.md for measurement, platform and byte-size limitations.

## Validation before publication

Validate a complete proposed snapshot including ledger and hypotheses against the
committed prior graph, then publish atomically through the storage adapter. Keep
lease ownership and compare-and-swap; re-read/revalidate after concurrent changes.
Do not manually rewrite RELEASE.json or bypass checks in a consuming application.
The schema checker accepts only its bundled bounded keyword vocabulary.

Completion rows have one writer: the host candidate assembler (the adapter/backend
when it owns assembly). Cognition agents do not also append rows on adapter or
provider paths. Direct staged-file validation requires the host to supply all
rows first; it does not generate them. Logical providers use processed records,
not a mandatory `processed.json` file. See the
[responsibility table](PROCESSING.md#completion-row-ownership).

## Validation rules

Schema diagnostics include the failing graph path and describe shape, type, value
or schema vocabulary violations. The following messages describe cross-record
checks in `validateMemory`. Unsupported fields such as `speaker_id` fail schema
validation as `unexpected field`; unsupported classifications fail as `invalid enum`.
There is no alias-coexistence attribution check in graph v2. The CLI additionally checks that the readable queue
contains each question's ID and text.

| Diagnostic | What to check |
|---|---|
| `duplicate ID` | Each source, entity or claim ID is unique within its collection. |
| `Entity/claim ID collision` | Entity and claim IDs must be distinct. |
| `Invalid question queue` | Supply a version 1 queue with a questions array. |
| `Invalid/duplicate question` | Supply unique valid question IDs, a supported status and nonblank text within the length limit. |
| `Question source missing` | The question's source observation must exist. |
| `Question analysis source missing` | Every observation referenced by question analysis must exist. |
| `Closed question needs an analyzed answer` | A closed question requires answered analysis with source observations. |
| `Invalid processed ledger` | Supply a version 1 ledger with an observations array. |
| `Duplicate processed row` | Exactly one completion row is allowed per observation ID; fix the candidate assembler, never silently deduplicate. |
| `Ledger source mismatch` | Each row must have status `processed`, an existing source and matching source path and hash. |
| `Processed source missing from graph` | Each ledger source must be represented in the graph. |
| `Graph source mismatch` | The graph source path, hash and timestamp must match the inbox observation. |
| `Graph source is not processed` | Stage a matching processed ledger row for every graph source. |
| `Invalid source` | Verify the observation ID, filename, nonempty body and parseable recording time. |
| `Unknown source question` | A source's question reference must resolve in the queue. |
| `Entity source missing` | Every entity source ID must resolve to a graph source. |
| `Entity created after graph update` | Entity creation must be at or before the graph update. |
| `Claim entity not found` | The named `subject_id`, `attributed_to_id` or `object.entity_id` field must reference an existing entity. The message includes both IDs. |
| `Claim source/quote mismatch` | Every cited observation must be a graph source and contain the exact quote. |
| `Entity provenance does not include claim source` | The subject, attributed entity and entity-valued object must each include every cited observation ID in their own `source_ids`. |
| `Hypothesis requires uncertainty` | Supply uncertainty for any hypothesis. |
| `Invalid time range` | The validity start must be at or before its end. |
| `Unknown time cannot assert bounds` | Unknown validity has empty bounds. |
| `Exact time needs a bound` | Exact validity requires a start bound. |
| `Claim created after update` | Claim creation must be at or before the graph update. |
| `Assertion timestamp must match a source` | Copy `recorded_at` from any cited observation to `asserted_at` exactly, including its fractional-second formatting. |
| `Invalid correction` | The older claim must exist, differ in ID, share the subject and predicate, and be superseded or retracted. |
| `Missing replacement claim` | A superseded claim needs a replacement that references it. |
| `Correction cycle` | Correction links must be acyclic. |
| `Graph update timestamp went backwards` | Preserve or advance the prior graph update timestamp. |
| `Entity identity/history removed` | Retain each prior entity's ID, type, creation time and source IDs. |
| `Claim history removed` | Retain every prior claim. |
| `Claim history mutated` | Preserve all prior claim fields except status. |
| `Claim status history reversed` | Preserve the status of every already superseded or retracted claim. |
| `Source history changed` | Preserve every prior graph source record. |
| `Invalid/duplicate external identifier` | External IDs are trimmed and unique by scheme/namespace/value. |
| `Entity external identifier history removed` | Retained external IDs cannot be removed or changed. |
| `Unsupported/invalid previous graph` | Prior graph must use the target schema and valid shape. |
| `Invalid claim dependency` | Every dependency exists and differs from the claim itself. |
| `Claim dependency cycle` | Dependency edges must be acyclic; cyclic IDs are named. |
| `Readable queue missing question` | Include the question ID and text in the Markdown queue. |

Provider validation independently enforces unique IDs in each logical collection:
`processed: duplicate/invalid ID` rejects repeated completion IDs before checking
source integrity. It does not accept or silently deduplicate malformed records.
The JSON duplicate diagnostic above is specific to `validateMemory`.

## Validation warnings

Warnings are advisory and have code, object_id, message and documentation.
CLI validate/adapter completion return at most 1,000 warnings with warning_summary
(total/returned/truncated); large duplicate/conflict messages show the first ten
IDs plus the omitted count. The library collector returns the complete list. They
prompt review; no absence of warnings proves truth or independent corroboration.

| Code | Meaning |
|---|---|
| `unused_entity` | Entity is not referenced by claims. |
| `duplicate_corroboration` | Corroborated claim cites identical source bodies; repetitions are not independence. |
| `unknown_kind` | Stable kind is not declared in the selected vocabulary. |
| `unknown_predicate` | Predicate is not declared in the selected vocabulary. |
| `unknown_external_id_scheme` | Identifier scheme is not declared by the selected vocabulary. |
| `duplicate_external_id` | Exact scoped identifier belongs to more than one entity. |
| `multiple_active_values` | Single-valued subject/predicate has different active objects; equal repeated values do not warn. |
| `dependency_changed` | Direct support/refutation/dependency evidence was superseded/retracted. |
| `capacity_near_limit` | Source/entity/claim usage is at least 80% of its engine limit. |

Hosts may add namespaced advisory warnings at their boundary. Policies cannot
weaken schema, quotation, history, identity or transaction rules. No executable
warning hooks, total evidence-strength ordering or automatic truth scores exist.


Complete-cycle drafting: the reference local writer can assemble explicit question
updates, schema-1 hypotheses and chat events in one preview/apply. See
[PERFORMANCE.md](PERFORMANCE.md#complete-cycle-drafts-vp-020) for base hashes,
canonical queue fields, output paths and publication boundaries. Both queues are
rendered from the same records. Evidence indexing and adapter completion remain
separate required operations.

## Unknown hypothesis confidence capability

`hypothesis-unknown-confidence-v1` adds explicit `confidence:null` (unknown) with uncertainty retained in `confidence_basis` and the proposal to hypotheses v1. Numeric confidence keeps its meaning.
Negotiate this capability before using newly generated reviewed-learning records;
older validators cannot validate null confidence. No source/graph migration is
needed. Cognitive task proposals and receipts retain rationale, verification and
correction history; see [COGNITIVE_TASKS.md](COGNITIVE_TASKS.md).
