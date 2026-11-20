# Writing a storage adapter

The host owns input capture, model access and storage. The harness supplies the
processing protocol, validation and the optional adapter contract described here.
Contract version 1 has six commands. Profile guidance is an optional capability
profile-guidance-v1; adapters without it follow the direct profile procedure in
APPLICATION_PROFILES.md. A backend may add result keys but must preserve required
semantics. Application warnings cannot downgrade mandatory validation errors.

## Backend template and packaged reference

adapters/template/adapter.mjs provides one explicit failing backend delegation per
step. Build application-owned host/backend code outside the engine using that
scaffold; this documented scaffold use does not authorize copying or modifying
memory validation internals. Running the unchanged reference CLI is supported.
All shipped adapter/template/test files remain integrity-covered and read-only in
an installed release. Runtime state, scratch candidates and locks go in the private
instance or its Git metadata, never in the engine.

The reference requires Node 22.12+, Python 3.12+ for initialization/tests and Git.
It supports a local, dedicated instance repository root on an attached branch.
Initialize/validate a new external instance, git init it, and commit the initialized
files before using the CLI. Existing instances are never initialized again. A data
subdirectory of an application repository, a bare repository, remote connector-only
storage and multiple machines sharing one clone require another backend. Separate
clones on the same remote do not share a local ref/lease; do not treat this adapter
as a distributed remote lock or push its refs as a substitute for remote CAS.

```sh
node adapters/reference-git/adapter.mjs status --instance /absolute/private-instance
node adapters/reference-git/adapter.mjs claim --instance /absolute/private-instance --max 20
```

--harness optionally selects the installed harness root. The factory additionally
allows injected Git/Node executables and a numeric-millisecond clock for tests.
No npm/pip dependency, inference client, daemon or automatic renewal is involved.
Git commits use golem-adapter <golem-adapter@localhost>. Local authorization remains
the host's responsibility; commit attribution is not user authentication.

## Command contract

All CLI options are --name value pairs. Success prints JSON; refusals exit 1 on
stderr without transcript content. Paths in results use forward slashes.

| Command | Options | Behavior/results |
|---|---|---|
| status | --instance | head, lease (including held), ready, waiting_for_age, processed count, malformed, recovery_required, contract_version, capabilities; no writes |
| claim | --max 1..20 | claimed run_id/head/expires_at/sources (id/path/hash/time/kind), or no-work with no writes; 60-second minimum age, oldest-first then ID |
| renew | --run UUID | owner-only unexpired lease extension, head/expires_at; lease duration 15 minutes |
| validate | optional --run UUID --outputs list | Without run: limited working-tree check against HEAD, meaningful after completion. With run: exact candidate check with mode candidate, output, files, left_uncommitted; no working files, ref, ledger or lease changes |
| commit | --run UUID --outputs list | Atomically publishes validated candidate, returns committed head/processed/files/left_uncommitted/warnings; journal required |
| release-error | --run UUID, optional --reason text | Owner-only error lease, inputs pending; reason deliberately replaced with a fixed safe message rather than persisting arbitrary source-like text |

claim/renew/error release each produce their own protocol-only commit. The run's
journal is memory/runs/RUN.md. --outputs is a comma-separated list of existing,
instance-relative regular files. Absolute paths, drive/backslash/glob paths,
traversal, .git, symlinks/nonfiles, reserved ledger/lease/configuration, inbox and
profile/vendor paths are refused. The adapter includes mandatory graph/index/queues and the resolved hypotheses file
(neutral or historical layout), the run journal, claimed inbox and existing evidence/ID.json itself.
Evidence indexing remains a host step. Declare event files in outputs. Unrelated
changed and unclaimed files are left untouched/uncommitted and reported.

Bad outputs, missing journal or guidance identity and staged candidate paths leave
the lease held so the agent can correct them. Source mutation or invalid candidate
releases only the owned lease with error and leaves sources pending. Candidate
validate never releases the lease. Changed processed sources require intervention.
Ref conflicts retain the lease and require reread, merge and revalidation. Expired
owners cannot complete or renew; an error release may clear its own expired lease
only if it has not been replaced. Never clear another run's ownership.

