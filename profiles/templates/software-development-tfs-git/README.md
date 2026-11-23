# Software-development profile template

This pack is an inactive release asset. The harness selects guidance only from an
instance's explicit configuration. Copy this directory to an application-owned
location, such as `golem-guidance/`, and review that copy with the application
owner. Keep the installed engine read-only.

## Choose the producer contracts

| Confirm with the application owner | Apply in the reviewed copy |
| --- | --- |
| Tracker product, release, API version, organization or collection URL | Replace `REPLACE_TRACKER_SCOPE`. Scope target URLs before accepting their IDs. |
| Process types and any stable type-to-kind mapping | Adjust work-item rules for the actual producer. Keep mutable types in claims. |
| State, assignee and relation fields, plus how revisions establish validity | Record the exact field and relation reference names and limits. |
| Commit-message reference convention | Confirm or replace `WI-` in the core and vocabulary. Define when the target scope is known. |
| Repository identity, storage hash algorithm, path decoding and diff comparison | Replace `REPLACE_REPOSITORY_SCOPE` and `REPLACE_REPOSITORY_REGISTRY`. Choose stable keys independent of checkout paths. |
| Person IDs, their issuing scope and any cross-source identity evidence | Document the evidence required for reuse. Keep ambiguous labels separate. |
| Actual observation headers emitted by the host | Update the kind selectors and their fixtures together. |

Review all `REPLACE_…` markers before first use. A search for those markers is an
advisory check for this pack's convention. The harness does not enforce agreement
between prose and producer settings. Keep application purpose in a separate
optional `purpose.md`, with scope, language and review priorities.

## Install the reviewed copy

The source bundle contains `golem.config.json` and its explicit references to
`profiles/core.md`, the three source sections and `profiles/vocabulary.json`.
`fixtures/` and this README are evaluation material outside the managed files.
With Python 3.12+ and Node 22.12+, run from the installed harness directory with
paths adjusted to your application and disposable empty instance:

```sh
python3 processor/init-instance.py --root ../fresh --profile-from ../golem-guidance --node node
node processor/memory-tool.mjs profile-check --root ../fresh --source ../golem-guidance
node processor/memory-tool.mjs validate --root ../fresh
```

For an existing instance use the profile status/install procedure in
[SETUP.profile.md](../../../integration/SETUP.profile.md), including lease and
drift checks, and record installed hashes and source provenance. Review the
[profile contract](../../../docs/APPLICATION_PROFILES.md) before selection.
No online service is needed to load, inspect or validate the template.

## Product evidence reviewed on 2026-11-23

- **Azure DevOps Work Item Tracking REST API 7.1.** The Get Work Item response
  shows numeric item IDs and the `System.WorkItemType`, `System.State` and
  `System.AssignedTo` fields. Request relation expansion when needed. Relation
  metadata documents Child/Parent as Hierarchy-Forward/Reverse and
  Successor/Predecessor as Dependency-Forward/Reverse. Confirm enabled relations
  and process fields on the target. An identity object alone does not establish
  cross-system identity. [Get Work Item](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1) ·
  [Work Item Relation Types](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-relation-types/list?view=azure-devops-rest-7.1)
- **Server version limits.** Microsoft lists 7.1 for Azure DevOps Server 2022.1,
  7.0 for 2022, 6.0 for 2020 and 4.1 for TFS 2018 Update 3. The documented
  field and relation mappings here are based on the 7.1 reference. Server
  collection URLs, older API payloads, custom process fields and live Server/TFS
  compatibility remain unverified. Adapt those producers only after checking the
  matching API and real payload shape. [REST API and Server version mapping](https://learn.microsoft.com/en-us/rest/api/azure/devops/#api-and-tfs-version-mapping)
- **Git CLI manuals.** Use the storage format reported by
  `git rev-parse --show-object-format=storage` and emit a full `%H` from that
  format. The profile accepts storage-format SHA-1 (40 hex) and SHA-256 (64 hex
  where enabled). Abbreviations, unknown formats and compatibility translations
  are outside this mapping. Use author and committer placeholders separately.
  Choose explicit rename detection and a defined base for each merge comparison.
  With `--numstat -z`, preserve NUL-delimited path entries and read both paths
  for renames. Binary counts are unavailable. Leave a path unresolved if its
  exact value cannot fit the harness external-ID contract, including lossless
  UTF-8 decoding and the validator's length and surrounding whitespace limits.
  [Object format](https://git-scm.com/docs/git-init) · [Storage format](https://git-scm.com/docs/git-rev-parse) ·
  [Commit metadata](https://git-scm.com/docs/git-log) · [Diff formats](https://git-scm.com/docs/git-diff)

The fixtures model normalized observations from a hypothetical producer. Agree on
the actual format with the host and verify its emitted bytes. For example, the
human-readable rename arrow in the synthetic digest is presentation, while the
real producer should retain two separate path values. Commit hash length,
full-path text and relation direction do not authenticate the observation.

## Evaluate a host with synthetic fixtures

1. Use a disposable instance installed from the reviewed pack. Turn each entry in
   `fixtures/observations.json` into one canonical inbox observation with its
   listed kind and the `lines` joined by LF. Use distinct UUIDs and UTC capture
   timestamps. Run the history and overlap cases in separate fresh instances.
   For overlap, apply the single line replacement from `overlap_variant`.
2. Use the host's ordinary claim, inference and candidate validation path. Record
   the harness version, installed guidance identity, host/adapter, model or
   unknown model, run ID and candidate diagnostics. Preserve the synthetic inputs
   and candidate for comparison. Never run against a private instance.
3. Compare by external tuple or evidence-local identity and claim shape. The
   example graph IDs are fixture labels. Award one point per expected claim
   recovered with correct subject, direction, object, attribution, exact supporting
   quote and validity. Report the count out of the number of expected claims.
   Equivalent exact excerpts may replace the example quotes if they establish the
   same assertion. Check each expected entity identity separately, and record
   extra claims, missing claims, and every prohibited result in
   `unsupported_outcomes`. Fail a trial on an identity merge, invented evidence,
   verification upgrade or ungrounded claim even if it recovers every expected
   claim. The already stored `WI-21` tuple is a retrieval fixture, not a rule for
   creating new prefixed IDs. For its history check, seed that tuple in the
   disposable graph or evaluate it separately with the deterministic test.
4. Run `validate` and `vocabulary-survey --single-valued has_state`. Both expected
   graphs report one `multiple_active_values` warning for item 17. The two
   additional `unused_entity` warnings are for the retrieval-only historical tuple
   and same-number item in a different scope. The history case classifies the
   intervals as disjoint history. The overlap variant shares the January 2
   endpoint, so the survey classifies it as overlap.

The release test checks explicit installation, exact source comparison,
selector routing, vocabulary, quotes, scoped retrieval and both interval cases
against the supplied expected graph. It does not invoke inference. Host inference
trial status for this pack is **pending** until measured on a specific host/model.
