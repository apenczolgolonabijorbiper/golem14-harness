# Local validation, retrieval, warnings and statistics

Normative companions: MEMORY_MODEL.md and schemas/memory-graph.schema.json,
schemas/hypotheses.schema.json. Inputs: graph, parsed sources keyed by ID,
processed ledger, question queue, hypotheses, optional previous graph/vocabulary.
CLI loadMemory additionally requires purpose/hypotheses canonical paths, reads
inbox direct .md files in sorted order, refuses unsafe directories/files and
requires each readable queue question ID and text to occur in questions/queue.md.

## validate / audit rules

```sudolang
Validate(snapshot, previous?) {
  Validate schema first; if shape fails, return schema errors only
  Require unique entity, claim, source, question and processed IDs
  Require disjoint entity/claim IDs
  Join processed <-> graph sources <-> actual observation identities and hashes
  Validate entity and claim references, quotations, times and correction history
  Validate hypothesis evidence and question analysis provenance
  Deduplicate errors preserving first occurrence
  Return valid only if no errors; advisory warnings do not affect validity
}
```

Schema validation uses the bundled subset: $ref local $defs, anyOf, type, const,
enum, properties, required, additionalProperties, items, min/maxItems, uniqueItems,
min/maxLength, pattern, date-time, minimum/maximum. Unknown validation keywords
fail closed. minLength uses trimmed UTF-16 length, maxLength untrimmed;
uniqueItems uses insertion-ordered compact JSON identity. UTC dates roundtrip.
These are the reference semantics even where a general JSON Schema validator
would differ. New format schemas use standard Draft 2020-12; semantic checks here
remain required and validation of additional format schemas must not impose new
runtime refusals on legacy data.

Question IDs `[A-Za-z0-9_-]{1,80}`; status open/closed, nonblank text <=2000;
source observation and all analysis source IDs must exist in actual inbox.
Closed questions need nonempty analysis.source_observation_ids and analysis.status
answered. A source with question_id must reference a known question. Ledger schema
1, observations array; each row status processed, correct source_file/hash, source
must occur in graph; every graph source must be processed and match actual path,
hash and recorded_at. Pending sources may exist outside graph, but must still be
valid. Entity provenance source IDs must exist in graph; external identifiers
are unique per entity as exact [scheme,namespace,value], trimmed namespace/value.
Entities cannot be created after graph.updated_at.

Claims require subject, attribution and optional entity object to exist. Each
quote must be an exact substring of the parsed observation body; every referenced
entity must include every claim observation in its source_ids. Hypothesis claims
need uncertainty; time bounds ordered, unknown precision has no bounds, exact
precision needs from. created_at <= graph.updated_at; asserted_at must equal at
least one cited source recorded_at. Correction targets must exist, differ from
self, have same subject/predicate and terminal status superseded/retracted;
superseded claims need a replacing claim. Dependency and correction edges must
be acyclic and reference existing claims (including inactive retained history).

With previous: graph.updated_at cannot decrease. Retain every source unchanged;
retain entity type, existing kind, created_at, source IDs and external IDs.
Retain every claim, every field other than status byte-equivalent under compact
JSON serialization, and same field count. Only active -> active|superseded|retracted
is legal; terminal statuses cannot reverse. Labels and aliases are mutable at
this validator level (candidate writer limits its supported edits separately).
Hypotheses schema 1, at most 5000 rows, unique IDs, updated_at <= collection time;
support/refutation IDs must be claims, observation_ids must be graph sources;
supported/refuted require nonempty corresponding evidence.

`validate` result: valid:true, layout:{purpose_path,hypotheses_path},
profile:{state:selected|none,guidance_version}, warnings (first 1000),
warning_summary:{total,returned,truncated}, entities/claims/sources counts.
CLI refusal is `Memory validation failed` with diagnostics; read errors may
precede semantic checks. Validation changes no persisted files.

## warnings

Sorted by code, object_id, message using COMMON collation. Each warning has code,
object_id,message,documentation:`docs/MEMORY_MODEL.md#validation-warnings`.
Codes: unused_entity, duplicate_corroboration (identical full bodies of at least 2
cited observations on corroborated claims), unknown_kind, unknown_predicate,
unknown_external_id_scheme, duplicate_external_id, multiple_active_values
(different exact typed object values for active subject/predicate declared
single-valued), dependency_changed (active claim/open or supported hypothesis
references terminal evidence), capacity_near_limit at ceil(80% of collection cap).
Graph caps: sources 10000, entities 5000, claims 20000. Invalid graph shape produces
no warnings; it does not become valid. Raw warning text templates are retained in
the golden results. Duplicate warnings retain source encounter order before sort.

