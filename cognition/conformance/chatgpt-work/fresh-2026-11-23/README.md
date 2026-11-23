# Fresh Work acceptance, 2026-11-23

All 18 cases passed integrity validation and the separate semantic review.

This Work conversation first read only `executor-request.json` pinned at
`db0a2bd07836478955ce74aa58bac583d63d81ff`. The assistant answered from the supplied
synthetic evidence and saved the original JSON before opening any other repository
content, scoring rubrics or previous results. The request was displayed in parts
because the initial connector output was truncated. Local serialization helpers
copied bindings, counters and exact citations from the request; the answers were
authored by the Work model, not a scripted executor or prewritten answer fixture.
No case used external tools, a named host, instance memory publication or an
observation-processing lease. Saving evaluation artifacts is outside the case's
read-only instance boundary.

The original response SHA-256 is
`13aba271e233e62e4cb1801045733334305a86997c0599c3202565901fc3191d`.
The retained request is byte-identical to the pinned repository file. Neither
request nor response was edited after scoring. These original bytes are retained
even if a later reviewer disagrees with a verdict.

`integrity-report.json` deliberately retains `verified:false` and
`requires_review`: scripts cannot judge semantic reasoning. `semantic-review.json`
records a distinct verdict and reason for each case, reviewed after preservation
by the same agent. It does not claim an independent human or model judge. See its
limitations, including inherited historical status summaries, unknown provider
model identifiers/cost/settings, and synthetic usage counters. There is no new
local Codex CLI inference attempt.

Reproduce the checks from the repository root, using an unused report filename:

```sh
node tools/evaluate-cognition.mjs check \
  cognition/conformance/chatgpt-work/fresh-2026-11-23/evaluator-input.json \
  cognition/conformance/chatgpt-work/fresh-2026-11-23/response.json \
  /tmp/fresh-work-integrity-report.json
python tools/build-release.py --output /tmp/fresh-work-package.zip
```

`run-metadata.json` records configuration, tool versions, scope and validation.
`SHA256SUMS` hashes the exact retained evidence files; hashes inside the evaluator
report instead bind parsed JSON serialized by JavaScript. `release-validation.log`
retains the package builder's checks. The temporary package is not a published
release; its SHA-256 is retained in metadata. These evidence files remain repository
review assets and do not add dependencies to a consuming application.

The existing implementation platform run
[45276239319](https://github.com/apenczolgolonabijorbiper/golem14-harness/actions/runs/45276239319)
passed all four package matrices: Linux/Python 3.12, macOS/Python 3.12, Windows/Python
3.12 and Windows/Python 3.14. Capacity checks also passed on Linux and Windows.
The evidence PR's own checks must pass before final issue acceptance is recorded.
