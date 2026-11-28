# Node runtime standardization

From 0.16.0, installing and running the harness requires Node 22.12+.
Python remains repository maintainer tooling, not an installed runtime dependency.
Use `node integration/install-codex.mjs` or `install-cursor.mjs`, then
`node processor/init-instance.mjs --root PATH` and
`node processor/process.mjs --root PATH`. There are no legacy Python launchers. Decoded non-string numeric question text
now follows JavaScript number serialization; producers should use JSON strings
for question text. Existing evidence is never rewritten.

Node hosts can import `initialize` from `processor/init-instance.mjs` and require
`processor/index-core.cjs` for synchronous `index(root,{log})`. Verify the complete
release before loading code. Both CLI and embedded calls use the same core,
atomic evidence publication and process exclusion. Embedded indexing throws on
failure and returns the newly indexed count. `log` receives status lines and
may be suppressed by hosts that own their JSON output. Keep inference external.

The initializer still returns `{root,source}` with `--json`; source metadata,
canonical memory schemas and observation identity are preserved. Stop old Python
indexers before replacement: their OS locks do not participate in the Node lock
protocol. Memory is not reset. Use local filesystems with one OS identity/PID
namespace. PID reuse and inaccessible owners fail closed.

## Paired performance evidence

Run repository-only `node tools/benchmark-node-runtime.mjs OUTPUT.json` with
Python available for the retained baseline under `tools/legacy-python/`. These
baseline scripts and benchmark generator do not ship as runtime alternatives.
Seven alternating paired samples use identical synthetic inputs, real fsync and
exact byte comparisons; initialization and already-indexed runs are included.
See `validation/node-runtime-linux.json` for the full environment and samples.

On the observed Linux machine, embedded Node indexing took median 1.02 ms for 10
fresh observations versus 35.63 ms for the old Python subprocess, and 38.85 ms
for 1,000 versus 158.52 ms. Embedded initialization took 0.46 ms. These measure
the operation boundary used by an existing Node host, excluding host integrity
verification and other host work equally; they are not full-cycle speedups.

Standalone Node CLI startup costs more on this machine: a 10-source fresh run
was slower than the Python CLI; at 1,000 sources fresh CLI times were approximately
equal. Chelm should embed the core to avoid that extra startup. No universal
performance claim is made for other filesystems/OSes. Windows/macOS correctness
is checked by platform CI; performance evidence here is Linux only.