## context

Inputs query, entity_id, source_id, limit (positive integer, default 30, cap 100),
optional predicate/type/kind comma lists, status all|active, hops 1..3,
expansion_budget 1..20000 (default 10000), current true|false, valid_at, exact
external_id+scheme+namespace, API-only claim_ids (unique <=100), seed_ids.
Invalid/duplicate filter members refuse. Predicate and kind use schema patterns;
types person/place/event/organization/other. Read validates complete memory first.

Normalize lexical tokens using NFKD, remove combining marks, lowercase, replace
ł with l; tokens are Unicode letters/numbers/_/-. Whole-token matches only.
Query tokens deduplicated. Seed entities whose label/aliases/ID/kind match a token
or whose exact external value or configured prefix+value matches a whitespace
query token. Add explicitly requested entity/seed IDs. Claim score = count of
query tokens in predicate/scalar value/source quotes +4 if subject/object is a
seed +8 if requested source cited. Empty unseeded/unfiltered query scores each
claim 1. Sort positive-score claims by descending score then ID collation.
Legacy selection: take top limit, gather their subject/attribution/object IDs,
then append unranked claims related through subject/object or correction edge to
selected claims; cap combined claims. Preserve graph order for related claims,
entities and sources. Return all seeds plus claim-referenced entities, sources
cited by returned claims plus requested source. Method
lexical_exact_tokens_plus_one_graph_hop; truncated if ranked+related exceeds bound.

If any predicate/type/kind/status/hops/expansion_budget supplied, extended path:
exclude status and predicate before bounds. Type/kind constrain presentation if
any subject/object/attribution entity matches; keep excluded supporting entities
separately. Without explicit hops use same score/rank/related algorithm, filter
entity presentation BEFORE bounds, metadata hop 0 ranked, 1 related, parent null.
With hops: seed from entities plus subjects/objects of matching claims/source;
empty query seeds every entity. Build undirected subject/object adjacency, sort
claims by ID. BFS sorted seed/frontier IDs, each claim examined once, budget
counts examined claims INCLUDING later presentation exclusions; attach hop
(start 1), first parent_entity_id, expand adjacent entity IDs for up to hops.
Then apply presentation filters and claim cap. Return hidden counters for
superseded/retracted/predicate/entity, filters, traversal, expansion budget,
truncation reasons claim_limit/expansion_budget. Methods
lexical_filtered_plus_one_graph_hop or lexical_seeds_breadth_first_undirected.

Temporal selection precedes claim-ID narrowing and ranking. valid_at excludes
unknown/no-bounds claims; includes closed interval bounds, counts hidden unknown
and out-of-range. current requires single_valued vocabulary. For each declared
subject/predicate remove all its claims; consider active in-range candidates:
prefer exact with from, then partial/as_reported with from, then missing-from or
unknown using asserted_at. Select newest time, preserve all tied winners sorted
ID. Keep non-single-valued claims as selected previously. Report selected IDs,
alternatives (input order), basis valid_time.from|valid_time.from_uncertain|
asserted_at_heuristic, unresolved if any uncertain time or competing object,
tied if winners have different objects. Use explicit valid_at or now; provider
queries use snapshot.updated_at, standalone uses clock when no valid_at.
Exact external lookup requires all three strings and selects entities by exact
scoped triple; clear lexical query and use matching entity IDs as explicit seeds.
Prefixes never alter exact identity.

Finally cap displayed entities and sources at 100 (supporting_entities is the
separate extended result); report entity_limit/source_limit. Temporal metadata
keeps only groups intersecting displayed claims, caps groups/selected/alternatives
at 100 and reports alternatives_truncated. CLI adds source_excerpts with max 4000
UTF-16 units per source and 64000 total; metadata includes truncated and limits.
The query API itself returns source metadata, not automatic body excerpts.
No zero-hit result proves absence or processes pending observations.

## stats

Inputs validated graph, sources, ledger, queue. Output capacity:{sources,entities,
claims:{used,limit}}, totals:{observations,processed,pending,entities,claims,
relations,active_claims,open_questions}, timeline ascending UTC day,
graph_updated_at, definitions. processed counts ledger rows whose hash matches
actual source; pending = observations - processed. Relations are claims with an
entity object, including history. Per day count observation recorded_at,
entity/claim created_at (relation also increments relations); include cumulative
observations/entities/claims/relations. Do not invent pre-migration dates.
Exact definition strings and zero-input output are in fixtures.
