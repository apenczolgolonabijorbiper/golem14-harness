# Golem in Codex CLI and Desktop

Both hosts use the application-root AGENTS.md integration block and the packaged
engine contract. The active Codex session supplies inference. The application
supplies a private instance and an adapter for the processing protocol.

## Choose folders

`--repo` is your application root. The installer creates its engine copy at
`--repo/vendor/golem-harness`. `--instance-root` is the data directory containing
this instance's observations and memory. Start with a dedicated data directory
per application. See [the folder guide](DIRECTORY_LAYOUT.md) for the recommended
external layout, the in-project alternative and deliberate memory sharing.

## Install the integration

Use a clean extracted release obtained through a trusted channel. Run this from
its golem-harness directory on Windows:

```powershell
py integration/install-codex.py --repo "C:/Projects/MyApp" --instance-root "C:/GolemData/MyApp"
```

On Linux or macOS:

```sh
python3 integration/install-codex.py --repo "/home/me/projects/MyApp" --instance-root "/home/me/golem-data/MyApp"
```

The installer verifies RELEASE.json, copies the unchanged release into
vendor/golem-harness, and appends one shared Golem block to application AGENTS.md.
It preserves existing application text and Cursor rules. Repeating the same
installation writes zero files. The Cursor installer uses the same block, so both
hosts can use the same engine and instance. An exact legacy Cursor block for the
selected paths/version is updated to the shared wording. Customized blocks,
conflicting versions and damaged engine files require reviewed resolution.
Different installed engine versions follow the explicit upgrade steps in README.md.

Inspect discovery_warnings in the JSON output. A nonempty root AGENTS.override.md
can mask the installed block. A large AGENTS.md can exceed Codex's default 32 KiB
instruction budget. Review active instructions and explicitly load the application
AGENTS.md when needed. The installer reports these conditions without rewriting
Codex configuration or overrides. Nested instructions can affect a session started
in a subdirectory, so verify discovery in each working context you intend to use.

The command installs integration files. Instance initialization and processing
are separate operations through the guided flow below.

## Codex CLI

Start an interactive session at the application root:

```sh
codex -C "/home/me/projects/MyApp"
```

Send this setup request in the session:

```text
Read vendor/golem-harness/integration/SETUP.codex.md and follow it to configure
my Golem instance. Reuse existing settings, ask for missing choices, and show
the resolved setup before applying it.
```

The procedure reads configuration, asks about a new or existing instance, purpose,
language, optional profile and invocation mode, and proposes application
docs/GOLEM_CODEX.md as the persistent setup record. A fresh session can explicitly
load that record to reconnect. It checks the instance independently of a worktree's
relative path and uses the existing initializer only for a new empty destination.

The private instance may be outside the workspace's writable roots. If the selected
sandbox needs an additional directory, use the host's supported access controls.
CLI versions exposing --add-dir can include the explicitly selected private path:

```sh
codex -C "/home/me/projects/MyApp" --add-dir "/home/me/golem-data/MyApp"
```

Check your installed client's help for supported flags. Setup reports unavailable
access so the required directory can be granted explicitly.

A noninteractive discovery check for a configured, authorized local checkout is:

```sh
codex exec -C "/home/me/projects/MyApp" --sandbox read-only "Read AGENTS.md and the referenced Golem contract. Report HARNESS_ROOT, INSTANCE_ROOT, engine version and the configured storage adapter. Do not modify files or process observations."
```

Keep guided setup in an interactive session so the user can answer unresolved
questions. For subsequent noninteractive processing provide the exact saved record,
instance, adapter and authorized action. Missing decisions leave processing pending.

## Codex Desktop

Create or open a local project with the application repository as its primary
source folder, then start a fresh Codex chat there. In versions with a product
selector, select Codex. Use the same setup request shown for CLI. If the instance
lives elsewhere, attach or grant access to that private location using the client's
supported project and permission controls. Check the chat's actual access.

Confirm which folder and branch the session is using. For a new worktree, resolve
the instance from its saved location before writing, since a relative sibling path
may identify a different directory. Select a shared instance only deliberately,
and use its lease protocol when multiple sessions can process it.

Ask the agent to report the loaded application instructions, harness path/version,
instance location and adapter before the first processing cycle. Repeat in a fresh
chat after installation or changes to the setup record. Primary-folder discovery
and access to secondary folders are distinct concerns.

The [official project guide](https://learn.chatgpt.com/docs/projects) describes
primary-folder instruction discovery in Desktop. The [official AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
describes discovery precedence, override files and the default instruction budget.
Desktop features and permission controls depend on the installed client.

## Verification and readiness

| Check | Expected result |
| --- | --- |
| Clean CLI/Desktop installation | Verified engine and one shared application block |
| Repeated installation | Zero file writes |
| Cursor then Codex, or Codex then Cursor | One shared block, same engine/instance, existing rules preserved |
| Exact legacy Cursor block | Shared block replaces only the known managed content |
| Customized block or mismatching instance | Refusal before writes |
| Modified release or installed engine | Refusal before writes |
| Root override or large instructions | Explicit discovery warning, preserve existing settings |
| Fresh CLI session | Reports the configured paths and contract after instruction check |
| Fresh Desktop chat | Same check in the primary application folder |
| Instance or adapter unavailable | Report processing unavailable, keep observations pending |

The release builder exercises installer, integrity, coexistence and regression
checks in temporary consumers. CLI and Desktop session checks require their actual
hosts. Record client version, execution surface, observed model/settings when
exposed, and raw results. Leave hidden backend metadata unknown. End-to-end memory
processing requires lease acquisition, staged prior-graph validation, atomic
publication and read-back through the application-owned adapter in docs/PROCESSING.md.
