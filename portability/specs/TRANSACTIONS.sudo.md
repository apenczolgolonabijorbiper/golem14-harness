# Local Git adapter transaction contract

Normative companions: ADAPTERS.md, PROCESSING.md, APPLICATION_SOURCES.md,
APPLICATION_PROFILES.md, COGNITIVE_TASKS.md. Git is an installed dependency, not
an engine to reimplement. Preserve attached branch, raw blob and CAS semantics.
An alternative validator executable replaces the reference Node child; no Node
requirement remains on a deployment using a complete compliant implementation.

## Binding and publication

Require dedicated Git repository root separate from engine, attached HEAD,
committed lease/ledger with supported schema, no linked protocol paths. Pin the
active branch name for adapter lifetime. Read committed snapshots using raw blobs
(`ls-tree -r -z`/`cat-file --batch` or equivalent), accept regular blob modes
100644/100755 only, validate byte-length framing and paths, never checkout filters.
Validate candidates with EXACT bytes that will be committed, not the dirty tree.
Use private index, preserve unrelated staged/unstaged files. Refuse staged changes
to touched paths. Do not use broad reset, clean, git add . or ordinary filtered
checkout to implement reconciliation.

```sudolang
Publish(expectedHead, entries, localWrites) {
  Require operation mutex .git/golem-adapter-operation.lock (exclusive directory)
  Reconcile prior pending publication before any mutation
  Build private tree from expectedHead plus exact entries
  Create child commit with parent expectedHead, fixed adapter author/committer
  Write exclusive durable .git/golem-adapter-pending.json:
    {old,next,paths,writes:[{path,before:byteHashOrNull,after:byteHashOrNull}]}
  CAS attached ref from expectedHead to next; on race remove own pending marker
  Reconcile selected local files and index; remove marker only after completion
}
```

Recovery: if HEAD==old remove uncommitted marker. If HEAD==next, reconcile each
write only if actual hash equals before or after (null means absent); otherwise
refuse preserving edits. Reconcile touched index entries only if they match old
or new tree values; refuse edited/unmerged entries or staged deletion where both
versions exist. If HEAD is neither old nor next refuse operator intervention.
Dirty restoration with no new commit uses old:null,next:current. Mutex is removed
on normal unwind; stale mutex after process death requires inspection, never
blind stealing. `status` is read-only and never reconciles pending publication.
Any later locked operation may finish recovery. No promise that errors leave old
HEAD intact; publication may have succeeded before local reconciliation failed.

## status

Result contract_version:1, capability array, head, lease plus held, ready,
waiting_for_age, malformed, processed count, recovery_required. held iff processing
and expires_at > now. Ledger rows bind unique UUID, exact inbox path/hash, processed.
Processing lease validates run UUID, finite expiry, observation_ids/sources
alignment. Verify all processed raw source bytes (including deletions); any drift
is malformed. Scan direct inbox .md files (absent inbox is empty); strict parser
from INIT_INDEX. Ready iff now-recorded_at >=60000 ms; sort ready by recorded_at
then UUID collation, waiting follows filename order. recovery_required iff pending
marker exists or local lease/ledger differ from committed. Capabilities:
memory-provider-v1,candidate-validation-v1,purpose-guidance-v2,profile-install-v1,
core-policies-v2 and cognitive capabilities listed in COGNITION.

## claim / renew / release-error

