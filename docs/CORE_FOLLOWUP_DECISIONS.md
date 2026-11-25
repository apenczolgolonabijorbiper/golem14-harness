# Core follow-up decisions: #20 and #29–#33

Assessed 2026-11-25 against the 0.13.2 implementation, retained in 0.13.3.
This completes the five P3 investigation gates in tracker #20. The earlier
P1/P2 implementation remains delivered by 0.7.0. These decisions keep the
current graph v2, hypotheses v1, vocabulary v2 and provider contracts.

| Issue | Decision | Evidence and remaining boundary |
|---|---|---|
| #29 | Adopt existing time fields and quoted upstream provenance | Out-of-order imports and correction fixtures work without repurposing ingestion/assertion time. No typed upstream-time query or past-knowledge reconstruction is introduced. |
| #30 | Defer core group metadata and scheduling | Semantic record intake and host input manifests suffice for the tested cases. A real 31-source reference cycle completes in 20 + 11 batches; complete input and completed analysis are separate facts. |
| #31 | Retain change entities and ordinary attributed claims | Five history operations round-trip through bounded retrieval, with source provenance and history validation. The attributed-edge sketch is smaller but unsupported and lacks equivalent history machinery. |
| #32 | Retain scalar/entity values and profile conventions | Measurement entities keep amount/unit pairs distinct; explicit state claims distinguish removal, unknown and source-provided null from missing evidence. Structured object forms remain rejected. |
| #33 | Retain explicit relation claims | Scoped lookup, contradictory identity claims and retraction preserve all original entities/IDs. Graph traversal does not imply equivalence closure or a canonical merge. |

These are decisions on the stated synthetic requirements, not claims that the
model solves every future application case. No schema extension is approved by
this assessment. A demonstrated remaining gap should have a separately reviewed
proposal with its own bounds, history semantics and conformance cases.

## Reproduction and interpretation

From a checkout or extracted distribution, with Node 22.12+, Python 3.12+ and Git:

```sh
node tools/assess-core-followups.mjs
```

The command reads [the synthetic inputs](../cognition/assessments/core-followups/input.json),
asserts the expected answers/integrity refusals against the actual core and
reference adapter, and emits JSON. The actual Linux run is retained as
[results-linux.json](../cognition/assessments/core-followups/results-linux.json).
It includes the input SHA-256 and runtime identity. All five assessments must
finish without an assertion failure. The staged release builder runs this same
command on every supported platform. Timing samples are observations without
pass/fail speed thresholds; they vary across reruns and machines.

The fixtures supply the semantic interpretation explicitly. They do not call an
LLM, score inference quality, inspect a consuming application or touch private
data. The group cycle initializes and removes its own temporary Git instance;
other cases use isolated in-memory candidates. No installed engine is edited.

## #29: ingestion, upstream assertion and validity

Four revision observations describe open, closed, uncertain/disputed and corrected
states. Revision r2 is ingested before r1 even though its upstream effective date
is later. Upstream timestamps and authors remain in exact source quotations;
`asserted_at` still exactly equals the cited source's `recorded_at`. The missing
day/zone in r3 remains quoted text with unknown validity and explicit uncertainty.
The test refuses replacing an ingestion timestamp with the upstream timestamp.

| Query | Expected result |
|---|---|
| Current state at the fixture's May reference time | repaired; uncertain r3 remains a visible alternative |
| All-status valid-at January 15 | open |
| All-status valid-at February 2 | open and the now-superseded closed assertion |
| All-status valid-at March 1 | open, superseded closed and repaired assertions |
| Current + valid-at February 2, using today's correction statuses | open: closed is already superseded, and repaired starts February 3 |

The overlapping open intervals are intentional: all-status valid-at is an
interval filter, not automatic change reconstruction. Current selection uses
current correction status; combining it with a past validity date cannot answer
what the system knew at that past date. The response explicitly states this.
A past transaction snapshot needs host snapshot/history selection, not another
timestamp inserted into the same current graph.

The revision-level and multi-revision digest representations preserve the tested
state, author and upstream text when every claim keeps its exact revision quote.
The digest binds all claims to one ingestion time/source ID; it cannot preserve
the separate arrival identities/times through those fields. Repeated digests
also repeat context rather than demonstrating independent evidence. Revision
intake is preferable when that granularity matters. Typed upstream-time filtering
remains a possible future requirement, not a demonstrated need in these cases.

## #30: groups, readiness and completion

The actual adapter reports 31 finalized, aged sources ready. A request for 31 in
one claim fails without changing HEAD because the cap is 20. A validated first
batch completes 20; 11 remain ready. A second batch completes those 11. All 31
ledger rows are unique and the original source bytes/hashes remain unchanged.
No atomic whole-group guarantee is claimed.

