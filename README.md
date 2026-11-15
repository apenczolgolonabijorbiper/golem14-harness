# Golem native cognitive harness — 0.3.1

A host-independent cognitive harness inspired by Stanisław Lem’s Golem XIV and Xemantic’s work on metacognitive AI. The host LLM performs
interpretation by following AGENTS.md and docs/PROCESSING.md; the executable core
provides deterministic evidence indexing, source-grounded structured memory,
schema/integrity/history validation, lexical retrieval with one graph hop,
correction retention and statistics. Question/hypothesis maintenance and processing
leases are agent procedures, not autonomous services implemented by the CLI.

This is not the Xemantic engine, a trained persona, an LLM server or a complete web
application. There is no model API client, autonomous reasoning loop, scheduler,
transactional storage adapter, STT/TTS, browser UI or hosting scaffold here.
Those are integration responsibilities. No credentials or personal memory ship.

See [the architecture mapping](docs/ARCHITECTURE_MAPPING.md) for the connection
to Xemantic’s Golem XIV.

## Start on Windows, Linux or macOS

For Cursor Desktop with Claude, run the installer from a CLEAN extracted release.
It verifies release file hashes, copies the intact engine to `vendor/golem-harness`,
appends a clearly marked section to the application root AGENTS.md, and creates
`.cursor/rules/golem-harness.mdc` with `alwaysApply: true`. Other Cursor rules and
existing root instructions are preserved. Use absolute paths (PowerShell example):

```powershell
py integration/install-cursor.py --repo "C:/Projects/MyApp" --instance-root "C:/Private/MyApp-golem"
```

An identical rerun makes no changes. Conflicting engine versions, edited managed
instructions/rules, modified release files and symlink destinations are rejected
before writes. A failed/interrupted first copy may need manual cleanup of that new
partial engine directory; the installer does not silently repair an altered engine.
The manifest checks integrity against the supplied manifest, not publisher identity;
obtain the ZIP/checksum through a trusted channel.

The `.cursor/rules` rule points to the engine contract; engine code is not moved
into `.cursor` or `.agents`. The root AGENTS section records your chosen instance
path. No `.agents` discovery behavior is assumed. The manual starter remains in
`integration/AGENTS.application.md` for reviewed manual integration.

The installer does not create runtime state, start inference or configure a model
or scheduler. After installation initialize the new instance using the command
below, then start a fresh Cursor session in your application and confirm the Golem
rule appears among active rules. Ask Claude to read root AGENTS.md, identify the
protected engine and external instance paths, and report the storage adapter it
will use before processing. Folder discovery in the user's installed Cursor version
requires this local check; documentation retrieval was unavailable during packaging.
Rules instruct agents; they do not enforce OS filesystem permissions.

Configure your existing formatter/generator tools to exclude `vendor/golem-harness`;
the installer does not rewrite unrelated tool configuration. Apply updates only as
separately authorized engine-release replacements, preserving external instance data.

To upgrade an existing installation, pause processing and verify
the new release. Replace the entire `vendor/golem-harness` directory with the
verified release directory. Review the application-root `AGENTS.md` and update
the installed version if recorded. Retain the existing instance path and Cursor
rule. The first-install command refuses a different installed version. There
is no data migration or initializer step for an upgrade.

Install Python 3.12+ and Node 22.12+ (tested here on Node 24). No npm or pip packages
are required. Run from the extracted package directory; use `py` instead of
`python3` on Windows where appropriate. Choose a NEW private instance directory:

```sh
python3 processor/init-instance.py --root ../my-instance
node --test server/memory-core.test.mjs
node processor/memory-tool.mjs validate --root ../my-instance
node processor/memory-tool.mjs stats --root ../my-instance
```

Initializer refuses a nonempty directory, including existing memory. Keep code and
instance data separate; extraction/upgrade must never reset the instance.

Your application writes finalized UTF-8 observations to the instance inbox, one
fresh UUID filename per observation, LF newlines. For example (synthetic only):

```text
---
id: 00000000-0000-4000-8000-000000000001
recorded_at: 2026-01-01T12:00:00.000Z
kind: observation
---

Synthetic Alice visited Test City.
```

Save as inbox/00000000-0000-4000-8000-000000000001.md. Index it:

```sh
python3 processor/process.py --root ../my-instance
```

Then give an authorized LLM agent this package's AGENTS.md and processing protocol,
read/write access to ONLY the new instance, and a storage adapter capable of the
protocol's lease/atomic completion guarantees. Tell it explicitly which instance
to analyze. Manual analysis is the default; nothing starts by running the indexer.
Stage the processed ledger rows before validating the complete candidate against
the prior committed graph. See docs/PROCESSING.md for the transaction order.

```sh
node processor/memory-tool.mjs context --root ../my-instance --query "Test City"
node processor/memory-tool.mjs validate --root STAGED_INSTANCE --previous PRIOR_GRAPH
```

The first command returns no claims until analysis has written them. Retrieval is
lexical, not embeddings; follow citations when excerpts/results are truncated.
Limits: 500 graph sources, 5,000 entities, 20,000 claims, 100 retrieved claims,
4,000 excerpt characters per source. Structural checks cannot establish truth.

For resend handling and restoring inbox observations into a fresh instance,
see [the processing protocol](docs/PROCESSING.md).

## Build a release

From the maintainer checkout run:

```sh
python3 tools/build-release.py --output ../golem-cognitive-harness-0.3.1.zip
```

The builder runs the release tests, packages an explicit file list, and produces
a ZIP and adjacent SHA-256 checksum. The packaged AGENTS.md is the downstream
read-only contract. See [provenance](docs/PROVENANCE.md) for the baseline lineage.

This release establishes the standalone source baseline. Selective transfer of
processed memory and a reference transactional adapter are future work.
