# Capacity measurement and supported envelope

The target graph has 10,000 source slots, 5,000 entities and 20,000 claims. The
source maximum is a measured item envelope, not unlimited retention or a promise
that arbitrary-size payloads fit. No segmentation/archival mechanism is added.
The graph itself and all referenced sources must fit host memory. The reference
Git adapter additionally caps each raw child output at 64 MiB, so the complete
committed tree must fit its raw batch envelope. Do not store unrelated large
artifacts in a dedicated instance repository.

Reproduce from the maintainer checkout or the staged release:

```sh
node tools/benchmark-capacity.mjs 500,2000,5000,10000 256
node tools/benchmark-capacity.mjs 2000 2048
```

Each case creates synthetic external data and cleans it afterward. All cases use
5,000 entities and 20,000 claims with exact source provenance. The CLI baseline
contains N-1 processed observations; a real adapter candidate validates and commits
the Nth observation. In-memory validation uses N and checks the previous graph.
CLI validate/stats/context each execute twice in fresh Node processes. Labels cold
and warm mean first/repeated call, not a flushed OS disk cache (fixture setup/Git
has already touched files). Nominal body sizes are 256 or 2,048 characters; these
are not large-diff or maximum-size-quotation stress fixtures.

The script prints one JSON line per case: platform/Node, source and body counts,
validation/retrieval times, CLI output bytes, candidate validation/commit times,
working-tree validation time and parent peak RSS. Node does not expose portable
child peak RSS here; parent peak is process-wide/cumulative and is NOT combined
parent+validator memory. Byte/heap limits must be reviewed for a real deployment.
No universal workstation completion-time guarantee is made.

Local Linux pre-release measurements (Node 24.22.3, small notes) observed roughly
1.2/1.5/2.3/3.7 seconds for full CLI validation at 500/2,000/5,000/10,000 source
scenarios. Candidate validation/commit at 10,000 took about 5.1/5.9 seconds;
parent peak was about 453 MiB. A later nominal-256 run observed 3.4/3.5 seconds
first/repeated CLI validation and 5.2/6.2 seconds candidate validation/commit with
parent peak about 510 MiB. The 2,000-source 2,048-character probe observed about
1.8 seconds CLI validation and 2.9/3.1 seconds candidate validation/commit.
These runs preceded the final warning-output summary and working-tree timing
addition. Final platform evidence and the exact tested revision are recorded in
the implementation PR; unrun host results are not implied by these local numbers.

The capacity CI job runs Linux and Windows, separately from packaged correctness
checks. Accept the chosen maximum only when all cases complete within existing
60-second child deadlines and candidate validation succeeds on both platforms.
Use per-platform output for final release evidence. The fixed 20-minute CI job
budget is runner-specific, not a workstation performance claim.

Git candidate snapshots use one ls-tree and one binary-length-framed cat-file
batch per immutable tree. This replaces process-per-blob capture. Existing tests
cover raw LF/CRLF bytes, staged work, changed sources, concurrent heads, failed
candidates and post-CAS recovery. At most two snapshots are retained per adapter.
Collection limits/near-limit warnings come from the graph schema, not a profile.
Observe warnings at 80%; maximum+1 fails before completion publication.
