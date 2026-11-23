# Memory-backed cognitive tasks (protocol v1)

This is the portable question/goal-driven entry point, separate from observation
processing in PROCESSING.md. A search response is context, not an answer. The
executor uses inference to produce concise findings and an answer. No private
reasoning transcript is required. Empty inboxes are valid; reading existing
memory does not process observations, close durable questions or acquire a write
lease. Answers remain useful without any memory changes.

## Ownership and capabilities

| Component | Responsibility |
|---|---|
| Harness | Task/message/intent meanings, bounded retrieval and provenance rules, prompts, schemas, validators and conformance assets |
| Host | Authenticate, authorize reads/actions, choose provider, capture immutable snapshots and guidance, retain conversation/results/receipts, dispatch local or remote inference, cancel/schedule/resume, publish authorized changes using CAS |
| Executor (Golem cognition) | Interpret intent, resolve ambiguity, retrieve/inspect evidence, reason, propose answers, hypotheses and clarification/check questions |
| Application/user | UX, domain policy, authorize collection and external actions; answer questions in any order |

Negotiate `cognitive-task-v1`, `cognitive-context-v1`, `cognitive-result-v1` and,
only for proposed learning, `learning-hypothesis-v1`. Refuse unsupported versions
rather than reinterpret another API (including a host's existing ask endpoint).
MCP, HTTP and a particular host implementation are optional bindings. No host
package, configuration, filesystem layout, model service or embedding is required.

`binding = {instance_id, snapshot_id, guidance_id}` uses opaque host/provider
identities. Purpose and selected profile/configuration are bound by the existing
guidance identity. Hosts must scope identities to the authorized instance and
retain the exact source bytes, claim history and guidance for that snapshot.
Expiry, retention and cursor lifetimes are host policy; expired reads fail and
start an explicitly rebound continuation. This read view is an additive consumer
of the provider architecture planned in #70–#72, not a competing storage format.
Implementations of that architecture must preserve these identity and read
semantics. No Git SHA, graph path or whole graph is passed to the neutral core.

## Task and conversation

`schemas/cognitive-task.schema.json` requires a task ID, conversation ID, binding,
mode, bounded messages, scope and limits. Subject IDs narrow the intended topic;
they do not replace host access control. `scope.valid_at` is an explicit UTC
as-of date or null for the snapshot's current evidence. The selected profile
remains authoritative for single-valued/temporal policies.

Messages have stable IDs, author, kind, text, `reply_to[]` and an intent. Reply
links point to earlier messages in the delivered bounded transcript. A host
supplies referenced parent messages when paging conversation history; omitted
parents are not guessed. Links may form branches, several replies can answer one
question, and one reply can address several questions. No alternating-role or
one-question/one-answer rule applies. For example:

| ID | Kind | Author | reply_to |
|---|---|---|---|
| u1 | user_request | user | [] |
| g1 | cognitive_question | golem | [u1] |
| g2 | cognitive_question | golem | [u1] |
| u2 | question_answer | user | [g2] |
| u3 | question_answer | user | [g1, g2] |
| g3 | answer | golem | [u1, u2, u3] |

`user_question` asks Golem; `user_request` expresses a goal; `question_answer`
is a user's linked reply. `cognitive_question` is a question Golem raises while
reasoning, including checks of hypotheses; `collection_request` asks the
application for evidence/action. `hypothesis`, `clarification`, `correction` and
`answer` remain separate message kinds. A collection request is data, not an
executable command. A reply does not close a durable memory question until the
normal observation/analysis/publication procedure validates its evidence.

An intent records `category`, `origin`, `basis`, `description`, `uncertainty[]`.
Categories are ask, explain, compare, verify, plan, request_action, clarify,
correct, explore and unknown. `basis` distinguishes explicit, inferred and
unknown. Inferred classifications require uncertainty. No numeric confidence
is fabricated. Domain-specific routing may use the description and profile;
these portable categories are not an exhaustive domain ontology.

The host may record an explicit user intent, but semantic interpretation is
Harness-guided cognition. Golem may infer several distinct purposes in successive
linked messages, ask to confirm an ambiguous intent, or form its own verify or
clarify intent. A task may also start with Golem hypothesis/check messages and no preceding user
question; the host schedules it under its existing policy and finite limits.
An inferred intent grants **no** action/write permission. A
host can use it to propose routing; authorization is an independent host decision.

## Procedure for local and remote executors

1. Validate/negotiate the task. Bind purpose/profile, authorized snapshot and
   scope. Recognize intent; clarify ambiguities that change the answer or action.
2. Begin a bounded round. Plan exact scoped identity/entity/predicate and temporal
   retrieval first; use lexical fallback when identity is not known. Labels are
   not unique identities. Inspect conflicting values and superseded premises.
3. Request bounded context, then read original cited sources. Expand dependencies
   using `claim_ids` and further bounded requests. Preserve truncation, pending
   intake and temporal uncertainty. A zero-hit search is not proof of absence.
4. Reason across premises. Distinguish source assertions, derived conclusions,
   hypotheses and general model knowledge. State uncertainty and alternatives.
   Generated answers and repeated prose are not independent corroboration.
5. Stop on completion, missing evidence, budget, cancellation, stale guidance or
   stale snapshot. Return an answer, partial answer or insufficient-evidence
   result, including concise findings, evidence locators and explicit follow-ups.
   A result question can cite finding premises and earlier message IDs.
6. In `propose_learning`, optionally return a **separate** learning proposal.
   `read_only` forbids proposals. Neither mode authorizes external actions.
   Do not invent observation/ledger completion for existing-memory reads.

The host retains the task result outside canonical memory and can append its
questions as linked conversation messages. A new invocation has fresh finite
limits and an explicitly selected retained or rebound snapshot. Replies can
arrive in any order. Budgets never renew themselves; there is no autonomous
unbounded loop. Resume only with host scheduling and applicable authorization.

## Bounded read interface and receipts

`createCognitiveSession(task, view)` uses an immutable `view` with `binding`,
`pending_count`, asynchronous `context(options)` and `source(id, range)`.
The host must authenticate/scoped-bind the view and retain its delivery receipt;
executor output must never supply or amend that trusted receipt.

Context options reuse memory-tool `query`, `entity_id`, `source_id`, `predicate`,
`type`, `kind`, `status`, `hops`, `external_id`, `scheme`, `namespace`, `limit` and `current`;
`claim_ids[]` adds exact dependency follow-up (at most 100). Temporal selection
precedes exact-ID narrowing. Set `current:false` to inspect historical premises;
explicit as-of scope still applies. Task limits cap each
claim response, expansion work, cumulative context/source requests, source bytes,
rounds and elapsed time. Providers must honor these bounds and bound I/O in their
own implementation. JSON reference loading still has its documented whole-file
costs. Context warnings and truncation do not assert exhaustive relevance.

A bundle includes binding, claims/entities, source hashes, claim dependencies,
retrieval method, warnings, truncation reasons, pending count and temporal scope.
Source reads use UTF-16 body offsets (`start`, `length`, at most 16,000 units)
and a cumulative UTF-8 byte budget, retaining exact original source-file SHA-256.
The provider returns the same source hash and exact body segment from the pinned
snapshot. Missing/changed sources and mixed bindings fail. Partial segments stay
marked truncated. Pending intake is counted separately and cannot be cited as an
analyzed claim. Explicit raw-intake cognition requires a future negotiated
capability; v1 fails closed rather than silently indexing it.

`beginRound`, `context`, `source`, `receipt` and `finish` implement the session.
The host supplies cancellation/deadline checks; providers/transports must support
timeouts for blocked I/O. `finish` attaches measured usage before deterministic
validation. Cancellation and budget results may carry partial findings but cannot
claim complete success. Requests need fresh host authorization after expiry.

The reference adapter's JS `openCognition({instance_id})` captures one committed
Git tree, including committed guidance and sources, through its existing snapshot
reader. Dirty working files are excluded. `createMemoryReadView` reuses
`retrieveContext` and full memory/hypothesis validation inside the JSON backend.
Current selection is evaluated at the captured graph's update timestamp for
repeatability. Without single-valued policy it reports that recency was not
inferred. As-of filters retain existing temporal semantics. This is independent
of any named host. `processor/cognitive-tool.mjs --instance INSTANCE` exposes a
read-only JSON-lines binding for local/remote agents; its first line contains
`{instance_id}` to discover binding and bound guidance, then `{task}` (or both in the first line), then operations round/context/source/receipt/finish. It
never dispatches a shell command or publishes learning.

## Answer integrity versus meaning

`validateResult(result, task, trustedReceipt)` checks version/shape, task, instance,
snapshot/guidance binding, unique IDs, delivered claim references, exact immutable
source hashes/body locators/quotes, dependency cycles, provenance classifications,
usage and coverage. Derived findings name premise finding IDs; source assertions
require claims plus original evidence. General model knowledge cannot claim
memory provenance. Hypotheses require uncertainty. Semantic assessment still
checks entailment, relevance, evidence independence, completeness and whether the
answer actually addresses the intent. Passing a validator does not establish
truth. Do not store private deliberation; concise findings suffice.

Model provenance records requested/observed identity, configuration and known
cost. Unknown fields remain null. No model identity is inferred from answer style.

## Reviewed learning without forged evidence

`schemas/cognitive-learning.schema.json` supports `add_hypothesis` and
`correct_hypothesis`. A proposal preserves existing claim dependencies as
support/refutation, uncertainty, rationale and verification needed. Novel derived
conclusions stay hypotheses pending verification; v1 does not publish newly
asserted/corroborated factual claims from answer text. Existing-source quotes,
assertion dates, graph/ledger parity and source histories remain unchanged.

The additive host adapter capability `learning-hypothesis-v1` publishes a reviewed
proposal with `expected binding` and a trusted authorization decision. Existing
user/policy authorization can suffice: no mandatory second approval is added.
The reference JS method is `publishLearning({task,proposal,authorization})`, where
`authorization` includes `allowed:true`, matching task/proposal IDs and an optional
retained policy/user reference. The application, not the model, supplies it.

The adapter revalidates the current snapshot/guidance, checks authorization and
premises, rejects an active processing lease and dirty target files, validates
all canonical memory/history, then atomically publishes the hypothesis and receipt
against fresh HEAD. It neither processes sources nor changes the ledger/lease.
Rationale, verification and full proposal persist in `memory/learning/<id-hash>.json`.
Retries with the same ID and payload return the receipt without repeating evidence;
a changed retry fails. Identical statements under new IDs are rejected. A
correction withdraws the old hypothesis without changing its statement/support,
adds a new ID, and retains both the old hypothesis and publication receipts.
Premise status changes require review; they do not silently rewrite conclusions.

`hypothesis-unknown-confidence-v1` explicitly extends hypotheses schema v1 to
permit `confidence:null` (unknown) with uncertainty in existing `confidence_basis` and the retained proposal. Existing numeric confidence
keeps its meaning. Negotiate this capability before consuming such records; old
validators must not be used for this additive format. This changes no source or
graph schema and requires no migration/reset of supported memory.

See COGNITIVE_CONFORMANCE.md for vendor tests and honest model-evaluation coverage.
