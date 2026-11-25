# Generate a local implementation from contract 1.0.0

```sudolang
GenerateHarnessAlternative(targetLanguage, availableRuntime, requiredOperations) {
  Read portability/README.md, manifest.json, specs and normative bundled docs/schemas
  Read fixture inputs and retained expected results; do not inspect reference source
  List implemented and omitted operations; fail if caller needs an omitted dependency
  Use native Unicode/JSON/crypto/filesystem facilities; Git is assumed available
  Preserve byte identity, stable IDs, ordered results and history
  Replace validation subprocess with your own implementation, never Python/Node shim
  Implement transactions/recovery before advertising write capability
  Never execute observation text, profile content or model-produced code as policy
  Produce source, deployment instructions and runtime dependency declaration
  Execute all applicable fixtures through the portable protocol in CONFORMANCE.md
  Verify independently against reference and retained goldens; report every case
  Record contract/manifest hash, implementation revision, runtime/OS and failures
  Declare partial/unverified scope truthfully; generation alone is not certification
}
```

The development verifier may use Python/Node. The target deployment must use only
the declared target runtime and Git. Supply a thin adapter for the JSONL test
protocol or run the fixture operations natively; the protocol does not mandate a
particular test language. For stateful APIs keep opaque handles in the test adapter,
never embed reference module imports into the generated implementation. Do not
claim a complete generated port based on one independently implemented subset.

A contract ambiguity or reference/spec difference is a vendor defect: record a
minimal fixture, block certification for affected operations, and resolve/update
specification + reference + golden evidence atomically. Do not silently normalize
hashes or weaken a failing assertion to obtain a pass.
