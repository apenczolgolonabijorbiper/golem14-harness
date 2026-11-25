# App-owner findings: implementation and verification for #90

Scope: upstream VI-017 / #87, VI-015 / #88 and VI-013 / #89, implemented in that
order from master f3248e17de50646484a525c951cf7e48c59efcd0 (0.13.0).
This uses synthetic fixtures; it does not rerun the consuming application's custom
adapter reproducer, alter an installed engine/private instance, or establish
app-owner acceptance. PR #91 was merged on 2026-11-25. The authorized 0.13.1
release finalization is tracked by #87; actual published-package verification
remains a separate gate from implementation and CI.

## Implementation

| Finding | Change | Regression evidence |
|---|---|---|
| VI-017 | Persistent instance OS lock; prompt busy refusal; same-directory temporary + fsync/close/atomic replace; orphan cleanup under lock; raw source-byte hash; no cognition-lease changes | `processor/test-indexer.py`: 100-note synchronized publisher, competing process before/after first publication, live reader, byte-identical single-run baseline, no-op retry, existing evidence preservation, pre-publication failure and killed-owner recovery; full valid fixture checked by memory-tool |
| VI-015 | One host completion-row writer, with separate reference CLI/direct staged/provider responsibilities; duplicate-row error separated from status/path/hash/missing-source errors | `server/claim-validation.test.mjs`, adapter and provider conformance: manual/reserved-state refusal preserves lease/HEAD/drafts; validate then commit creates exactly one row per source; logical duplicate IDs still fail explicitly |
| VI-013 | Canonical JSON layout and attribution guidance, provider physical-layout boundary, version-scoped historical material, regenerated explorer | `server/neutral-core.test.mjs`: historical paths, coexisting `speaker_id` and classification aliases rejected; `tools/test-doc-contracts.py`: known stale promises blocked, marked history/explicit unsupported statements allowed, embedded Markdown equals source |

The indexer guarantee is local participating processes on supported local
filesystems. Separate clones/machines, network filesystems, nonparticipating
writers and hardware power-loss durability are outside it. Per-file atomic evidence
visibility does not imply whole-instance/cognition transaction completion.

## Independently executed checks

Linux, Python 3.12.14, Node 24.22.3, 2026-11-25. Implementation checks retained in
[app-owner-plan-90-linux.log](../validation/app-owner-plan-90-linux.log).

| Check | Observed result |
|---|---|
| Targeted JSON, reference adapter and provider regressions | 76 Node tests passed |
| Targeted canonical layout/attribution regressions | 11 Node tests passed |
| Required release builder from staged distribution | 187 Node tests passed; all 11 Python unittest cases passed; Cursor and Codex installer suites passed |
| Explorer generation/persistence tests | 5 passed |
| CI routing tests | 4 passed |
| Unpublished local ZIP extraction and inspection | ZIP integrity and all 131 packaged file hashes passed; no extra ZIP entries; regenerated embedded docs agree with packaged sources |

The build is an unpublished validation artifact carrying the current VERSION,
not a replacement for the published 0.13.0 release. Final artifact hashes and
supported-platform CI results belong in the implementation PR/check runs. The
builder now runs indexer and documentation consistency tests from the staged
package on Linux, Windows (Python 3.12 and 3.14) and macOS through existing CI.
These platform runs must actually pass before claiming platform acceptance.

The existing implementation branch was resumed in a fresh Work session and the
full 187-test package build independently rerun. The retained log above is from
that rerun. The explorer CI job now also runs the documentation-contract check
after regeneration, so a documentation-only PR cannot reintroduce the known stale
promises while bypassing platform validation. The final generated page and package
hashes are recorded with the implementation PR.

## SudoLang / portable-script parity (#74–#77)

No portable indexer/validator script specifications have shipped at this base;
the only shipped `.sudo.md` prompt is the separate cognitive-task contract.
These fixes do not change that task/result protocol. The future specifications
must include, in the same release as their executable counterparts:

- Instance-scoped local exclusion, prompt busy failure, OS-owned crash recovery,
  persistent lock identity, reserved orphan cleanup and atomic evidence visibility.
- Exact source-byte hashing and preservation of existing finalized evidence.
- Exactly one host completion-row writer, direct validation requiring a complete
  candidate, explicit duplicate diagnostics and unchanged source-integrity failures.
- Canonical-only JSON reference layout/claim names; provider-neutral logical
  semantics; explicitly scoped superseded release material.

Do not replace Git or require MCP, a distributed service or a named application.
No schema migration or backward compatibility was added.

## Release finalization (2026-11-25)

Implementation PR [#91](https://github.com/apenczolgolonabijorbiper/golem14-harness/pull/91)
was merged as `a1aae8e1f9c6153db5c781281debb19c9f17e75f`.
[Post-merge platform validation](https://github.com/apenczolgolonabijorbiper/golem14-harness/actions/runs/45527137859)
passed Linux, macOS, Windows Python 3.12/3.14, capacity, explorer and routing checks.
The earlier [release run](https://github.com/apenczolgolonabijorbiper/golem14-harness/actions/runs/45527137977)
built successfully but skipped publication because VERSION was still 0.13.0 and
that release already existed. PR #91's title/body claimed preparation of 0.13.1;
its actual diff did not include a VERSION update.

The finalization sets VERSION to 0.13.1, dates the release notes, regenerates the
shipped explorer and reruns the required release builder. It changes no runtime
code. Release 0.13.1 delivers VI-017 (#87), VI-015 (#88) and VI-013 (#89) together.
The finalization PR records local package checks and supported-platform CI;
issue #87 and parent #90 record the actual published ZIP checksum, manifest hash
verification, packaged regression results and final release link after publication.
Those publication checks must pass before upstream closure.

Local release finalization on Linux (Python 3.12.14, Node 24.22.3) passed the
staged builder: 187 Node tests, 11 Python unittest cases and both installer suites.
The regenerated local 0.13.1 ZIP passed integrity, all 131 manifest file hashes
and an exact archive-entry check. The build log is retained in
[release-0.13.1-linux.log](../validation/release-0.13.1-linux.log).
The repository-only explorer generation/persistence (5) and CI routing (4)
tests also passed. The release workflow regenerates and persists the explorer
from the merged release sources before publication.

Consuming app-owner verification is separate from upstream completion; synthetic
tests and publication do not claim it. Portable-script parity remains recorded
above for #74–#77; no affected portable script specifications have shipped.
