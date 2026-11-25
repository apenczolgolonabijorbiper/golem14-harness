# Portable invocation and comparison protocol v1

`fixtures/cases.json` is data, not executable fixture code. Each case names an
operation, supplies JSON input, and retains an expected JSON value or expected
error substring. Cases that use directories receive a private copy of
`fixtures/instance` and the explicit setup actions in that case. Input file bytes
are UTF-8 text or base64; never normalize their newlines. No private user data.

An implementation-under-test adapter reads compact JSONL:
`{"protocol_version":1,"id":"case-id","operation":"context","input":{...}}`
and returns exactly one line:
`{"id":"case-id","result":...}` or `{"id":"case-id","error":"diagnostic"}`.
JSON values compare recursively ignoring object key order, preserving array order
and scalar types. Expected errors require failure with matching diagnostic
substring for this corpus; legacy stderr text outside cases may vary. File-byte
assertions compare base64 or SHA-256, not parsed JSON. No blanket sorting/removal
of fields. The directory fixture adapter is trusted test setup, not production API.

Run reference + goldens with `node tools/portability/conformance.mjs`. Run another
adapter with `--command '["target-runtime","/absolute/adapter"]'` (JSON argv,
no shell). The verifier independently checks each adapter output against retained
results AND the reference. A third-party runner can implement the same comparison
using just JSON, files and subprocesses; no Python/Node is required on its target.

## Stateful and fault scenarios

`fixtures/scenarios.json` lists ordered steps, initial state, mandatory invariants,
fault points and expected observations. The reference scenario runner is
`node --test tools/portability/scenarios.test.mjs`; the release also runs the
bundled adapter/provider/indexer suites named in manifest.json. These cover
operations requiring a filesystem, clock, lock, opaque handles or transaction
fault seam; they must not be represented as skipped passing JSONL cases.

To test an alternative: copy the same fixture to a new private directory, replace
invocations with that implementation's commands, control the clock at the named
boundary (or use old/future timestamps), inject faults at the documented semantic
point. Never inject a failure by importing a reference implementation. Compare
all stated invariants, exact source bytes, golden outputs, durable state and
returned errors. concurrency requires synchronized contenders at the same lock,
not two sequential requests; crash recovery requires a committed CAS followed by
lost response/local reconciliation, not merely throwing before publication.
Index contention/recovery: hold OS lock, start second process => busy/no evidence;
kill owner => new process succeeds; preserve lock inode; orphan temp cleaned only
by next owner. These are local-filesystem guarantees, not remote coordination.

Consumer verification reports use schemas/implementation.schema.json, include
case IDs/result digests, stateful scenario IDs, tested platform/runtime, source
revision, contract version and exact manifest hash. `unverified` and `partial`
are valid statuses, not vendor certification. Every required operation needs its
cases AND applicable stateful/fault scenarios before full conformance is claimed.
Performance duration values, wall clock stamps, Git commit hashes, temporary
absolute paths and UUIDs may differ only at explicitly dynamic scenario fields;
compare their relationships (same run, exact source hash, valid time, correct CAS)
instead. Immutable input hashes, quote positions, candidate seals and files must
never be excluded as "dynamic".

## Independent statistics example

`examples/stats.pl` implements only the statistics operation from this contract,
using Perl and its core JSON::PP. Reproduce the independent comparison:

```
node tools/portability/conformance.mjs --command '["perl","portability/examples/stats.pl"]' --operations stats
```

The development verifier runs off-target. The example itself imports no reference
source and needs no Python/Node. The three retained cases cover empty memory,
completed memory, pending input, relation/history counts and timeline growth. This
is evidence for the statistics subset; it makes no portability claim about writes,
retrieval or complete alternative deployments. Linux CI runs it independently of
the Node-only goldens; other target languages can implement the same protocol.
