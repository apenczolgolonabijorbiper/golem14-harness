# Golem XIV Harness 0.6.0

New instances now describe a memory's purpose and scope without requiring a persona.
Persona-oriented memory remains an optional application profile. The core remains
application-agnostic, with source-grounded entities, claims, corrections, hypotheses
and host-owned inference.

## Neutral defaults with historical compatibility

- New paths: instance/purpose.md, memory/hypotheses.json and, when selected,
  profiles/default.md. Existing persona/identity.md and persona/hypotheses.json
  remain supported with no runtime rename, duplicate or initialization step.
- resolveLayout and memory-tool validate expose the selected purpose/hypotheses
  paths. Duplicate role files fail closed for explicit resolution.
- New claims use attributed_to_id and source_assertion/hypothesis/corroborated.
  Existing speaker_id/user_declaration/independently_confirmed records remain
  valid, including mixed old/new graphs. Retrieval, provenance and warnings
  understand aliases; previous-graph validation protects retained spellings/fields.
- Old readers cannot assume the neutral layout or accept the new claim vocabulary.
  Keep historical forms if older tools must coexist until all readers are upgraded.
  An optional --legacy-layout initializer flag applies only to NEW empty instances.

## Portability fixes

- VI-008: the installer accepts line-ending-equivalent LF/CRLF managed blocks.
  Current blocks stay byte-identical, legacy migration preserves newline style
  and prefix/suffix bytes, and substantive edits still fail before writes.
- VI-010: one Python launcher helper uses GOLEM_PYTHON executable path, otherwise
  py -3 on Windows or python3 elsewhere. The release builder supplies its own
  interpreter unless overridden. Paths with spaces do not use shell splitting;
  failures identify the attempted executable and arguments.
- A platform validation workflow exercises the default fixture launcher and full
  packaged build on Linux, Windows and macOS. Actual outcomes are linked from #16.

## Upgrade and validation

Replace the verified installed engine and preserve external data. Do not initialize
an existing instance or rewrite historical claims. See INSTANCE_LAYOUT.md and
UPGRADE_0_6.md for layout resolution, explicit relocation and mixed-version limits.
Graph/source limits and the local Git adapter's storage/concurrency scope are
unchanged. No new scheduler, ingestion connector or inference service is added.

Local release checks pass 43 Node tests, four Python unittest cases and the
Cursor/Codex installer regression scripts. New tests cover neutral and legacy
instances, mixed claim names, conflicting layouts/attribution, exact history,
launcher selection, LF/CRLF migration and no-op preservation. CI and downloaded
release verification are recorded separately in #16; unrun host acceptance is
not implied by unit/integration tests.
