import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseSource, run} from '../processor/memory-tool.mjs';
import {harness, python} from './test-fixtures.mjs';

const packPath = 'profiles/templates/software-development-tfs-git';
const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const timestamp = '2026-01-04T00:00:00Z';

function writeFixture(root, observations, expected) {
  const write = (path, data) => writeFileSync(join(root, path), JSON.stringify(data, null, 2) + '\n');
  const sources = new Map(Object.entries(observations).map(([key, {kind, lines}], index) => {
    const id = '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
    const path = `inbox/${id}.md`;
    const text = `---\nid: ${id}\nrecorded_at: ${timestamp}\nkind: ${kind}\n---\n${lines.join('\n')}\n`;
    writeFileSync(join(root, path), text);
    const {sha256, recorded_at} = parseSource(path, text);
    return [key, {id, path, sha256, recorded_at}];
  }));
  write('memory/processed.json', {
    schema_version: 1,
    observations: Array.from(sources.values(), s => ({
      id: s.id, status: 'processed', source_file: s.path, source_sha256: s.sha256,
    })),
  });
  write('memory/graph.json', {
    schema_version: 2,
    updated_at: timestamp,
    sources: [...sources.values()],
    entities: Object.entries(expected.entities).map(([id, e]) => ({
      id, kind: e.kind, type: e.kind === 'person' ? 'person' : 'other', label: id,
      aliases: [], uncertainty: [], created_at: timestamp,
      source_ids: e.observations.map(key => sources.get(key).id),
      ...(e.external_id ? {external_ids: [e.external_id]} : {}),
    })),
    claims: Object.entries(expected.claims).map(([id, c]) => ({
      id: 'clm-' + id, subject_id: c.subject, predicate: c.predicate, object: c.object,
      attributed_to_id: c.attributed_to, classification: expected.classification,
      sources: [{observation_id: sources.get(c.observation).id, quote: c.quote}],
      asserted_at: timestamp, created_at: timestamp, status: 'active', supersedes: [], uncertainty: [],
      valid_time: {
        from: c.interval?.[0] ?? null, to: c.interval?.[1] ?? null, expression: null,
        precision: c.interval ? 'exact' : 'unknown',
      },
    })),
  });
}

test('copied software development template loads offline and validates both fixture graphs', async t => {
  const base = mkdtempSync(join(tmpdir(), 'golem-software-profile-'));
  t.after(() => rmSync(base, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}));
  const source = join(base, 'app-guidance');
  const root = join(base, 'instance');
  const plain = join(base, 'plain');
  const init = join(harness, 'processor/init-instance.py');
  const cli = (command, ...args) => run([command, '--root', root, ...args]);

  cpSync(join(harness, packPath), source, {recursive: true});
  if (existsSync(join(harness, 'RELEASE.json'))) {
    const {files} = readJson(harness, 'RELEASE.json');
    for (const path of [
      'README.md', 'golem.config.json', 'profiles/core.md', 'profiles/work-items.md',
      'profiles/git-history.md', 'profiles/chat.md', 'profiles/vocabulary.json',
      'fixtures/observations.json', 'fixtures/expected.json',
    ]) {
      assert.equal(files[`${packPath}/${path}`],
        createHash('sha256').update(readFileSync(join(source, path))).digest('hex'));
    }
  }
  const core = join(source, 'profiles/core.md');
  writeFileSync(core, readFileSync(core, 'utf8')
    .replace('REPLACE_TRACKER_SCOPE', 'demo-org')
    .replace('REPLACE_REPOSITORY_SCOPE', 'demo-repo')
    .replace('REPLACE_REPOSITORY_REGISTRY', 'demo-registry'));

  python([init, '--root', plain]);
  cpSync(join(source, 'profiles'), join(plain, 'profiles'), {recursive: true});
  assert.equal((await run(['profile-check', '--root', plain])).state, 'none');
  python([init, '--root', root, '--profile-from', source, '--node', process.execPath]);
  assert.equal((await cli('profile-check', '--source', source)).comparison.state, 'in-sync');

  const observations = readJson(source, 'fixtures/observations.json');
  const expected = readJson(source, 'fixtures/expected.json');
  writeFixture(root, observations, expected);
  const inspection = await cli('profile-check');
  assert.equal(inspection.state, 'selected');
  assert.equal(inspection.graph.available, true);
  for (const {kind, section} of Object.values(observations)) {
    assert.deepEqual(inspection.batches.rows.find(row => row.kind === kind)?.section_ids, [section]);
  }
  assert.ok(inspection.selectors.rows.every(selector => selector.unseen.length === 0));
  assert.deepEqual((await cli('profile-check', '--kinds', 'unknown')).batches.rows[0].section_ids, []);
  for (const name of ['kinds', 'predicates']) {
    assert.equal(inspection.vocabulary[name].used_but_undeclared.total, 0);
    assert.equal(inspection.vocabulary[name].declared_but_unused.total, 0);
  }
  const vocabulary = readJson(source, 'profiles/vocabulary.json');
  for (const list of [vocabulary.kinds, vocabulary.predicates, vocabulary.single_valued,
    vocabulary.external_id_schemes, ...vocabulary.external_id_schemes.flatMap(s => s.prefixes ? [s.prefixes] : [])]) {
    assert.ok(list.length > 0);
  }

  for (const [query, id] of [['17', 'item-17'], ['WI-17', 'item-17'], ['WI-21', 'item-legacy']]) {
    assert.ok((await cli('context', '--query', query)).entities.some(e => e.id === id));
  }
  for (const [scope, value, ids] of [
    ['demo-org', '17', ['item-17']], ['demo-org', 'WI-17', []],
    ['demo-org', 'WI-21', ['item-legacy']], ['demo-org', '21', []],
    ['demo-other', '17', ['other-item-17']],
  ]) {
    const context = await cli('context', '--scheme', 'tracker', '--namespace', scope, '--external-id', value, '--hops', '1');
    assert.deepEqual(context.entities.filter(e => e.external_ids?.some(
      x => x.scheme === 'tracker' && x.namespace === scope && x.value === value)).map(e => e.id), ids);
    if (!ids.length) assert.deepEqual(context.entities, []);
  }
  const validate = async classification => {
    const result = await cli('validate');
    assert.equal(result.valid, true);
    assert.deepEqual(result.warnings.map(({code, object_id}) => ({code, object_id})), expected.warnings);
    const survey = await cli('vocabulary-survey', '--single-valued', 'has_state');
    assert.equal(survey.intervals.rows.find(row => row.subject_id === 'item-17' &&
      row.predicate === 'has_state')?.classification, classification);
  };
  await validate('history');

  const variant = expected.overlap_variant;
  const row = expected.claims[variant.claim];
  const input = observations[variant.observation];
  const index = input.lines.indexOf(row.quote);
  assert.notEqual(index, -1);
  input.lines[index] = variant.quote;
  row.quote = variant.quote;
  row.interval[0] = variant.from;
  writeFixture(root, observations, expected);
  await validate('overlap');
});
