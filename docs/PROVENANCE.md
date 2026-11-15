# Baseline provenance

Version 0.3.0 promotes the shipped 0.2.3 runtime to standalone source.
The reviewed upstream snapshot was pinned to commit `c8eea52141d2440d1fab5adbd41e7238f9ec4fbe`.
The original extraction verified allowlisted source hashes. Its adaptations were:

- Indexer requires explicit private instance --root.
- Synthetic core tests exclude instance HTTP endpoint.
- Generic agent protocol and docs replace private instance instructions.
- New non-overwriting instance initializer.
- Validator failure summary includes the first violation.
- Claim attribution accepts any existing entity type and identifies missing reference fields.

The 0.2.3 ZIP SHA-256 was `c03a55dbc4967a33fe028ab0f43df9a254fae3ad543efbebe234fc4e369ced23`.
The reviewed upstream snapshot had no root license. This repository includes
the Apache 2.0 license selected for the standalone project.
