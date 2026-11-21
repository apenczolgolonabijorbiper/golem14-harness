# Reviewed application-owned source bundles

A source contains golem.config.json and every explicitly referenced core, section
and vocabulary file, plus optional purpose.md. The shared Node reader validates
all selectors, captures exact bytes once and exposes resolved paths/hashes and
local revision/dirty provenance (null means unknown). No network reads occur.
Ordinary runtime analysis continues reading installed instance bytes.

Install targets are deliberately narrower than the profile loader's read contract:
core/section/vocabulary must live under profiles/ or guidance/. Reject linked
sources/ancestors, path escapes, duplicate or overlapping roles and protocol data
collisions. The purpose.md alias maps only to canonical instance/purpose.md. Omission
preserves purpose; explicit missing purpose fails; it never means delete.

```sh
python3 processor/init-instance.py --root ../fresh --profile-from ../app/golem-guidance --node node --json
python3 processor/init-instance.py --root ../purpose-only --purpose-from ../app/purpose.md
```

Python 3.12+ and Node 22.12+ are required for source validation. --node is a single
executable argv element. --profile conflicts with --profile-from. Bundle purpose
conflicts with --purpose-from. Without purpose input the initializer retains its
stub. --json returns destination and metadata from the captured installed bytes.
Validation finishes before staging/publication; absent/empty destinations remain
absent/empty on validation failure. Nonempty instances are never reset. Use canonical
paths without linked ancestors (including canonical temporary paths on macOS).

The public source-bundle.mjs helper returns base64 bytes and metadata to host tools;
compareSource reports per-file sync/missing/differs and separate stale selected
paths, without deleting them. Source revision is provenance, not content identity.
No setup document, graph, lease, ledger or existing instance is modified by reading
a source. Preserve reviewed application sources separately from private runtime data.
