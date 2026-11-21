# Interactive Architecture Explorer

Open [architecture-explorer.html](architecture-explorer.html) inside the extracted
harness release ZIP, download the raw HTML from the repository, or download the
`golem-harness-architecture-explorer` artifact from a successful release workflow.
Open that single file directly in a browser. It requires no server, network,
external fonts or JavaScript libraries. GitHub's file viewer displays the source;
it does not execute the presentation.

## Build locally

From any working directory, with Python 3.12+ and Git installed:

```sh
python3 /path/to/golem14-harness/tools/build-explorer.py
python3 /path/to/golem14-harness/tools/test-explorer.py
```

The generator defaults to `docs/architecture-explorer.html`; `--output PATH`
selects another destination. It discovers non-test Python/JavaScript modules,
extracts declaration lines and full module source, and embeds Markdown docs,
canonical JSON schemas, VERSION and release notes from the checkout. It uses
only the Python standard library and makes no network or inference requests.
All source text is safely serialized as JSON data inside the page.

Module descriptions live in `tools/explorer/modules.json`; the visual design and
curated explanations live in `tools/explorer/template.html`. Newly discovered
modules receive a generic description until reviewed. Maintain narrative behavior,
examples and command summaries alongside runtime changes: a static generator
cannot infer architectural meaning or prove an old explanation remains correct.

Build from committed source for publishable provenance. The displayed revision
and date are from the last commit touching anything except the generated page;
page-only commits are deliberately ignored to prevent endless metadata churn.
Repeat builds of identical committed input are byte-identical, including after
checking out the workflow's generated commit. Uncommitted edits are included in
local previews, so their displayed revision is only the committed baseline.
CI uses full Git history and a clean source checkout.

## Release integration and persistence

PR and master-push validation classify the complete change set first. Docs,
explorer assets and workflow-only changes run one Linux explorer/routing test
job; the platform correctness and capacity matrices are skipped. Changes in
processor, server, schemas, adapters or integration, packaging, VERSION,
benchmarks and unknown paths retain both full matrices. Mixed changes always
take the full route. Integration Markdown is part of the executable agent
contract and is deliberately not treated as ordinary documentation.

The workflow itself always starts, including for docs-only changes, so checks
are not left pending by top-level path exclusions. `validation-result` aggregates
the required selected jobs, accepting skips only on the lightweight route.
It can be used as a stable branch-protection check across both routes.

The existing release workflow runs generation and repository-only checks, uploads
the standalone HTML as a workflow artifact, builds/verifies the ordinary harness
ZIP, and publishes a new version if needed. Even if that release already exists,
the subsequent persistence step still runs. It commits only the generated page
to master using the workflow token and a normal fast-forward push. The release
tag still targets the original source commit, not the later generated-page commit.

`tools/build-release.py` also invokes the generator itself before collecting
release entries, so direct local builds cannot package a stale tracked page.
`golem-harness/docs/architecture-explorer.html` is included in the ZIP and its
exact bytes are SHA-256-covered by RELEASE.json. This is static documentation;
it does not execute inference or modify an instance. Existing published ZIPs are
not overwritten; the first release with this packaging is 0.9.1.

The release workflow is triggered by VERSION, its own definition, and generator
assets; it can also be dispatched manually on master. A generated HTML-only push
does not match those paths and cannot cause a release loop. For source or docs
changes between versions, dispatch the workflow on current master to refresh.

If master advances during a build, persistence refuses to save a stale page;
dispatch the workflow again from current master. No force push or rebase is used.
Branch protection can reject the bot push: the failed step is explicit and the
already-uploaded artifact remains available. Configure the repository to permit
this workflow's normal generated-file commit if automatic persistence is desired;
the workflow does not bypass protection.

The generator, template, metadata, persistence helper, tests and this guide are
repository-only. Only the generated HTML is added to the release FILES allowlist
and integrity manifest. The extra workflow artifact provides the same page for
standalone downloading without extracting the release ZIP.
