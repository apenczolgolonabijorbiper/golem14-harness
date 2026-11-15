# Golem XIV Harness maintainer instructions

This repository owns the reusable harness. Maintain application code, domain
instructions, and private instance data in the consuming application or its
private storage. Use synthetic observations for tests.

Run the release builder after changing the runtime, schema, docs, or integration
files. Update VERSION and release history for releases. Preserve observation
identity, claim history, and transactional storage requirements.

integration/AGENTS.distribution.md is packaged as AGENTS.md for downstream
consumers. Preserve its read-only engine boundary.