claim max default 20 integer 1..20; optional required_capabilities must be supported
(reference negotiation accepts provider/candidate/purpose/profile/policy list).
Under mutex require local protocol equal HEAD, no held lease or malformed source;
optional source-guard must be in-sync; require committed purpose/config/all selected
guidance clean (including index). Resolve canonical layout in both committed and
working state. Select oldest ready max inputs; no-work returns status:no-work
without commit. Claim publishes lease and retained guidance atomically: UUID run,
claimed_at=now,expires_at=now+900000ms, observation_ids,sources,guidance_version.
When memory-provider-v1 required, also commit exact source bytes; legacy claim can
leave sources untracked until completion. Retain `memory/runs/RUN.guidance.json`.
Return status:claimed,run_id,head,expires_at,sources,guidance,guidance_version,
guidance_boundary,guidance_identity,guidance_path. Expired lease can be reclaimed;
claim never marks processed.
renew requires same UUID and unexpired processing ownership, extends 900000ms,
returns head/expiry. release-error requires same processing owner (expiry allowed),
sets schema1 error lease with empty observation_ids,last_run_id,completed_at,
reason `Processing failed; inputs remain pending`; no graph/ledger/source changes.
CLI --reason is accepted legacy syntax but not consumed by release-error; do not
claim arbitrary user reason text is persisted by this binding.

## validate / commit

Working-tree validate (without run) uses committed graph as previous and reports
{ok:true,mode:working-tree,head,output}; no mutation. Candidate validate requires
owned unexpired run, clean local protocol, guidance format 2 and source integrity.
Allowed outputs are explicit relative files; refuse lease, ledger, config,
inbox/,vendor/,profiles/,instance/,selected managed paths,persona/ except legacy
persona/hypotheses.json. Deduplicate preserving order; never glob.
Build entries in order: graph,index,queue.json,queue.md,hypotheses,journal,
explicit outputs, claimed sources and optional evidence, retained guidance,
automatically derived ledger and idle lease. Verify journal exact guidance line,
retained guidance == committed claim guidance, clean purpose, no malformed source.
Append ONLY claimed completions to committed ledger with processed_at,outputs,
run journal pointer; derive lease idle/last_run/completed_at. Materialize raw tree,
create empty inbox if necessary, validate against previous graph. Result
{ok:true,mode:candidate,head,output,files,left_uncommitted}; no HEAD/working ledger/
lease changes. Candidate ledger is simulated, not agent-authored.

commit rebuilds and validates candidate under mutex, rechecks head, own lease,
source bytes and touched index before expected-head CAS; publishes all artifacts,
ledger and idle lease in same commit. Reconcile local ledger/lease only (draft
files already equal candidate); preserve unrelated dirty paths. Read back persisted
completions to verify exact claimed IDs/hashes. Return status:committed,head,
processed,files,left_uncommitted,warnings,warning_summary. Ordinary preflight errors
retain lease. Candidate/source/integrity failure during commit may publish error
lease, leaving inputs pending. Head race retains lease and requires reread/merge/
revalidation; it never silently retries against a new base.

## profile-status / profile-install

status requires explicit source and reports source-invalid|not-installed|drift|
dirty|in-sync with that precedence; retains committed/working comparisons,
dirty_paths, exact source/head/working hashes and recovery_required. Read-only.
install captures source under mutex; refuse any processing lease, even expired
until released, edited protocol/touched index, unsafe targets, implicit deselection
of installed profile, conflicting newly-owned local files. Delete only stale
previously selected paths validated under profiles/ or guidance/. Preserve omitted
purpose and unrelated files. If bytes identical to HEAD, reconcile dirty managed
paths via pending marker without commit; return unchanged/head/restored_paths/source.
Else validate private candidate vs previous graph, CAS publish installation,
return installed/head/restored_paths/removed_paths/source. Never mutate observation,
graph, ledger or processing identities through installation.

## reviewed learning publication

openMemory/openCognition return instance-bound immutable provider/read handles.
publishLearning requires trusted host authorization allowed:true matching task and
proposal IDs; never infer authorization from proposal content. Receipt path is
memory/learning/SHA256(prettyJSON(proposal_id)+LF).json. Same proposal/task/instance
retry returns already_published; different retry refuses. No processing lease,
source drift or dirty touched/index paths allowed. Validate proposal against
current binding/claims. Reject duplicate hypothesis ID/statement; correction
withdraws existing nonwithdrawn target. Add open hypothesis with confidence:null,
uncertainty-derived confidence_basis <=4000, support/refutation and timestamps;
append authorization reference receipt atomically after full candidate validation.
Return status:published,head,receipt_path. It does not mark observations processed.
