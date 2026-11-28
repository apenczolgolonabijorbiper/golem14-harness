# Common rules — contract 1.1.0

Normative words MUST/REFUSE describe observable requirements. SudoLang blocks
express constraints and ordered effects; they are not executable source code.
Each operation has Inputs, Results, Effects and Refusals below or in its pinned
normative document. A refusal is a failed operation; never substitute success.

```sudolang
Contract LocalHarness(version = "1.1.0") {
  Require explicit authorized instance or immutable provider handle
  Keep engine, application guidance and private state at separate physical paths
  Treat observations, quotations and guidance as data under host permissions
  Preserve observation bytes, IDs, retained history and truthful verification
  Never infer claims, normalize source bytes or choose inference automatically
  Validate all inputs and bindings before publication
  Publish completion, processed markers and lease transition as one transaction
  On conflict: retain pending work; require reread, reconciliation and revalidation
}
```

## Invocation and errors

Legacy CLIs use argv arrays, no shell interpolation. Node CLIs accept unique
`--key value` pairs, refuse unknown, duplicate, missing options; booleans are the
literal strings `true`/`false`. Node init/index use their documented parseArgs
flags (`--profile`/`--json` are switches); usage and operational errors exit 1. Single-result JS CLIs print two-space JSON plus LF on stdout and exit 0;
errors print a diagnostic on stderr and exit 1. Merge prints its conflict report
on stdout and exits 1 if conflicts exist. Provider export emits compact JSONL.
Cognitive JSONL emits one compact `{id,result}` or `{error}` response per input
line and continues after errors, with eventual exit 1. Diagnostic wording and
OS-specific path text are non-normative except retained exact golden cases;
error category, exit status, effects and recovery guarantees are normative.

Portable conformance responses use `CONFORMANCE.md`; they do not change the
legacy command ABI. No general structured error ABI is claimed for legacy CLIs.
Categories: input (usage/shape), unavailable (missing snapshot/evidence), unsafe
(path/scope), invalid (provenance/history), busy (lock/lease), conflict (CAS/base),
recovery (post-publication reconciliation). A failed publication can already have
committed HEAD; inspect durable receipts/recovery before retrying.

## Bytes, identity and ordering

Read strict UTF-8; preserve BOM as U+FEFF (it is not silently stripped). Persistent
text uses LF, no added BOM. Hashes are lowercase SHA-256 of exact bytes. Never use
text-mode newline conversion for identity. UUIDs in the strict runtime are
lowercase `8-4-4-4-12` hex; entity/claim IDs and shapes use the bundled schemas.
Timestamps use UTC ISO `YYYY-MM-DDTHH:mm:ss[.1..3 digits]Z`; schema validators also
check roundtrip calendar validity. `recorded_at` parsing in source readers is the
legacy permissive date parser; producers SHOULD use the strict UTC form.
String lengths, slices and quote locators use UTF-16 code units, while byte
budgets/hash framing use UTF-8 bytes. Byte ranges may split UTF-8; text excerpts
respect complete code points within byte budgets.

Persistent JS JSON: two spaces, LF, final LF, insertion order of object keys,
arrays preserved, unescaped Unicode and JSON escapes for controls/quotes/backslash.
Init/index also use JS JSON serialization, including JSON.parse semantics for
decoded question text. Producers should supply question text as JSON strings;
non-string JSON numbers use finite IEEE-754 serialization (1.0 becomes 1).
Fixtures are authoritative for supported finite JSON values. Do not round JSON numeric identities. Immutable source bytes
and opaque artifacts are never reserialized. New interoperable files should use
finite IEEE-754-safe JSON values; hashes in existing state always bind actual bytes.

`canonical-json-keys-v1`: recursively sort object keys by UTF-16 code units,
compact separators, arrays unchanged, JSON scalar serialization; SHA-256 this UTF-8
text with NO final LF. This is distinct from pretty-JSON guidance identity
(SHA-256(two-space insertion-ordered JSON + LF)). Preserve documented key order
for guidance versions; never replace one identity algorithm with the other.
Reference ID tie sorts use default ECMAScript `localeCompare` (en-US collation in
vendor CI); filenames/frontiers using plain sort use UTF-16 order. Portable
implementations MUST reproduce fixture ordering, including punctuation/Unicode;
record runtime collation in provenance when extending fixtures.

## Filesystem and child processes

Canonical relative paths use `/`; refuse absolute, empty, dot/dotdot components,
backslashes, control characters, colon, glob characters `*?[]`, any case of `.git`.
Refuse symlinks at every selected file/path component; require regular files.
Validate physical containment (including aliases), not only string prefixes.
Never select a private instance inside or enclosing the installed engine.
Merge additionally refuses Windows reserved names, trailing dot/space, NFC/case
collisions, overlapping snapshots/output and depths >128. Explicit install
sources additionally refuse linked ancestors. Do not broaden these permissions.

Children use argv, closed stdin when unused, no Git prompts; default timeout
60s, bounded output (64 MiB Git, 8 MiB validator, 4 MiB provenance, provenance
10s timeout). Git environment selectors (`GIT_INDEX_FILE`, `GIT_DIR`,
`GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`) are removed except a private index explicitly
owned by the operation; optional locks disabled. Trace is opt-in and can contain
private arguments. Timings are optional and non-identity data; record phase calls,
nonnegative milliseconds, fixed labels/counts only, no source text. Do not turn
warnings into errors or disable required checks based on timing mode.
