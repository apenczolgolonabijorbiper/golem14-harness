# Local core portability contract 1.1.0

This directory is the vendor-maintained specification for deterministic local
Harness operations. Read `manifest.json`, `specs/COMMON.sudo.md` and the selected
operation's spec, its normative documents and schemas, then its fixture cases.
All those inputs ship in the release; reading Python or JavaScript is unnecessary.
The manifest pins reference files by SHA-256, not by a moving branch name.

The reference implementation remains supported. A generated implementation may
use any already-available language/runtime, plus Git for the reference Git
binding. It must not invoke Python/Node as a hidden dependency. Git itself is
assumed; implementing Git, SQLite, MCP, remote/distributed workers, model dispatch,
installers, development and release tooling is outside this contract. Local
provider APIs and cognitive validation/session bookkeeping ARE included; inference
and semantic interpretation remain agent responsibilities.

## Contract package

| File | Purpose |
|---|---|
| `manifest.json` | Complete script/operation/spec/vector traceability and pinned reference hashes |
| `specs/*.sudo.md` | Normative behavioral rules, not source-language translations |
| `schemas/*.json` and `../schemas/*.json` | Normative interchange shapes (semantic rules also apply) |
| `fixtures/cases.json` | Portable, synthetic inputs and retained expected results |
| `fixtures/instance/` | Byte-preserved initialized/completed instance input |
| `CONFORMANCE.md` | Runner-independent comparison protocol, fault and concurrency procedures |
| `GENERATE.sudo.md` | Agent generation and independent verification instructions |
| `evidence/parity.json` | Versioned change-impact decisions, including no-impact review requirements |

Version policy: contract MAJOR changes accepted input, identity, ordering,
publication/error guarantees or persisted formats incompatibly; MINOR adds an
optional capability/operation without changing existing behavior; PATCH clarifies
rules or corrects fixtures without changing behavior. Harness VERSION and contract
version are independent. Consumer declarations list exact contract version,
manifest SHA-256, operations/capabilities, implementation language/runtime,
implementation revision and per-case results. Generated implementations are not
automatically vendor-certified. Partial coverage must be declared explicitly and
must never advertise the full contract.

## Same-release maintenance

Every core PR must assess this contract. Update reference hashes, affected specs,
fixtures, manifest and impact evidence in the SAME PR. A source-only refactor needs
a written no-impact rationale and named reviewer in `evidence/parity.json`, bound
to the new hashes; the maintainer must actually review that decision. CI cannot
infer semantic correctness or authenticate a reviewer typed in JSON. The PR
checklist and normal code review remain mandatory. Do not claim automated hashing
is semantic certification. Unresolved impact blocks release; split work if needed.

`python tools/portability/check-parity.py` rejects missing/unclassified core files,
missing operation cases, changed normative dependencies and stale hashes. On PRs,
`--base REF` additionally checks change-impact evidence against the base manifest.
`node tools/portability/conformance.mjs` checks retained goldens without rewriting
them. The release builder runs both from the source/staged package and records
contract identity and successful conformance in RELEASE.json. No published ZIP is
created when these checks fail.
