# Golem native cognitive harness — 0.13.3

A host-independent cognitive harness inspired by Stanisław Lem’s Golem XIV and Xemantic’s work on metacognitive AI. The host LLM performs
interpretation by following AGENTS.md and docs/PROCESSING.md; the executable core
provides deterministic evidence indexing, source-grounded structured memory,
schema/integrity/history validation, lexical retrieval with one graph hop,
correction retention and statistics. Question/hypothesis maintenance and processing
leases are agent procedures, not autonomous services implemented by the CLI.

This is not the Xemantic engine, a trained persona, an LLM server or a complete web
application. There is no model API client, autonomous reasoning loop, scheduler,
STT/TTS, browser UI or hosting scaffold here.
Those are integration responsibilities. An optional local Git storage adapter,
backend scaffold and conformance suite are included; see [storage adapters](docs/ADAPTERS.md).
No credentials or instance data ship.

See [the architecture mapping](docs/ARCHITECTURE_MAPPING.md) for the connection
to Xemantic’s Golem XIV.

## Logical memory integration

Hosts can use the [public memory-provider contract](docs/MEMORY_PROVIDERS.md)
for snapshot-bound record reads, bounded context and semantic changes. The
standalone JSON/Git launcher is `processor/provider-tool.mjs`; a conforming host
can supply another provider without changing Harness cognition. JSON remains a
full-file reference backend with the existing capacity limits. No migration or
release is performed by this API.

## Choose the application and data folders

`--repo` selects your application's root. The installer places the engine at
`--repo/vendor/golem-harness`. `--instance-root` selects that Golem instance's
memory and observation data directory. For a new project, use one dedicated data
directory per application, such as `C:/GolemData/MyApp`, outside the checkout.
Data can also live inside the project, outside the installed engine and excluded
from public version control. See [the folder guide](docs/DIRECTORY_LAYOUT.md)
for the full mapping, both layouts and how sharing an instance works.

## Codex CLI and Desktop

Run `python3 integration/install-codex.py --repo /home/me/projects/MyApp --instance-root /home/me/golem-data/MyApp`
from a clean extracted release, then start Codex in the application folder.
The installer verifies and copies the engine and appends shared instructions to
the application-root AGENTS.md. For guided setup, ask Codex to read
`vendor/golem-harness/integration/SETUP.codex.md`. See [the Codex quickstart](docs/CODEX.md)
for Windows examples, Desktop projects, CLI commands and discovery verification.

## Guided setup in ChatGPT Work

Ask a Work session to read `integration/SETUP.work.md` from the selected release
and follow it for your application. It reads existing configuration, asks for
missing choices, presents the resolved setup, and uses the existing initializer
for a new private instance. It records reusable settings outside the engine for
future chats. See [the Work quickstart](docs/CHATGPT_WORK.md) for a copyable
starting prompt, persistence requirements and acceptance scenarios.

## Start on Windows, Linux or macOS

For Cursor Desktop with Claude, run the installer from a CLEAN extracted release.
It verifies release file hashes, copies the intact engine to `vendor/golem-harness`,
appends a clearly marked section to the application root AGENTS.md, and creates
`.cursor/rules/golem-harness.mdc` with `alwaysApply: true`. Other Cursor rules and
existing root instructions are preserved. Use absolute paths (PowerShell example):

