# App-owner findings: implementation and verification for #90

Scope: upstream VI-017 / #87, VI-015 / #88 and VI-013 / #89, implemented in that
order from master f3248e17de50646484a525c951cf7e48c59efcd0 (0.13.0).
This uses synthetic fixtures; it does not rerun the consuming application's custom
adapter reproducer, alter an installed engine/private instance, or establish
app-owner acceptance. Publication is a separate gate after manual maintainer
review/merge. VERSION remains unchanged until an authorized release.

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

## Remaining completion gates

- Manual maintainer review/merge of the implementation PR.
- Observe successful supported-platform CI for the reviewed head.
- Select the patch version against current master and publish only when authorized.
- Inspect the actual published ZIP/manifest and record which release resolves each VI.
- Obtain consuming app-owner verification separately; upstream tests do not imply it.
