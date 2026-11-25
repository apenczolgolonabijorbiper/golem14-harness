# Merging completed candidate snapshots

Use this helper when independent processors built completed candidates from the
same base, and the owner head moved before publication. All three snapshots must
use the current canonical formats (graph v2, hypotheses v1). No migration or
historical-layout resolution is provided. This is a mechanical record merge;
it does not infer identities, resolve semantic disagreements or publish results.

```sh
node processor/memory-tool.mjs merge --base BASE --ours OURS --theirs THEIRS --out OUT
```

BASE is the common snapshot, OURS is the fresh owner head and THEIRS is the
completed external candidate. Each directory must contain the complete instance,
including exact inbox/evidence bytes, ledger, hypotheses, queues and summaries.
OUT must be absent, have an existing parent and be outside the engine and all
three inputs. Existing directories, even empty ones, are refused. Inputs must
also be separate from the engine. Symlink paths and non-regular files are refused;
root .git metadata is ignored. Snapshot limits are 64 MiB, 50,000 entries and 128
path components per input. File names must be portable (no Windows reserved names,
trailing dots/spaces, or case/normalization/file-directory collisions).

The host authenticates the external processor, checks same release and common
base ancestry, and captures coherent immutable snapshots. `base_checked_by: host`
is a responsibility declaration, not proof that those checks were performed.
The helper rechecks captured input bytes before writing to catch accidental
mutation, but cannot provide an atomic snapshot of a live directory.

For provider-based processing, use `rebaseChanges` and semantic changes as
defined in [MEMORY_PROVIDERS.md](MEMORY_PROVIDERS.md). The directory/graph
merge interface in this document is confined to the JSON reference backend.

## Merge rules

| State | Result |
|---|---|
| New record on one side | Take it |
| Base record changed on one side | Take the changed record |
| Identical record changes on both sides | Take one copy |
| Divergent concurrent record changes | Conflict naming file and ID |
| Base record removed on either side | Conflict |
| Base processed row | Keep unchanged; inherited overlap is expected |
| New processed ID on both sides | `source_processed_twice`, even identical rows |
| Changed base processed row | `ledger_history_changed` |

Graph sources/entities/claims, questions and hypotheses are keyed by ID; no
field-level merge occurs within a record. JSON object key order is immaterial,
array order is retained. Existing records retain base order, followed by new ours
then new theirs records. Collection `updated_at` takes the later timestamp.
Retained graph records must still pass the normal history rules. Both branches
are checked against BASE, and the combined graph against OURS; standalone input
and combined structure, source provenance and hypothesis checks also run.

Existing inbox, evidence, events and run files cannot change or disappear. New
files are preserved byte-for-byte; conflicting bytes at a shared path refuse.
New journals at the same run path conflict even if identical. Other auxiliary
files use byte-level three-way comparison; removals and divergent edits refuse.
Purpose and selected configuration/profile/section/vocabulary files must remain
identical to BASE, so results processed under different guidance cannot mix.

Same-type entities added under different IDs on both branches with normalized
matching labels yield `possible_duplicate_entity`. Both entities remain distinct;
labels alone never authorize identity reconciliation. Label normalization uses
NFKC, trimmed/collapsed whitespace and lowercase. Reports bound both warnings and
conflicts to 1,000 entries, with total/returned/truncated metadata.

## Review and publication

Success prints a JSON report with `merged` counts, `conflicts`,
`needs_regeneration`, `warnings`, `requires_review`, `validation` and
`base_checked_by`. Conflicts exit 1 without creating OUT. File/validation/path
refusals are also JSON conflicts. Malformed CLI options exit 1 on stderr.

When both branches changed `memory/index.md` or `questions/queue.md`, keep OURS and
flag regeneration. Combining independently changed graphs also flags the memory
index. A readable queue that omits combined JSON questions flags queue Markdown.
**Output with `requires_review: true` is a review draft.** Structural/history
checks do not certify its summaries. Have the host's agent regenerate every
flagged file under the owning publication lease, then run:

```sh
node processor/memory-tool.mjs validate --root OUT --previous OURS/memory/graph.json
```

Even a draft that passes this validator still requires the flagged index/summary
review. The helper copies no `memory/processing-lock.json` and never reads,
acquires, renews or releases leases. The host stages the correct released lease,
checks current ownership, fresh ledger and exact source bytes, and atomically
publishes the complete validated candidate using compare-and-swap against the
verified fresh head. A further head change requires another merge/revalidation.
Never publish the helper's output as a live instance while it is being written.
Construction starts only after semantic/path preflight; writes are exclusive and
ordinary I/O failures remove the newly created output. A process/OS crash can
leave an incomplete private OUT; discard it before retrying with a fresh path.
The helper is not an atomic storage commit.

The six-command adapter contract is unchanged. The reference Git adapter still
completes only its own claimed sources and does not import external completion
rows through `commit`. A host backend must implement that publication operation
with the checks above. No `candidate-merge-v1` adapter capability is advertised.
Cross-instance selective processed-memory transfer uses the separate
[validated bundle/import contract](PROCESSED_TRANSFER.md).

## Host-owned reservations

A host may reserve pending sources for an external processor for a bounded time.
Select at most 20 oldest **eligible unreserved** sources, retaining the existing
age/eligibility rules and deterministic oldest-first order. The host owns durable
reservation storage, authenticated ownership, expiry, renewal and selection.
Reservations are coordination hints, not memory protocol or lease files. Expired
reservations become eligible again. An ignored or expired reservation may waste
analysis; it must not bypass fresh ledger/source checks, publication lease
ownership or CAS. Those checks, not reservations, prevent double completion.

The current reference `claim` CLI has no reservation exclusion option and retains
its existing oldest-first behavior. Hosts needing exclusions must implement
selection in their backend, or serialize work; do not pretend a host reservation
is understood by that CLI. No new reservation service or remote backend ships.
