# Golem XIV Harness 0.5.0

This release delivers VP-001 through VP-006 as application-agnostic capabilities.
The host agent still performs inference; the harness supplies deterministic memory
operations, validation, instructions and an optional transactional Git reference.

## Added

- Storage adapter contract v1, a fail-closed backend scaffold, a dependency-free
  local Git reference and CLI conformance tests. Lease ownership is based on
  committed state; completion validates and publishes the same tree using CAS.
  Recovery handles interruption after publication while preserving local drafts.
- Explicit instance profile configuration, Markdown/.sudo.md guidance, structured
  vocabulary and an optional non-overwriting initializer profile stub.
- Batch-scoped claim guidance with retained text, hashes, boundary and required
  journal identity. Later profile edits do not silently replace claimed guidance.
- Optional domain entity kinds, add-once history protection and lexical matching.
- Predicate/type/kind/status retrieval filters, endpoint closure, deterministic
  1–3-hop traversal, expansion budgets and separate exclusion/truncation reporting.
- Stable advisory warning codes for unused entities, possible duplicated
  corroboration and configured vocabulary mismatches. Integrity errors still fail.

## Compatibility and scope

Existing graphs work without rewriting. Unconfigured profiles and retrieval calls
without the new options retain the existing flow. A kind can be assigned once and
then cannot be changed/removed through ordinary writes. Old 0.4.1 validators reject
graphs containing kind, so review rollback/mixed-version writers before adopting it.
Invalid CLI options and non-positive/non-integer limits fail explicitly.

The reference adapter supports a dedicated local instance Git repository root on
an attached branch. It is not a distributed remote lock; remote connector storage
and instance subdirectories need another backend. Candidate validation is isolated,
but in-place agent drafts remain visible to filesystem readers. Abrupt OS termination
may require stale-lock inspection as documented in ADAPTERS.md.

Domain guidance stays in external selected profiles; no application data is shipped.
No model API client, scheduler, UI, graph database, semantic search or training is
introduced. Windows/macOS and live Desktop acceptance have not been verified for
the new adapter. Executable validation hooks, strict mode and grouping remain deferred.

## Upgrade

Obtain the versioned ZIP and adjacent SHA-256 file from this release. Verify the
checksum and RELEASE.json file manifest, replace the verified installed engine,
and preserve the external instance. Validate the existing state before processing.
Do not run the initializer against an existing instance. Read UPGRADE_0_5.md for
profile selection, kind permanence, reader compatibility and recovery details.

## Validation

The release builder runs 38 Node tests, four Python unittest cases and the existing
Cursor/Codex installer regression scripts. Coverage includes real CLI processing,
concurrent claims, expiry, source mutations, CAS conflicts, post-publication recovery,
scoped guidance, warnings, traversal and source bytes under line-ending attributes.
Implementation validation also exercised an extracted/installed synthetic cycle.
Tests use synthetic observations only. Publication and downloaded-asset verification
are recorded separately in tracking issue #7.
