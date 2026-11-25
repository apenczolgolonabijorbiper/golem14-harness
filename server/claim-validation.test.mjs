import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMemory} from './memory-model.mjs';

const timestamps = ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'];

function fixture() {
  const observations = timestamps.map((recorded_at, index) => {
    const id = `00000000-0000-4000-8000-00000000000${index + 1}`;
    return {id, recorded_at, path: `inbox/${id}.md`, sha256: 'a'.repeat(64)};
  });
  const ids = observations.map(source => source.id);
  const created_at = timestamps[1];
  const entities = ['subject', 'speaker', 'object'].map(label => ({
    id: `ent-${label}`, label, aliases: [], type: 'other', source_ids: [...ids],
    created_at, uncertainty: [],
  }));
  const claim = {
    id: 'clm-record', subject_id: 'ent-subject', attributed_to_id: 'ent-speaker',
    predicate: 'references', object: {entity_id: 'ent-object'},
    classification: 'source_assertion', status: 'active', supersedes: [], uncertainty: [],
    sources: ids.map(observation_id => ({observation_id, quote: 'Synthetic record'})),
    asserted_at: timestamps[0], valid_time: {from: null, to: null, expression: null, precision: 'unknown'},
    created_at,
  };
  const graph = {schema_version: 2, updated_at: created_at, sources: observations, entities, claims: [claim]};
  const sources = Object.fromEntries(observations.map(source => [source.id, {...source, body: 'Synthetic record'}]));
  const ledger = {schema_version: 1, observations: observations.map(({id, path, sha256}) => ({
    id, source_file: path, source_sha256: sha256, status: 'processed',
  }))};
  return {graph, claim, sources, ledger, queue: {schema_version: 1, questions: []}};
}

test('any existing entity type can be a speaker', () => {
  const state = fixture();
  for (const type of ['person', 'place', 'event', 'organization', 'other']) {
    state.graph.entities[1].type = type;
    assert.deepEqual(validateMemory(state.graph, state), []);
  }
});

test('missing claim references identify their fields without cascading provenance errors', () => {
  for (const field of ['subject_id', 'attributed_to_id', 'object.entity_id']) {
    const state = fixture();
    if (field === 'object.entity_id') state.claim.object.entity_id = 'ent-missing';
    else state.claim[field] = 'ent-missing';
    assert.deepEqual(validateMemory(state.graph, state), [
      `Claim entity not found: clm-record (${field} ent-missing)`,
    ]);
  }
});

test('each referenced entity must include every cited source', () => {
  for (let index = 0; index < 3; index++) {
    const state = fixture();
    state.graph.entities[index].source_ids.pop();
    assert.deepEqual(validateMemory(state.graph, state), ['Entity provenance does not include claim source: clm-record']);
  }
});

test('asserted_at copies the exact timestamp from any cited source', () => {
  const state = fixture();
  state.claim.asserted_at = timestamps[1];
  assert.deepEqual(validateMemory(state.graph, state), []);
  state.claim.asserted_at = timestamps[1].replace('.000', '');
  assert.deepEqual(validateMemory(state.graph, state), ['Assertion timestamp must match a source: clm-record']);
});

test('integrity diagnostics have a documented explanation', () => {
  const model = readFileSync(new URL('./memory-model.mjs', import.meta.url), 'utf8').replaceAll('\r\n','\n');
  const docs = readFileSync(new URL('../docs/MEMORY_MODEL.md', import.meta.url), 'utf8').replaceAll('\r\n','\n');
  const integrity = model.split('export function validateMemory(')[1].split('const terms=')[0];
  const reference = docs.split('## Validation rules\n')[1];
  const diagnostics = [...integrity.matchAll(/\bfail\(([^\n]+?)\);/g)];
  assert.ok(diagnostics.length > 0);
  for (const [, expression] of diagnostics) {
    const prefix = expression.replace(/^name\+': /, "'").match(/['"`]([^'"`:$]+)/)?.[1]?.trim();
    assert.ok(prefix && reference.includes('`' + prefix + '`'), `Undocumented diagnostic: ${expression}`);
  }
});

test('processed row duplicates are distinct from source integrity failures', () => {
  const state = fixture(), row = state.ledger.observations[0];
  assert.deepEqual(validateMemory(state.graph, state), []);
  state.ledger.observations.push(structuredClone(row));
  assert.deepEqual(validateMemory(state.graph, state), ['Duplicate processed row: ' + row.id]);
  state.ledger.observations.pop();
  for (const [field, value] of [['status','pending'], ['source_file','inbox/wrong.md'], ['source_sha256','b'.repeat(64)]]) {
    const bad = structuredClone(state);
    bad.ledger.observations[0][field] = value;
    assert.deepEqual(validateMemory(bad.graph, bad), ['Ledger source mismatch: ' + row.id]);
  }
  delete state.sources[row.id];
  assert.ok(validateMemory(state.graph, state).includes('Ledger source mismatch: ' + row.id));
});
