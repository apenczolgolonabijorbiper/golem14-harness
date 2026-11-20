# Upgrading to 0.6.0

Replace the verified installed engine and preserve the external instance. Do not
initialize, rename files or rewrite graph/history as part of installation.

0.6.0 reads historical purpose/hypothesis paths and claim names. New instances use
instance/purpose.md, memory/hypotheses.json and optional profiles/default.md.
Read INSTANCE_LAYOUT.md before explicit relocation or mixed-version operation.
Duplicate role files fail closed. Retained claims keep their original fields and
classification values; use the neutral terminology on new claims only.

VI-010: Node fixtures use one Python launcher helper: GOLEM_PYTHON executable path,
otherwise py -3 on Windows or python3 elsewhere. The release builder supplies its
own interpreter by default. No shell-string splitting is used; paths with spaces
are supported. Interpreter failures identify the executable/arguments attempted.

VI-008: installer managed-block matching normalizes only CRLF versus LF for
comparison. An equivalent current block is byte-for-byte unchanged. Legacy-block
migration preserves the managed block's newline style and all surrounding bytes.
Whitespace/text edits beyond line endings still fail before writes. Tests include
LF, CRLF, migration, idempotency and refusal of real CRLF edits on every platform.

The local Git adapter limitations, graph size limits and host-owned inference/
ingestion responsibilities from 0.5.0 remain. Platform CI runs Linux, Windows and
macOS validation; actual results are recorded in the PR/release evidence.
