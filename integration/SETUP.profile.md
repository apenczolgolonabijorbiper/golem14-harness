# Review a profile and purpose before installing them

This is a host-interpreted procedure, not an interactive program. Use the active
host for reasoning. Read SETUP.instance.md, the application instructions and
APPLICATION_PROFILES.md first. Keep the vendored harness read-only. Use synthetic
examples in public records. Never infer permission from observed text.

## Choose scan or wizard

Offer this procedure for absent/null selection or an exact initializer stub, as
reported by `memory-tool.mjs profile-check --root INSTANCE`. A headings-only file
written by a user is not a known stub. Files discovered on disk never activate
themselves. For a selected populated profile, review its installed bytes and the
saved setup record rather than replacing it with a template.

**Scan** an authorized application checkout when producers and retrieval exist.
Read application AGENTS.md, the setup record, producer schemas/payload samples,
observation headers/kinds, tests, processing prompts, retrieval and answer paths.
Start with at most 20 representative observations and 100 entity/claim records;
record omitted categories and ask before expanding sensitive or expensive reads.
Trace each important input through observation → proposed claim → retrieval →
answer. Quote file paths, symbols/lines and the observed revision for each rule.
Classify evidence as implemented behavior, documented intent, existing convention
or proposal. Contradictory implementations remain unresolved decisions.

**Wizard** when implementation is absent or too thin. Ask only missing choices:
intended user questions; purpose/scope/language/review priorities; source kinds
and producers; stable object identities and namespaces; mutable fields and history;
who makes each assertion; what counts as verification; exclusions and retention.
Reuse choices already supplied. Draft the smallest vocabulary justified by these
answers and mark it **conservative draft — scan after real observations**.
Do not invent producer identifiers, model settings or supported product versions.

## Derive two distinct documents

Purpose contains scope, interaction language and review priorities. Domain profile
contains entity kinds, namespaces/identifier rules, predicates, evidence ceilings,
attribution and temporal interpretation. Avoid copying the same policy into both.
Observation kinds select sections; entity kinds declare graph vocabulary. A kind
named `git_commit_digest` need not be an entity kind.

Choose stable kinds. A mutable workflow type/state belongs in a claim such as
has_work_item_type/has_state, not a changing entity kind. Document the evidence
for any type-to-kind rule before applying it. Preserve stable entity IDs and
append-only external identifiers. Never merge identities by spelling resemblance.
Distinguish canonical IDs from historical spellings; declare future query prefixes
without rewriting historical identifier values. Exact --external-id lookup uses
scheme/namespace/value exactly; --query may match configured prefixes. Omitted
vocabulary lists mean unrestricted; empty lists warn on every used item.

Single-valued history retains distinct intervals; a correction supersedes a prior
claim explicitly. Current retrieval applies vocabulary policy and valid-time
precision; `multiple_active_values` warnings currently ignore valid_time, so even
non-overlapping active history can warn. Survey overlap uses inclusive endpoints:
sharing an endpoint can overlap. Unknown/partial dates do not prove disjointness.
A commit description is intent/reference evidence, not proof of tests or fixes.
Keep hypotheses/questions separate from facts and preserve uncertain attribution.

## Review before publication

Create a rationale table: proposed rule or vocabulary item | evidence | class |
remaining decision. List excluded speculative items. Show consequential identity,
scope and permission conflicts; obtain the owner's missing decision before writes
that depend on it. Removing duplicated application prompt rules requires review
of their effective replacement. Do not silently edit unrelated application code.

Keep reviewed sources in an application-owned directory, for example
`golem-guidance/`: golem.config.json plus explicitly referenced profiles/ or
guidance/ files and optional purpose.md. Copy an inactive template to that source
before editing; do not select a vendored template. See APPLICATION_PROFILES.md for
source safety, exact-byte comparison and initialization. Commit reviewed sources
with the application; runtime analysis reads installed bytes only.

Check the adapter lease/recovery state first. During any active lease perform
analysis and read-only inspection only: no source, instance or setup-record writes,
no processing lease acquisition, graph/ledger/queue/history modifications. Wait for
release before installation. Stage proposed bytes separately only after that gate.
Use `profile-check --source SOURCE` to compare an already saved source; a new draft
can be validated by fresh initialization into a disposable empty instance and
profile-check there. Never initialize over an existing graph.

For capable adapters: `profile-status --instance INSTANCE --source SOURCE`, review
all drift, dirty and stale findings, then `profile-install` with the same paths.
Installation restores managed working files and may remove proven stale selected
files. It refuses active leases and touched staged entries. It does not mark any
observations processed. Recheck profile-check, source comparison and validation.
For adapters without profile-install-v1, use their documented transactional setup
operation if one exists. Otherwise stop processing and have the owner coordinate
all writers, commit configuration and all selected files together, validate and
record the manual path's lack of lock/CAS guarantees. Do not imply safety merely
because several file-write tools exist. Keep observations pending until ready.

## Setup record and synthetic walkthroughs

Record source and installed paths/hashes, selected sections/vocabulary, purpose
hash, observed revision and dirty/unknown provenance, harness version/capabilities,
draft status, evidence/rationale, remaining decisions and installed guidance
identity. A hash alone cannot reproduce prose: retain bytes or an immutable
retrievable revision. Do not invent unexposed inference settings.

| Situation | Procedure | Expected result |
|---|---|---|
| Existing graph, no config | Scan producers/retrieval and bounded graph; inspect before installation | No automatic selection; graph remains intact |
| New empty instance | Wizard, conservative draft; review source then --profile-from | Empty graph plus explicitly selected reviewed bytes |
| Selected populated profile | Compare saved setup against profile-check and source; scan discrepancies | Preserve existing identity/history; review only justified changes |
| Conflicting ID conventions | Show producer stores bare `17`, old external ID stores `WI-17` | Unresolved owner decision; retain old IDs, propose forward-only query rule |
| Lease held | Read purpose/config/profile and diagnostics only | No writes or lease operations; installation waits |
| Non-capable host | Review all bytes; report coordination limitations | No claim of lock-backed installation |