## Snapshot and concurrency guarantees

Committed HEAD is authoritative for lease and ledger. Local edits to these files
are refused; ordinary drafts can never manufacture ownership. A local operation
lock serializes participating mutation operations in one clone; read-only status
and candidate validate do not write lock state. A CAS ref update rejects any
intervening branch change, including after validation. Nonparticipating writers
must preserve these rules; filesystem permissions must exclude hostile mutation.

The agent may work in the live working tree in the reference's documented in-place
mode. Its drafts are visible to filesystem readers and are not committed state.
Readers needing consistency must read a committed snapshot. Hosts requiring draft
isolation should supply a separate candidate workspace and a suitable backend;
this reference does not manufacture a second agent workspace.

Completion captures artifacts as raw blobs in a private Git index, stages proposed
ledger rows and the idle lease there, materializes that exact tree without Git
filters, and validates against HEAD's graph. It commits the same tree using
expected-old-value update-ref. Later draft changes are not substituted into the
validated tree; they remain local. Source bytes are rechecked immediately before
publication. Filter/autocrlf settings cannot alter the committed source bytes.
The real index is not used to stage candidates. Staged modifications to touched
paths are refused; unrelated staged files are preserved. Candidate Git objects may
remain unreachable after dry validation; normal Git maintenance can remove them.

## Interrupted publication and recovery

A pending record in the instance Git directory describes the publication and only
the local protocol files/index entries to reconcile. It is written before CAS.
After CAS, persisted state is verified and local entries reconciled; the record is
removed. An interrupted publication may leave HEAD correct and local ledger/lease
stale. status reports recovery_required; the next mutating operation uses the
record to reconcile only unchanged captured files and index entries, without
creating another completion commit. Local conflicting drafts cause a refusal,
not an overwrite. Divergent HEAD requires operator inspection.

An OS-level termination can also leave golem-adapter-operation.lock in the Git
directory. Confirm no adapter process is active before removing that stale lock;
retain golem-adapter-pending.json for reconciliation. Do not delete the pending
record, reset the entire worktree or blindly force a lease. For stale protocol
files without a recovery record, preserve local changes, inspect committed state,
then restore only memory/processed.json and memory/processing-lock.json and their
index entries from HEAD. Full backup/recovery rules still apply. Hardware durability
and malicious/shared-filesystem writers are outside the local adapter guarantee.

## Guidance and warnings

A configured claim reads profile/configuration files from the same committed head,
rejecting dirty selected files. It publishes immutable run guidance with the lease
and returns text, boundary, version, snapshot path and guidance_identity. The journal
must contain the exact identity line in APPLICATION_PROFILES.md; commit enforces
it against the claim, independent of advisory warnings. Later profile edits affect
new claims, never the old snapshot. Current candidate configuration must remain
valid. Every batch kind can select only configured sections; it cannot select paths.

Validation warnings are returned in output.warnings by validate and warnings by
commit. Hosts may append namespaced advisory findings with code, message, object_id
and documentation; mandatory harness errors remain errors. There is no executable
checks-module loader or strict-mode conversion.

## Conformance and supported surfaces

Run node --test adapters/conformance/adapter.test.mjs. The default includes black-box
CLI tests and reference-only factory fault injection. To test another local adapter,
set GOLEM_ADAPTER to a JSON command array, for example ["node","/absolute/adapter.mjs"].
Its CLI must accept --instance/--harness and the documented flags. This fixture
suite assumes a local initialized Git instance; remote backends must supply an
equivalent fixture driver rather than claim coverage from skipped scenarios.

Tests cover readiness, ownership, completion/candidate parity, invalid snapshots,
source mutation, scope/path rejection, expiry/reclaim, concurrent writes, profile
scoping/provenance, crash recovery, index preservation and raw source bytes under
line-ending attributes. The release builder runs these from the staged package.
Actual platform results are recorded in the implementation PR; no unrun Desktop,
Windows, macOS or remote-host tests are implied by conformance.
