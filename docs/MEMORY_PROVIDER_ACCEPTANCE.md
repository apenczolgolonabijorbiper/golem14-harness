# Memory provider Phase A acceptance evidence

Implementation for tracker #69 and #70–#72. No release, deployment, instance
upgrade or migration is asserted. Evidence uses synthetic records only.

## Observed local checks

Environment: Linux x86_64, Node v24.22.3, Python 3.12.14, Git reference backend.

| Check | Observed result |
|---|---|
| Initial full Node regression + new provider suite | 174/174 passed (before final additional conformance cases) |
| Extended provider suite | 49/49 passed |
| Final packaged builder / installer checks | Passed: 182/182 packaged Node tests, Python validation/portability and both installer suites |
| Explorer / CI scope / Markdown rendering | Passed: 5 explorer checks, 4 routing checks, offline Markdown/table/Mermaid/sanitization tests |
| Windows / macOS package checks | Passed in [platform run 45351338804](https://github.com/apenczolgolonabijorbiper/golem14-harness/actions/runs/45351338804) at merged source `00aba14b49641c3deb9d17d7cc327f6f8578f503`; release commit validation remains separately observable |
| Actual LLM evaluation | Not performed by these deterministic tests; separate cognition evidence applies |

## Acceptance mapping

| Scope | Evidence / remaining gate |
|---|---|
| Public boundary, state inventory, independent versions, errors, snapshots, concurrency, transfer prerequisites (#70) | `MEMORY_PROVIDERS.md`, public module API and failing scaffold; executable independent implementation |
| Provider-aware reads, hypotheses/questions/history, source quotes, statistics, warnings, semantic writer/merge and full cycle (#71) | `provider-suite.mjs`, `provider.test.mjs`; unchanged JSON oracle comparisons; standalone public claim/apply path; existing regressions |
| Exact publication, source/policy/base/lease fences, seals and recovery (#70–#72) | Same shared suite against JSON/Git and independent record host; pre/post-commit interruption and fresh-host recovery tests |
| No graph/file/Git dependency for the neutral core (#69/#71/#72) | Independent record host refuses ordinary whole-store reads; static boundary test; provider-backed cognition view test |
| Preservation and portable import/export (#69/#70/#72) | Two-snapshot transfer retains source hashes/bytes, stable IDs, claim history, pinned guidance/artifacts and durable receipt/verification pointers; JSON → record → JSON fixture; corruption/truncation abort tests |
| Supported platforms and packaging (#69/#71/#72) | Local builder passed; merged-source Windows/macOS/Linux platform and capacity jobs passed in run 45351338804 |

Reference JSON remains subject to full-file costs, current graph schema limits
and the 64 MiB reference Git child-output envelope. Normal broad queries,
statistics, warning audits and candidate validation may enumerate pages. This
implementation does not claim incremental validation or increased JSON capacity.

No named host package/service/layout, downstream issue/release, optional database
or migration workflow is an acceptance dependency. The independent record host
is a conformance fixture, not a production database. The JSON transfer receiver
requires original JSON guidance/configuration artifacts and an explicit atomic
host archive sink; it does not invent a host's cutover workflow.

The retained local build transcript is `validation/memory-providers-linux-2026-11-24.log`.
The standalone conformance case also exercises the claim/apply/recover launcher.
