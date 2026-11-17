# Release history

## 0.4.1 — Node 24 action runtimes

The release workflow now uses actions/checkout v7.0.1, actions/setup-node v7.1.0
and actions/setup-python v7.1.0. Their action metadata declares Node 24, removing
the Node 20 deprecation migration warning. The harness continues to build with
Node 24 and Python 3.12. This patch retains the 0.4.0 host integration and runtime
contracts.

## 0.4.0 — ChatGPT Work and Codex integration

- Guided instance setup for ChatGPT Work, Codex CLI and Codex Desktop uses a
  shared procedure, host entry points and a reusable application setup record.
- The Codex installer shares release verification and application integration
  logic with Cursor. Existing generated Cursor blocks can adopt the shared
  wording, and installer tests cover both host orders and no-op reruns.
- The folder guide explains application, installed engine and instance data
  paths, in-project or external storage, backup and deliberate sharing.
- Runtime memory/schema and processing transaction contracts remain compatible
  with 0.3.1. Local installer and release tests pass. Live client discovery,
  conversational setup and adapter-backed processing acceptance remain tracked
  in issue #4, with Cursor MDC exploration in issue #6.

## 0.3.1 — Architecture mapping

The distribution now includes a guide mapping its architecture to the concepts
in Xemantic’s Golem XIV.

## 0.3.0 — Standalone baseline

The runtime source is maintained directly in this repository. A deterministic
builder replaces the historical extraction workflow.

## 0.2.3 — Observation identity and portability

- VI-006 explains why separately recorded notes with identical text retain
  distinct IDs and how hosts can prevent accidental resends.
- VI-007 documents re-analysis for inbox/evidence-only transfers and distinguishes
  it from whole-instance recovery. Selective transfer of processed analysis
  remains future work for the transactional adapter.
- Release fixtures verify distinct evidence for identical text and pending status
  after an inbox/evidence-only restore.

## 0.2.2 — Claim validation

- VI-003: Any existing entity type may serve as a claim speaker.
- VI-004: Missing claim references identify the claim, field and entity ID.
- VI-005: The memory model documents claim provenance and timestamp matching.
  Regression fixtures cover both rules and guard the diagnostic reference.

## 0.2.1 — Processing validation

- VI-001: Stage processed ledger rows before validating the candidate snapshot.
  Publish the graph and ledger together in the atomic completion transaction.
- VI-002: The CLI puts the first violation on the failure header line and
  retains the complete multiline list on stderr, with a nonzero exit status.

## 0.2.0 — Cursor bootstrap

Added an explicit Cursor installer that verifies a clean release, installs an
unchanged engine in vendor/golem-harness, appends root agent instructions with
external instance paths and creates an alwaysApply .cursor/rules entry. Existing
instructions/rules survive; conflicts require review. The engine remains together
for integrity verification and release replacement. Moving its internals into
tool-specific instruction folders would complicate both, so was rejected.

Installation is an explicit bootstrap operation, separate from forbidden engine
development. Runtime initialization remains a separate command and does not run
implicitly. Tests cover preservation, idempotency, instruction conflict refusal,
damaged-engine rejection and unchanged source engine bytes. Interrupted first
copies may require manual cleanup; no transactional multi-file installation is
claimed. Rules are agent guidance, not filesystem access controls. Official Cursor
documentation retrieval failed during this task; no version-specific discovery
guarantee is claimed. The owner verifies the rule in a fresh local session.

