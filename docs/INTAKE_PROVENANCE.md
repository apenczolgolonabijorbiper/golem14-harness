# Revision-aware producer recipe and source growth

This is producer/host guidance, not a connector service or core deduplication.
Run `node tools/intake-example.mjs` for a pure synthetic growth experiment. Its
buildIntake helper returns candidate observations plus receipts; it persists neither.

Upstream namespace + record + revision identifies a producer receipt. Source IDs
remain opaque UUIDs; exact UTF-8 observation bytes get SHA-256. Do not reuse an
observation ID for changed bytes. The same upstream revision with changed payload
is refused: investigate upstream correction semantics or assign a new legitimate
revision reference. Similar prose does not establish identical records.

Split at complete semantic revision/record boundaries. Every emitted observation
repeats record, revision, author and effective date (unknown when absent). Optional
origin_ref and event_date headers carry upstream context as data. These headers
are accepted by the current parser; they do not establish core group readiness,
source independence or a different asserted_at meaning. A record exceeding the
example's 4,000-character producer budget is refused, not cut mid-revision. A real
producer may split at smaller semantic sections with repeated headers; group
metadata/scheduling remains a separate gated proposal.

Persist receipt updates atomically with the intake observations in the host's
storage operation. Commit no receipts on partial failure; unchanged retries emit
nothing only after a successful receipt/intake commit. Do not confuse these
producer receipts with the processed-analysis ledger: newly ingested observations
are pending until a normal validated analysis completes.

The deterministic experiment fetches revisions [1,2], then [1,2,3], then [1,2,3].

| Strategy | Emitted observations | Unique revisions retained |
|---|---:|---:|
| Full-history resend | 8 | 3 |
| Receipt-based incremental | 3 (2, then 1, then 0) | 3 |

This reduces repeated intake by 5 observations in this fixture, preserving all 3
unique revisions. It is not a throughput benchmark or a measured consumer saving.
Repeated text across these sources is not independent corroboration. Different
origin IDs also do not prove independence. Claims still need exact quotations.

Tests cover missing identifiers, two namespaces with the same record number,
changed payload on a retained revision, unchanged retries, source hash/parse parity
and oversized records. Fetching linked records and selecting producer scope remain
application responsibilities. No consumer or private runtime is changed.
