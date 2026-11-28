# Initialization, source parsing and evidence indexing

## init

Node CLI: `node processor/init-instance.mjs --root PATH`.
Inputs: absent/empty absolute destination, optional profile-template boolean OR
reviewed profile bundle, optional purpose file, optional JSON result flag.
`--profile` and `--profile-from` conflict. Source validation follows PROFILE.
Result: destination string, or `{root,source}` where source metadata lists copied
paths/origins/exact hashes and best-effort Git revision/dirty (null if unavailable).
Effects: build a sibling temporary directory; create inbox, evidence, memory/events,
memory/runs, questions, instance, profiles; populate `fixtures/empty`'s
canonical files with one current millisecond UTC timestamp. Template selection
adds profiles/default.md and schema-1 config selecting it. Captured source bytes
override the matching template/default files. No Git repository is created.

```sudolang
Init(input) {
  Validate inputs and capture source bytes before touching destination
  Refuse linked destination or linked ancestors; refuse nonempty destination
  Stage all files; publish using directory rename
  If empty destination existed: remove only while still empty, then rename
  If publication fails: restore the prior empty directory if still absent
  Never reset an existing instance; never copy an old lease or ledger
}
```

Default text bytes (also in fixtures): purpose explains purpose/scope/language/
review priorities; index says no analyzed observations; queue says no questions.
Graph schema 2, ledger/queue/hypotheses schema 1 have empty collections and
updated_at; lease is `{schema_version:1,status:"idle",observation_ids:[]}`.

## parse-source (strict runtime)

Input canonical `inbox/UUID.md`, UTF-8 LF text. Require opening `---\n`, first
`\n---\n` delimiter; remaining text is body, preserved INCLUDING final newline.
Every header line must match `^([a-z_]+):\s*(.*?)\s*$`, no duplicates. Values
starting `"` are decoded as JSON; other values remain strings. Require strict
UUID matching basename, nonblank body and parseable recorded_at. Result is all
header fields plus path/body/sha256 of exact original UTF-8 text. Unknown header
keys are retained. CRLF is deliberately refused by this strict reader; the
indexer below accepts it. These readers are separate contracts, not aliases.

## index

Node CLI: `node processor/process.mjs --root PATH`.
Input `--root`. No inference, no Git, no cognition lease edits. Acquire a
nonblocking Node local-process bakery lock using a permanent private
`.golem-indexer-locks/` directory and one uniquely named PID/UUID register per
contender. Create an exclusive empty register (choosing), publish a positive
integer ticket followed by LF, then refuse while another live register is
choosing or has a lower (ticket, register-name) pair. On refusal remove only
one's own register. On completion remove only one's own register. Treat incomplete
register reads as choosing. Probe PID liveness; remove an individually identified
dead register only on ESRCH. EPERM and PID reuse fail closed. No shared lock inode
is replaced or stolen. A killed owner leaves a dead register recovered by the next
contender. This requires a local filesystem and one OS PID namespace/identity;
network filesystems and mixed Python/Node indexers on the same instance are not
supported. Contention fails with busy, exit 1. No inference or cognition lease edits.
Under lock, create evidence directory if missing; remove only reserved unpublished
`evidence/.golem-index-*.tmp`. Visit direct inbox `*.md` paths in filename order.
Hash original bytes, decode UTF-8 and normalize CRLF/CR to LF FOR PARSING ONLY.
Malformed delimiter prints `Malformed: NAME`, invalid permissive ID pattern
`[0-9a-fA-F-]{36}` prints `Invalid ID: NAME`; skip these and keep exit 0.
Headers use all matching lowercase key lines, last duplicate wins; ignore other
lines. This index format is intentionally more permissive than strict cognition.
If evidence/ID.json exists, preserve it byte-for-byte and skip even if source
changed; validation, not index, detects identity drift.

Produce evidence object in this exact key order: id, source_file (relative POSIX),
sha256, recorded_at, event_date, kind, text (trimmed body), interpretation
`not_inferred`. Absent optional fields are null. If question_id truthy, append
question `{id,text,source}`; question_text is JSON-decoded when possible, raw
string if invalid JSON, default empty string. Missing question_source is null.
Publish each file via same-directory exclusive temp, write/flush/fsync, atomic
replace; always remove temp if possible. Only after success print `Indexed: ID`.
I/O/Unicode failures exit 1; already published earlier files remain; retry safely.
A killed process may leave a temp; next lock owner removes it. Source files,
graph, processed ledger and cognition lease MUST remain byte-identical.