Three independent semantic records emit three observations and zero on an
unchanged repeated fetch. A separate bounded host-context example includes two
parts (106 UTF-8 bytes under a 240-byte/two-item budget) and explicitly reports 29
omitted parts. A claim citing its single relevant source validates; unrelated
parts are not a quotation requirement.

The input count is known from the synthetic producer manifest; the core does not
discover missing input from observation bodies. Input presence, readiness,
completion and selected quotations are separate host/producer facts. No optional
group metadata is implemented, so its proposed UUID/range/duplicate-part/revision
validation and group capability tests are conditional items that do not apply.
The bounded first slice is a producer manifest plus ordinary bounded adapter
batches. Core group metadata/scheduling is deferred until independent records and
host completeness diagnostics demonstrably fail a concrete requirement.

## #31: change entities versus attributed edges

The fixture models additions, modifications, renames, parent changes and reported
test results using profile-level kinds/predicates. It needs nine entities and 23
claims. A two-hop artifact query returns all 23 claims within a 100-claim and
100-expansion budget; reconstructed operation fields equal the fixture inputs.
A smaller retrieval budget reports truncation. Retained claim mutation fails.

The retained Linux run records the compact canonical graph size, a seven-sample
median validation duration and a design-only edge projection size. The projection
uses flat scalar attributes (including explicit parent ID strings) and source
references, but omits equivalent canonical
entity/history machinery; it fails the current schema at `attributes`. It has no
implemented validator/retrieval path, so these byte counts are not a like-for-like
storage or speed comparison. Its compactness alone does not demonstrate a missing
semantic capability. Retain the working representation for this scope.

Interpretation and evidence policies remain in the profile/host. Test results
are source assertions, not proof that a diff implements an intent. The harness
checks quotes/provenance, not code semantics; no universal evidence-strength
ordering or hard-coded artifact vocabulary is added. The runner demonstrates
`host.reported_test_only` as a namespaced host warning outside core validation.

## #32: structured changes, units and explicit states

The fixture has an entity-valued assignment; separate measurement entities for
8 hours and 8 points; amount/unit claims; a change entity with before-value,
after-state and revision claims; and explicit removed/unknown/null states.
The two measurement references remain distinct and produce an unresolved current
tie rather than silently equating their numbers or converting units.

`removed`, `unknown` and `explicit_null` are ordinary profile-declared scalar
values, not new reserved core values. Missing evidence produces no claim. A
retracted assignment disappears from active retrieval and remains in history.
The linked change entity preserves its original entity-valued endpoint and
explicit removal state. Exact quotation and entity provenance still apply.

Empty objects, raw null, nested field/from/to objects, inline units and extended
entity objects fail schema validation. Missing referenced entities and edits to
retained numeric values fail integrity validation. No structured object or
arithmetic API is introduced; bounds are existing entity/claim/string limits.
Keep the existing representations for these cases. First-class structured values
or units would need a demonstrated query/integrity requirement and reviewed
equality, grouping, bounds and source-unit rules.

## #33: explicit identity reconciliation

Three entities share a label. Two share catalog-a/42; the third has catalog-b/42.
Before adding relation claims, exact scoped lookup returns both ambiguous
catalog-a entities or only the catalog-b entity. Neither labels, identifier
co-occurrence nor shared numbers create an equivalence or merge automatically.
The scoped duplicate warning names both affected entities without preventing
the recording of a reconciliation assertion.

The analyst-provided `same_as` hypothesis and contradictory `distinct_from`
assertion remain visible alongside a second `same_as` link. A bounded traversal
may display that chain, but no transitive alpha-to-reused claim is synthesized.
Retracting the first equivalence leaves only the direct distinction active from
alpha; the retracted assertion and every entity/identifier remain in history.
Limited expansion reports truncation. Contradictions require host/model review;
there is no identity-specific automatic truth decision or hidden persistent merge.

## Delivery and portability

0.13.3 packages this decision record, inputs, runner and observed Linux results;
the existing build regenerates the offline explorer. Review/merge, supported
platform CI and verification of the downloaded published package are separate
gates recorded in #20 and the delivery PR. Do not infer publication from a local
build result.

#74–#77 core portable-script specifications have not shipped at the assessment
baseline. This work changes no production executable/schema contract or cognitive
SudoLang task protocol. Future specifications must preserve the tested time,
bounded batch, provenance, scalar/entity, scoped identity and history semantics;
the assessment runner is validation tooling rather than a required host runtime.
