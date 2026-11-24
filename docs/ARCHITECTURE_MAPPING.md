# How this harness maps to Xemantic’s Golem XIV

Both projects draw on Stanisław Lem’s *Golem XIV*. Xemantic explores an autonomous
system that reasons over a persistent knowledge graph. This harness adopts
selected ideas in a host-driven workflow for processing observations, maintaining
source-grounded memory, and retrieving evidence for later analysis.

The upstream comparison follows Xemantic’s published architecture and stated
research goals.

- [Xemantic’s Golem XIV source repository](https://github.com/xemantic/golem-xiv)
- [Xemantic’s architecture overview](https://xemantic.com/ai/#golem-xiv)

| Concept | Xemantic’s Golem XIV | This harness |
|---|---|---|
| Cognition | A runtime executes Kotlin scripts with DSLs for remembering and researching facts. | The host LLM interprets observations using the packaged agent instructions and the [processing protocol](PROCESSING.md). The Python and Node tools handle indexing, retrieval, and validation. |
| Persistent graph memory | Neo4j stores the knowledge graph used during cognition. | The [JSON memory model](MEMORY_MODEL.md) stores sources, entities, and claims. An entity-valued claim represents a relation. Stable IDs and exact evidence quotes support provenance. |
| Context for later reasoning | Cognitions consult persistent memory and integrate additional information sources. | The host ingests finalized observations and can retrieve relevant claims with lexical matching and one graph hop. It can then inspect the cited source before drawing a conclusion. |
| Hypothesis and revision | Xemantic describes hypothesis formation and verification as research goals. | Claims can carry a hypothesis classification and explicit uncertainty. Corrections add replacement claims and retain history. The host assesses the evidence. |
| Metacognition | Xemantic describes reflection on earlier cognition and self-improvement loops. | Run journals, unresolved questions, and retained corrections give the host material for reviewing earlier runs. The packaged runtime has no autonomous self-improvement loop. |
| Execution and concurrency | Xemantic describes parallel autonomous cognitions. | The host schedules runs and supplies the storage adapter. The protocol specifies leases and atomic completion. The bundled CLI validates the candidate snapshot. |

The storage-independent boundary is specified in
[MEMORY_PROVIDERS.md](MEMORY_PROVIDERS.md). Harness owns logical validity and
retrieval meaning; the host selects/authorizes its provider and coordinates
publication. JSON/Git is one reference backend. The independent record-provider
conformance fixture exercises this boundary without any particular host product.

## Where an application plugs in

An application writes finalized observations to a private instance. The host
claims a batch, retrieves relevant context, and proposes graph changes. The
storage adapter stages those changes with the ledger and questions, invokes
validation against the prior committed graph, and publishes the candidate
atomically. Later runs can reuse that memory and see how a claim changed.

For example, an engineering application can submit a synthetic issue and its
associated code change as separate observations. The host can retain what the
issue requested, what the change actually did, and what a later review corrected.
The same pattern works for other domains with different source types and host
instructions.

## Question-driven cognition

The application submits a bounded question/goal and linked conversation messages.
The host binds committed memory and selected guidance, supplies bounded context
and original source reads, and dispatches the executor/LLM. The model recognizes
intent, reasons across premises, returns an answer or linked clarification/check
questions, and may separately propose reviewed hypothesis learning. The Harness
validates integrity; the host retains results and controls authorization and CAS
publication. Read-only tasks do not claim observation batches or mutate memory.
See [the portable protocol](COGNITIVE_TASKS.md).
