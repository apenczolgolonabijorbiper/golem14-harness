# Domain-memory enhancement series (unreleased)

This series implements VP-001 through VP-006. It does not initialize, migrate or
replace any existing instance automatically. The release decision/version/tag is
separate from implementation review; VERSION remains the last released version
until the maintainer prepares the next release (provisionally 0.5.0).

- Existing graphs validate without rewriting. Optional entity kind can be added
  once and then is immutable under previous-graph validation. Leave uncertain
  kinds unset. Old 0.4.1 code rejects graphs containing kind: rollback/mixed writers
  need a reviewed compatible plan, not silent field deletion or history rewriting.
- Unselected profiles leave processing unchanged. Explicit selections use
  golem.config.json and instance-relative trusted files. Reconcile host setup
  records and selected revisions before enabling processing. Stray files do not
  activate guidance. Plain Markdown and .sudo.md are both supported.
- Retrieval without new options retains legacy selection/history/shape. New filters
  and explicit --hops opt into the documented result metadata. All limits use positive
  integer input; invalid options now fail clearly instead of being ignored.
- Successful validation adds advisory warnings; validateMemory still returns the
  original error array. Integrity errors remain blocking. Missing-refutation checks,
  executable hooks, grouping and strict mode are deferred.
- Adapter contract version 1 and profile-guidance-v1 are optional capabilities.
  The bundled reference requires a dedicated local instance Git root and attached
  branch. It cannot run directly on connector-only remote storage or an instance
  subdirectory in an application repository. Other hosts implement the same protocol
  through an application-owned backend. Existing compatible adapters remain usable.
- Reference candidates are isolated for validation/publication; agent drafts remain
  in-place and visible to local readers. Read committed snapshots for consistency.
  Observe the recovery procedure after interruption; do not reset entire worktrees.
- Run the full release builder to regenerate packaging hashes and test the extracted
  package. Upgrade by replacing the verified engine as documented in README; preserve
  the external instance and validate it before resuming. No initializer on upgrade.

All reusable functionality is application-agnostic. Domain rules and vocabularies
belong to selected external profiles; synthetic fixtures do not prescribe a product.
