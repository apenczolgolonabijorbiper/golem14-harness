# Instance purpose, hypotheses and source attribution

The core stores source-grounded domain memory. A persona is an optional application
profile, not a required entity, owner or organizing object. Profiles determine the
memory purpose and vocabulary; the host agent supplies interpretation.

## Neutral defaults and historical paths

| Role | New instance default | Historical fallback |
|---|---|---|
| Purpose, scope and language | instance/purpose.md | persona/identity.md |
| Explicit hypotheses | memory/hypotheses.json | persona/hypotheses.json |
| Selected profile example | profiles/default.md | Any explicitly configured safe instance-relative profile path, including persona/profile.md |

memory-tool validate reports layout.purpose_path and layout.hypotheses_path.
resolveLayout resolves each required role independently, so mixed layouts work.
It performs no writes. If both files for a role exist, even with equal content,
processing fails instead of maintaining two authorities. Missing files also fail.
Profiles are selected exclusively by golem.config.json, never by file discovery.

New initialization creates neutral paths. --legacy-layout creates historical role
paths for a NEW EMPTY destination when needed by a host still expecting them.
Neither initializer mode is an upgrade/migration operation. Existing instances
continue to validate and process using their original files; installing a release
never moves files or rewrites graphs, sources or claims.

To relocate an existing instance deliberately: pause processing, take a consistent
backup, move each selected file to its neutral path (preserving exact bytes),
remove the old path from the live layout, update host setup references, and commit
that relocation as a configuration change before resuming. If a profile is moved,
explicitly update its configured path; retained run guidance keeps its old identity.
Validate the whole instance before and after. Do not modify historical journals,
source files or claim fields. Resolve duplicate files manually before processing.
The reference adapter commits whichever hypotheses path the instance uses.

Purpose instructions define scope, language and review priorities. Hypotheses are
explicit propositions with support, refutation, confidence, model and updated_at;
they may concern any domain. The collection is empty when none are maintained.
Hypothesis semantics still require agent review; this change does not introduce an
automatic hypothesis engine or a new proof-of-truth validator.

## Neutral claim names

| Canonical name for new claims | Historical compatible name | Meaning |
|---|---|---|
| attributed_to_id | speaker_id | Existing entity to which a record/assertion is attributed: person, organization, system or account |
| source_assertion | user_declaration | Statement reported by a cited source; no independent confirmation implied |
| hypothesis | hypothesis | Explicit inference with uncertainty, support and potential refutation |
| corroborated | independently_confirmed | Claim judged supported by independent evidence, subject to semantic review |

At least one attribution field is required. If both appear on a new claim, they
must agree. Every attributed entity must satisfy the same reference/provenance
checks as subject and object entities. It is not necessarily a human author and
is not the process that happened to ingest the data. Retain uncertainty where
attribution is unclear rather than fabricating an author.

The reader accepts all aliases without rewriting them. Retrieval, endpoint closure
and advisory corroboration checks understand both forms. Previous-graph validation
protects exact retained claims: do not rename/add an alias field or reclassify an
old claim merely to adopt new terminology. New claims may use canonical names next
to unchanged historical claims. Keep corrections through new claims/supersedes.

Graph schema_version remains 1 with an extended vocabulary. Compatibility is
new-reader/old-data, not old-reader/new-data: 0.5.0 cannot validate canonical
attribution/classification fields or assume the new layout. If older writers/readers
must coexist, retain the historical layout and claim spellings until all have been
upgraded. Never silently drop new fields to make old validators pass.
