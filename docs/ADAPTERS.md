# Writing a storage adapter

The host owns input capture, model access and storage. The harness supplies the
processing protocol, validation and the optional adapter contract described here.
Contract version 1 has six commands. Profile guidance is an optional capability
purpose-guidance-v2 (including selected profiles); adapters without it follow the direct profile procedure in
APPLICATION_PROFILES.md. A backend may add result keys but must preserve required
semantics. Application warnings cannot downgrade mandatory validation errors.

## Public provider integration

New host integrations use [MEMORY_PROVIDERS.md](MEMORY_PROVIDERS.md): provider
contract 1, logical schema 2 and public host module API 2. `openMemory` returns an
instance-scoped provider; `createMemory` accepts it directly. Request
`memory-provider-v1` when claiming a standalone reference cycle. The older
file-oriented CLI below remains a reference JSON integration utility; its
physical layout is not a requirement on other providers. The separate
`adapters/template/memory-provider.mjs` scaffold and shared provider conformance
suite cover new host implementations.

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

The host retains verification results according to the
[journal-pointer rule](PROCESSING.md#verification-record-and-journal-pointer-vi-019).
An analysis commit message is an allowed completion-record location when it
contains actual results. The reference adapter writes only `complete RUN_ID`,
not a verification report; its caller must retain the returned head, warnings
and warning summary plus observed check outcomes in a separate durable report.
Other host adapters may supply the full commit-message record instead. The
six-command contract, validation and publication logic are unchanged.

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
profile/vendor paths are refused. The adapter includes mandatory graph/index/queues and the canonical `memory/hypotheses.json` file
(JSON reference layout only), the run journal, claimed inbox and existing evidence/ID.json itself.
Evidence indexing remains a host step. Declare event files in outputs. Unrelated
changed and unclaimed files are left untouched/uncommitted and reported.

Bad outputs, missing journal or guidance identity and staged candidate paths leave
the lease held so the agent can correct them. Source mutation or invalid candidate
releases only the owned lease with error and leaves sources pending. Candidate
validate never releases the lease. Changed processed sources require intervention.
Ref conflicts retain the lease and require reread, merge and revalidation. Expired
owners cannot complete or renew; an error release may clear its own expired lease
only if it has not been replaced. Never clear another run's ownership.

## Completion-row ownership

The reference adapter is the sole completion-row writer for its candidate.
`validate --run` and `commit --run` derive one new row per claimed source from
committed HEAD, preserving prior rows. The cognition agent writes semantic
artifacts only; it must not append to `memory/processed.json`, edit the lease or
include either reserved file in `--outputs`. Manual protocol edits are refused
without substituting them into the candidate. Candidate validation leaves the
working ledger/lease and HEAD unchanged; completion publishes them atomically.

For custom backends, designate exactly one host assembly component as the row
writer. A host using direct staged-file validation must assemble its own complete
ledger first; the standalone validator never generates rows. Logical providers
instead derive processed/source records from semantic changes, without requiring
physical `processed.json` files. See
[completion responsibilities](PROCESSING.md#completion-row-ownership).

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

### Windows and stalled child diagnostics (0.6.1)

In PowerShell, set `$env:GOLEM_TRACE_COMMANDS='1'` before running
`node --test --test-reporter=tap adapters/conformance/adapter.test.mjs`.
This prints each synchronous child command before starting it; the last line names
an unresponsive child. Tracing is opt-in: command arguments and child diagnostics
can contain private data. Remove the setting after diagnosis.

Fixtures select `py -3` on Windows; set GOLEM_PYTHON to one real executable path
when needed. No `python3` alias is required. Tests close child stdin, disable Git
terminal/credential prompts, and isolate fixture hooks and commit signing from
user configuration. A synchronous fixture or adapter Git/validator child has a
60-second limit; an entire CLI invocation (which can run many Git commands) has
a 180-second limit. Concurrent-claim children have the same 180-second limit.
Timeout errors name the command and include available partial stderr. Test-runner
timeouts alone cannot interrupt JavaScript blocked in spawnSync.

A normal run emits a result for every test; an unavailable symlink privilege emits
an explicit diagnostic and only that symlink assertion is omitted, while the
remaining unsafe-path checks still run. The expected Windows completion budget
is under ten minutes. Hosted Windows CI verifies the package, but does not prove
that the original reporting workstation is fixed. Its exact stalled subprocess
was not identified from the supplied report; collect the trace if it persists.


## 0.7.0 policy and batch-read contract

The reference status advertises core-policies-v2. Candidate validation includes
strict hypotheses, dependencies and profile policy warnings. Committed policy
changes during a lease refuse completion; release/reclaim for new immutable
policy guidance. The graph is target version 2; no old-format instance support is
required. Host adapters must not claim the capability without these checks.

Raw candidate capture uses ls-tree plus cat-file --batch with binary byte-length
framing, never checkout filters or a Git process for every blob. At most two
immutable snapshots are cached per adapter; each child has a 64 MiB output cap.
The complete committed tree must fit that byte envelope; collection item limits
alone do not promise support for arbitrary-size notes/artifacts. Timeout and CAS
recovery rules still apply. CAPACITY_BENCHMARKS.md records actual measured sizes.

## Completed candidates and source reservations (0.8.0)

The standalone [candidate merge helper](CANDIDATE_MERGE.md) combines same-base
completed snapshots and reports structural conflicts and summary regeneration.
It does not extend this adapter's commit scope or six-command contract. The
reference adapter continues to publish only its own claimed source completions;
external completion publication requires a host backend with fresh lease,
ledger/source and CAS checks. No merge capability is advertised by this release.

Hosts may reserve sources for bounded-time external processing and select the
oldest eligible unreserved inputs. Reservations are host-owned hints; the current
reference claim CLI has no exclusion option. See the merge guide for ownership,
expiry and publication requirements. Separate remote clones still need a backend
that provides authoritative shared coordination and atomic publication.

## Performance diagnostics (0.9.0)

Pass `--timings true` to any reference CLI command for an additional timings
object. See [PERFORMANCE.md](PERFORMANCE.md) for fields, fixed-label privacy,
benchmarks and the candidate writer. The six-command contract, validation and
publication semantics are unchanged. Timings are a reference extension, not a
required adapter capability.

## Optional reviewed guidance lifecycle

`profile-install-v1` adds read-only `profile-status --instance I --source DIR` and
transactional `profile-install` to the reference Git adapter. Other backends may
omit the capability; template delegations fail closed. Require
`purpose-guidance-v2` for purpose-bound immutable run delivery, including no-profile
cycles (see APPLICATION_PROFILES.md). Mandatory operations remain independently
conformant; optional suites run only for advertised capabilities.

Status reports source/HEAD/working hashes, stale managed paths and recovery state.
Precedence is source-invalid, not-installed, drift, dirty, in-sync; simultaneous
committed and working findings are retained. It never reconciles recovery. Install
captures validated source bytes under the operation lock, rereads HEAD/lease,
refuses processing leases/touched staged files/unsafe paths and publishes a private
index candidate with expected-old-head CAS. The candidate validates against the
previous graph. No observation/ledger/graph changes are generated by installation.

Only previously selected managed paths may become stale deletions; unrelated files
are preserved. Omitted purpose is preserved. Installation explicitly restores dirty
managed files to reviewed source bytes; inspect status and preserve drafts first.
A fully synced source returns unchanged. Dirty restoration to identical HEAD bytes
creates no commit. New target paths with conflicting unowned local edits refuse.
The commit message records paths/hashes and revision/dirty provenance, never prose.
Recovery records represent before/after absence as null, so deletion and creation
are idempotent. A post-CAS error may leave a valid published commit with
recovery_required. A later locked mutation reconciles it or refuses divergence or
local/index edits; no guarantee says every failure preserves the old HEAD.

Reference CLI accepts --git and --node as single executable argv elements for all
relevant children. Factory `sourceGuard` / CLI `--source-guard DIR` binds that adapter
instance to a reviewed application source and rechecks sync under the claim lock.
Configure it for the intended instance only. Never globally bind unrelated test
instances or ordinary engine reads to mutable source directories. Empty Git inbox
directories need not be tracked; absent inbox is empty, linked/malformed inbox fails.

### Starting a fresh instance

Obtain owner authorization for an archive/reset; implementation of lifecycle does
not itself authorize replacing a real instance. Stop writers and schedules. Inspect
lease and recovery; release active/expired processing leases through their owner
and finish or resolve recovery. Preserve the old instance intact at its own location
and record its revision. Initialize a different absent/empty destination from the
reviewed application source, validate it and configure its dedicated Git adapter.
Run profile-status/install before its first claim, record installed hashes and
source provenance, then update the host setup record to the fresh location. Do not
copy old leases, ledgers, graph or processed markers to the fresh instance. Recollect
observations under the application's authorized intake policy. Never silently
archive or reset a consuming application's real data.

## Cognitive task read view and reviewed learning

The additive JS `openCognition({instance_id})` method supplies an immutable
committed read view with binding, guidance, context and exact source ranges. It
does not acquire a write lease or consume observations. The neutral task contract
and optional `publishLearning({task,proposal,authorization})` method are specified
in [COGNITIVE_TASKS.md](COGNITIVE_TASKS.md). These are distinct negotiated
capabilities, not a reinterpretation of claim/commit or a host's ask API.
