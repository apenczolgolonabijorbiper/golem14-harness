# Profile-driven analysis and retrieval recipe

Use a fresh external target-format instance. The host provides permissions,
inference and storage; the engine remains read-only downstream.

1. Initialize an empty external root with processor/init-instance.py --root PATH
   --profile. State purpose, scope, language and review priorities in
   instance/purpose.md. Commit golem.config.json and all selected profile files
   together before a claim. An unconfigured instance has no domain policies.
2. Choose stable kinds and one predicate direction (for example parent_of rather
   than mixing parent_of/child_of synonyms). Keep changing categories as claims.
3. Write an explicitly selected vocabulary version 2. For a synthetic record:

```json
{"schema_version":2,"kinds":["record"],
 "predicates":["has_state","reports_result","verified_by","parent_of"],
 "single_valued":["has_state"],
 "external_id_schemes":[{"scheme":"record","prefixes":["REC-"]}]}
```

The selected config remains {"schema_version":1,"profile":{"path":
"profiles/default.md","vocabulary":"profiles/vocabulary.json"}}. These files
are in the external instance. JSON policy is declarative; prose is agent guidance.

4. Check adapter status/capabilities. The reference adapter advertises
   candidate-validation-v1, purpose-guidance-v2 and core-policies-v2. When selecting
   policies, require core-policies-v2 or a host-owned implementation with the same
   immutable guidance and validation semantics; do not silently use an old adapter.
5. Claim at most 20 aged, finalized observations. Read delivered guidance and keep
   the immutable snapshot/identity. Receipt of text does not prove adherence.
6. Retrieve before linking identities or writing claims. Exact lookup is preferable:

```sh
node processor/memory-tool.mjs context --root ../instance --external-id 1001 --scheme record --namespace https://synthetic.invalid/catalog
node processor/memory-tool.mjs context --root ../instance --entity ent-selected --predicate has_state --current true
node processor/memory-tool.mjs context --root ../instance --entity ent-selected --predicate has_state --valid-at 2026-01-15T00:00:00Z
```

Use actual opaque entity IDs from the first result, not ent-selected literally.
A raw question can be a poor lexical query; use identifiers and predicate filters.
Inspect ties, uncertain alternatives and truncation, and read full cited sources.
Zero hits do not establish absence: inputs may still be pending or unfetched.

7. Separate workflow state from a person's reported result and independently
   reviewed evidence. A Closed state is not a verification result. Record exact
   quotes and explicit uncertainty; neither duplicated source IDs nor repetitions
   establish independent evidence. Do not infer private/sensitive attributes.
8. Preserve retained claims. A correction for the same subject/predicate uses a new
   claim with supersedes and a terminal old status. For a changed predicate, retract
   the old claim and add the new claim; do not mutate its predicate. Add depends_on
   to a new conclusion when relevant; never edit it into a retained claim.
9. Review warnings and hypotheses every cycle. Keep missing-evidence questions in
   both queues; close only with reviewed source-grounded answered analysis. Optional
   host-owned closure_criteria metadata can guide review but is not a new core rule.
10. Stage graph, strict hypotheses, ledger, queues and journal in one candidate.
    Include guidance_version: ID from claim. Record completed local checks, mark
    host checks pending and select a durable completion-record pointer keyed by
    instance/run before validation (see [the pointer rule](PROCESSING.md#verification-record-and-journal-pointer-vi-019)).
    Then validate/commit via the adapter.
    On head conflict re-read/merge/revalidate; on committed policy change release
    and reclaim. Do not force another run's lease or mark pending sources processed.
11. Read back persisted state and retain the actual validation/publication/read-back
    results, snapshot identity and returned warnings at the selected location.
    Keep unresolved alternatives, questions and warnings reviewed in the staged
    journal; do not rewrite it after publication to add a verdict. Any candidate
    edit after validation requires revalidation. Resume from lease/ledger/run
    metadata; no reinitialization
    during ordinary processing. An incompatible old instance requires an explicit
    fresh setup, not an automatic conversion or deletion.

Manual hosts without delivered guidance must retain selected profile/config/text
and hash metadata themselves and verify deterministic policy checks. They may not
claim reference-adapter capability solely because they copied a recipe.

## Avoid cycle-specific scripts

The optional `processor/write-candidate.mjs` assembles graph/index/journal drafts
from a structured change set after semantic review. See PERFORMANCE.md. It does
not replace source indexing, hypothesis/question maintenance or the adapter
validate/commit sequence. Keep the selected profile concise and committed before
claim; do not rediscover domain conventions or generate transaction machinery
for each batch. Observe host process completion instead of fixed sleeps.


Complete-cycle drafting: the reference local writer can assemble explicit question
updates, schema-1 hypotheses and chat events in one preview/apply. See
[PERFORMANCE.md](PERFORMANCE.md#complete-cycle-drafts-vp-020) for base hashes,
canonical queue fields, output paths and publication boundaries. Both queues are
rendered from the same records. Evidence indexing and adapter completion remain
separate required operations.
