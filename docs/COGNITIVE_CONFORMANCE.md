# Cognitive task vendor conformance

The packaged suite is host-neutral and uses synthetic evidence. Run:

```sh
node --test server/cognitive-task.test.mjs
python tools/build-release.py --output ../cognitive-test-release.zip
```

The independent record-based test host exercises the neutral session/validator
without a graph file, Git adapter, host service, transport or named-host package.
The reference Git tests separately verify committed reads, immutable source
binding, empty inboxes, read-only nonmutation and reviewed learning. Existing
memory-tool/platform suites still apply. Release building includes these tests
and the runtime contracts, schemas, prompts and synthetic cases.

## Actual inference recipe (separate from fixtures)

`cognition/conformance/cases.mjs` defines 18 cases and semantic rubrics: direct
recall, multi-source inference, plausible unsupported assertions, temporal
conflicts, identity ambiguity, pending intake, empty inbox, missing/truncated
sources, zero hits, repeated answers, changed premises, correction/retraction,
denied writeback, bounded follow-up, cancellation, budget and intent/branches.
Each case pins synthetic instance/snapshot/guidance identity, evidence, limits,
expected/forbidden behavior and acceptable uncertainty. These are acceptance
assets, not scripted model answers or a disposable pilot.

```sh
node tools/evaluate-cognition.mjs prepare ../cognitive-input.json
node tools/evaluate-cognition.mjs run ../cognitive-input.json ../model-results.json -- EXECUTOR ARGS
node tools/evaluate-cognition.mjs check ../cognitive-input.json ../model-results.json ../integrity-report.json
```

The external executor reads one JSON request from stdin and returns
`{results:[{case_id,result}],model:{requested,observed,configuration,cost}}` on
stdout. Its result envelopes follow the included schema. An adapter for a model
API/CLI may be supplied by any conforming host; credentials stay external. The
runner invokes an executable with explicit arguments, no shell. For a CLI writing
the final answer to a separate file, invoke it with the prepared JSON as input,
then pass the parsed final answer to `check`. Do not pass CLI log events as results.

For example, the vendor attempted Codex with read-only sandbox, ephemeral session,
no Git-repository requirement and output-last-message outside the repository.
The current environment failed before inference with a read-only runtime state
error. `cognition/conformance/vendor-evaluation.json` retains this known failure;
the exact attempted input is retained as `cognition/conformance/vendor-input.json`.
This is **not** a successful model evaluation.

Retain input/result bytes, hashes, engine commit/package hash (when built), tool
version, date, requested and actually observed model identity, configuration,
limits/usage, known cost and known failures. Unknown values remain null. The
prepared input includes the result schema and explicit guidance. The exact task
and evidence count as the evaluation input, not as new real user observations.

`check` checks deterministic result integrity and broad expected outcome/stop
rules. It intentionally leaves semantic verdicts `requires_review` and
`verified:false`. A reviewer must assess each case rubric: entailment, premise
independence, identity/time scope, explicit uncertainty, question usefulness,
permission limits and absence of fabricated evidence. Retain reviewer identity,
verdict/reason and limitations separately. Passing scripts or schema checks cannot
certify reasoning quality. Do not alter outputs to make a failed model run pass;
record and fix/retest actual failures.

## Delivery status

Protocol/runtime implementation and deterministic conformance are reviewable.
Vendor actual-model verification remains pending until a functioning external
executor completes the retained cases and semantic review. Platform CI must also
pass before release acceptance. No named host release or downstream runtime
upgrade is required to complete Harness verification. This implementation does
not claim issue #68's actual-model gate has passed.
