# Golem XIV Harness maintainer instructions

This repository owns the reusable harness. Maintain application code, domain
instructions, and private instance data in the consuming application or its
private storage. Use synthetic observations for tests.

Run the release builder after changing the runtime, schema, docs, or integration
files. Update VERSION and release history for releases. Preserve observation
identity, claim history, and transactional storage requirements.

integration/AGENTS.distribution.md is packaged as AGENTS.md for downstream
consumers. Preserve its read-only engine boundary.

Local core portability is a release contract (portability/README.md). Changes to
in-scope scripts, transitive modules or schemas must update corresponding SudoLang
specifications, fixtures, traceability and parity evidence in the same PR. For
implementation-only edits, record a reviewed no-impact rationale. Run
`python tools/portability/check-parity.py`, portable conformance and the release
builder; never publish known specification drift or silently defer coverage.
