# Upgrading to 0.6.0

Replace the verified installed engine and preserve the external instance. An
upgrade is a complete directory replacement, not an extraction over the old tree:

1. Stop active harness processing. Back up the engine and external instance.
2. Verify the new ZIP checksum and extract it into a fresh temporary directory.
3. Move the entire old vendor/golem-harness directory outside the vendor path,
   then place the extracted golem-harness directory at that exact path.
4. Remove obsolete engine-only files from the installed path, including historical
   release-tools/. Do not copy old engine internals into the new tree. Keep any
   local application work for manual review outside the engine.
5. Run the host installer with its existing repository/instance settings and run
   memory-tool validate against the existing external instance. Verify RELEASE.json
   file hashes and refuse unexpected installed engine files. Keep the backup until
   the application smoke check succeeds; restore it if installation fails.

The replacement concerns only the engine directory. Preserve the consuming repo,
its host instructions, configuration and external instance data. Do not
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

Windows CI also exposed a textual repository-root comparison failure. The reference
adapter now compares resolved directory identity (device/inode), accepting equivalent
Windows path spellings while still refusing a data subdirectory of another Git root.
