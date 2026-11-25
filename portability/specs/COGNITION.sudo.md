# Deterministic cognitive session and reviewed learning validation

Normative companions: COGNITIVE_TASKS.md, COGNITIVE_CONFORMANCE.md,
integration/COGNITIVE_TASK.sudo.md and four bundled cognitive schemas. This contract
covers deterministic validation/accounting/read views; generating answers remains
inference and is outside this portability implementation.

Capabilities: cognitive-task-v1,cognitive-context-v1,cognitive-result-v1,
learning-hypothesis-v1,hypothesis-unknown-confidence-v1. Binding equality compares
instance_id,snapshot_id,guidance_id exactly. All task/result/context/learning
shape constraints in schemas apply before semantic checks.

validate-task: nonempty messages; unique message IDs; reply_to links only earlier
messages; question_answer needs reply links; user_question/user_request/
question_answer author user; cognitive_question/hypothesis author golem;
collection_request author application or golem; intent.origin==author; inferred
intent requires uncertainty. No assumption of alternating question/answer order.
validate-context: matching binding, unique claims/entities/sources, every cited
source ID delivered, nonempty truncation reasons imply truncated=true.
validate-result: task_id and all bindings match trusted host receipt; unique
finding/question IDs; claim IDs must have been delivered; premise IDs present,
not self and acyclic. source_assertion needs claims+exact evidence;
derived_conclusion needs premises; hypothesis needs uncertainty;
general_model_knowledge cannot cite memory evidence/claims/premises. Evidence
hash/source/start/quote must match a retained delivered segment and cited claim's
source. Question IDs cannot collide with messages/findings; reply/premise targets
exist, intent origin golem and inferred intent uncertain. outcome answer requires
stop_reason complete. missing_evidence requires questions or uncertainty.
Coverage truncated/pending/valid_at must match host receipt/task. All usage fields
match trusted receipt and budget (elapsed overrun only permitted for budget stop).
validate-learning: task mode propose_learning, task/proposal/trusted bindings
match; support/refutation only delivered active claims, unique and disjoint;
nonempty uncertainty and verification_needed; add_hypothesis target null,
correct_hypothesis target distinct present ID; hypothesis ID schema pattern.
Validation returns errors, not prose or a modified task.

```sudolang
Session(task, immutableView, clock, cancellation) {
  Validate task and binding; retain cloned task, never model-editable receipt
  Count rounds, context_requests, source_bytes and elapsed_ms from start
  Before bounded operation: reject cancellation or elapsed >= limit
  beginRound: refuse at round cap, else increment
  context: consume request budget; validate allowlisted options and claim limit
    Force task subject scope, expansion budget and valid_at/current selection
    Validate returned context binding, scope, pending count and claim cap
    Retain delivered claims and source hashes; refuse changed snapshot records
    Accumulate truncation
  source: consume request budget; require cited source from delivered claims
    Validate UTF-16 start>=0, length 1..16000, remaining UTF-8 byte budget
    Read bound hash/range; count actual bytes and retain exact segment
  receipt: update elapsed, return trusted binding/claims/sources/coverage/usage
  finish: replace submitted usage with actual receipt, validate result
    Cancellation/budget requires corresponding stop_reason
    No writes or observation completion
}
```

Context allowed options query,entity_id,source_id,predicate,type,kind,status,hops,
external_id,scheme,namespace,limit,claim_ids,current. Default source length4000;
context limit defaults task.limits.claims. Invalid option requests consume a
request slot after pre-budget guard; no hidden retries. Source bytes count UTF-8,
quote starts count UTF-16. A clock/cancel test seam must be trusted, not supplied
by a model result. receipt itself can be read after budget exhaustion.

Read view returns binding,guidance,pending_count,context,source. Snapshot immutable;
only processed sources available. If no single-valued policy, disable implicit
current and report recency not inferred. Remove claims whose capped source
metadata is incomplete; mark dependencies_omitted if premises absent. Include
selection/dependencies/warnings/truncation/pending_count/valid_at/method as schema.
Source range slices body then appends whole code points under max_bytes; return
binding,id,sha256,start,text,truncated,processed:true. Never use unprocessed intake
as analyzed evidence. File view and provider view preserve these same boundaries.

JSONL launcher --instance PATH: first line opens read view with instance_id and
optional task; if omitted, next line supplies task. Subsequent round/context/
source/receipt/finish calls route to one session, each line <=1 MiB. Initial
result contains binding/guidance; later task-only initialization returns binding.
Per-line error output does not reset session or authorize writes. Reviewed learning
publication is a separate trusted adapter operation in TRANSACTIONS.