```powershell
py integration/install-cursor.py --repo "C:/Projects/MyApp" --instance-root "C:/GolemData/MyApp"
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
`python3` on Windows where appropriate. Node test fixtures use `GOLEM_PYTHON`
when set (an executable path, including paths with spaces), otherwise `py -3` on
Windows or `python3` elsewhere. The release builder passes its own Python executable
to Node fixtures unless you explicitly set `GOLEM_PYTHON`. Errors name the command
that failed. Choose a NEW private instance directory:

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

The JSON reference indexer locks one private instance across local processes and
publishes each evidence JSON atomically. Concurrent invocations refuse promptly
with `Indexer busy:` (exit 1); retry after the owner exits. Existing evidence is
preserved. A killed owner releases its OS lock; the next run cleans unpublished
temporaries. Keep `.golem-indexer.lock` in place even when idle. See the
[indexer concurrency and recovery contract](docs/PROCESSING.md#json-reference-indexer-concurrency)
for platform boundaries and recovery. Indexing is separate from cognition leases
and atomic completion of an analysis cycle.

Then give an authorized LLM agent this package's AGENTS.md and processing protocol,
read/write access to ONLY the new instance, and a storage adapter capable of the
protocol's lease/atomic completion guarantees. Tell it explicitly which instance
to analyze. Manual analysis is the default; nothing starts by running the indexer.
The host candidate assembler supplies completion rows before validation. With the
reference adapter/provider, agents do not edit the ledger/lease; with direct
staged-file validation, the host stages the rows itself. Validate the complete
candidate against the prior committed graph. See docs/PROCESSING.md for the transaction order.

```sh
node processor/memory-tool.mjs context --root ../my-instance --query "Test City"
node processor/memory-tool.mjs validate --root STAGED_INSTANCE --previous PRIOR_GRAPH
```

The first command returns no claims until analysis has written them. Retrieval is
lexical, not embeddings; follow citations when excerpts/results are truncated.
Limits: 10,000 graph sources, 5,000 entities, 20,000 claims, 100 retrieved claims,
4,000 excerpt characters per source. Structural checks cannot establish truth.

For resend handling and restoring inbox observations into a fresh instance,
see [the processing protocol](docs/PROCESSING.md).

## Interactive Architecture Explorer

Open [the standalone architecture explorer](docs/architecture-explorer.html)
to browse modules, functions, data schemas, processing and storage contracts offline.
The release workflow regenerates it from source and saves it to this repository.
The generated HTML is included in the harness ZIP and integrity manifest;
its generator and template remain repository-only. See the
[build and workflow guide](https://github.com/apenczolgolonabijorbiper/golem14-harness/blob/master/docs/EXPLORER.md).

## Build a release

From the maintainer checkout run:

```sh
python3 tools/build-release.py --output ../golem-cognitive-harness-0.12.0.zip
```

The builder runs the release tests, packages an explicit file list, and produces
a ZIP and adjacent SHA-256 checksum. The packaged AGENTS.md is the downstream
read-only contract. See [provenance](docs/PROVENANCE.md) for the baseline lineage.

Version 0.8.0 adds a [completed-candidate merge](docs/CANDIDATE_MERGE.md) helper
and host reservation guidance. It preserves the 0.7.0 formats and policies:
strict hypothesis records, policy-aware retrieval, scoped
identifiers, dependencies and measured source capacity. Target formats only.
See [release notes](docs/RELEASE_NOTES.md). Selective transfer of processed memory
remains future work.

## Analysis-cycle performance

Version 0.9.0 batches Git tree/index operations, bounds concurrent source reads,
and adds optional adapter timings and a structured candidate writer.
See [performance and candidate writing](docs/PERFORMANCE.md) for the draft format,
measurement recipe and host orchestration guidance. No schema or lease changes;
validate and commit still independently build and validate candidates.

## Domain memory and processing extensions

Explicit [application profiles](docs/APPLICATION_PROFILES.md) supply guidance without
changing the engine, with batch-scoped delivery and run provenance in the reference
adapter. Entity kinds refine the existing types; retrieval adds optional filters
and bounded traversal. [Validation warnings](docs/MEMORY_MODEL.md#validation-warnings)
are advisory and never weaken integrity checks. No selected profile means no domain policy. Incompatible previous instances may
be recreated; see the target-format notes below.

See [target instance layout](docs/INSTANCE_LAYOUT.md) for canonical paths
and source attribution/classification names. Persona-oriented memory
is one optional application focus, alongside other domain profiles.


## 0.7.0 target formats and policies

Use a fresh instance: graph schema 2, hypotheses schema 1, and vocabulary schema 2
when a vocabulary is selected (configuration/ledger/lease/queue remain version 1).
No backward compatibility or migration is promised. The canonical paths and claim
fields are in docs/INSTANCE_LAYOUT.md. See docs/ANALYSIS_WORKFLOW.md for a synthetic
producer/profile/retrieval recipe, docs/INTAKE_PROVENANCE.md for intake measurements,
and docs/CAPACITY_BENCHMARKS.md for the measured resource envelope.

The [P3 follow-up decisions](docs/CORE_FOLLOWUP_DECISIONS.md) retain the current
time, change-entity, value and identity models and defer core group metadata.
Run `node tools/assess-core-followups.mjs` for the shipped synthetic evidence.

New tools include strict hypotheses validation, direct dependency review warnings,
scoped identifiers, capacity usage and conflict-aware --current/--valid-at retrieval.
They preserve evidence and prompt review; they do not infer truth or merge records.

For reviewed domain setup, use [scan/wizard onboarding](integration/SETUP.profile.md),
[application-owned sources and inspection](docs/APPLICATION_PROFILES.md), and
[transactional profile installation](docs/ADAPTERS.md).

## Memory-backed cognitive tasks

Questions and bounded goals use [cognitive task v1](docs/COGNITIVE_TASKS.md):
intent-aware linked conversations, immutable bounded evidence, grounded answers
and separate reviewed hypothesis proposals. No observation batch or named host
is required. Use the [SudoLang prompt](integration/COGNITIVE_TASK.sudo.md) and
[conformance/evaluation instructions](docs/COGNITIVE_CONFORMANCE.md).

## Language-neutral local core

[The portable contract](portability/README.md) specifies local deterministic
operations in versioned SudoLang, with JSON schemas, retained fixtures and exact
reference traceability. Generate implementations for already-available target
languages without installing Python/Node on that target. Git remains assumed for
the Git binding. Provider APIs and deterministic cognitive bookkeeping are covered;
inference, MCP and distributed workers are outside this contract. Generated ports
must declare their verified coverage; generation does not certify compatibility.
Core specifications and fixtures evolve in the same PR/release as core behavior.

## Release validation

Routine platform CI runs the full distribution builder on Ubuntu (Node 22.12
and 24) and macOS (Node 24). Windows checks the Linux-built ZIP on both Node
versions. Node 24 also runs installer and observation-portability checks. The
publication workflow checks its exact ZIP on Windows before publishing.
The separate Harness Windows reliability workflow runs the full Windows suite
on Python 3.12 and 3.14 and measures Windows capacity. It can be dispatched
manually and runs automatically for changes to process supervision or benchmarks.
