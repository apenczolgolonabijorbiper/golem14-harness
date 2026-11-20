# Target instance layout (0.7.0)

The cognitive memory is application-agnostic. A persona is an optional profile.

| Role | Path |
|---|---|
| Purpose, scope, language and review priorities | instance/purpose.md |
| Hypothesis records, validated with hypotheses schema version 1 | memory/hypotheses.json |
| Source-grounded graph, schema version 2 | memory/graph.json |
| Selected profile (example) | profiles/default.md |
| Processed ledger / processing lease / question queues | memory/processed.json / memory/processing-lock.json / questions/ |

resolveLayout checks required canonical files and reports purpose_path and
hypotheses_path. No historical persona-path resolution or --legacy-layout mode is
provided. Initialize a fresh empty instance; incompatible previous instances may
be scrapped rather than converted. Do not automatically delete a user's data.

Graph claims use attributed_to_id with source_assertion, hypothesis or corroborated.
Historical speaker_id/classification aliases are not supported in graph v2.
Purpose instructions do not grant permissions or weaken provenance checks.
Hypotheses use explicit support/refutation, confidence and analyst/model metadata;
see MEMORY_MODEL.md for required fields, bounds and direct dependency warnings.
