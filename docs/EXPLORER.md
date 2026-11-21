# Interactive Architecture Explorer

Open [architecture-explorer.html](architecture-explorer.html) after downloading
the raw HTML from the repository, or download the
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

The existing release workflow runs generation and repository-only checks, uploads
the standalone HTML as a workflow artifact, builds/verifies the ordinary harness
ZIP, and publishes a new version if needed. Even if that release already exists,
the subsequent persistence step still runs. It commits only the generated page
to master using the workflow token and a normal fast-forward push. The release
tag still targets the original source commit, not the later generated-page commit.

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

The generator, template, metadata, persistence helper, tests, this guide and
generated HTML are repository-only. None is added to `tools/build-release.py`'s
explicit FILES allowlist, the release ZIP, or its integrity manifest. The explorer
is a separate workflow artifact, not a release asset or installed runtime feature.
