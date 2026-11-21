"""Check observation identity and what an inbox/evidence-only restore preserves."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

PROCESSOR = Path(__file__).resolve().parent


class ObservationPortabilityTest(unittest.TestCase):
    def setUp(self):
        self.work = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.source = self.work / 'source'
        self.run_python('init-instance.py', '--root', self.source)
        self.ids = []
        for day in (1, 2):
            source_id = f'00000000-0000-4000-8000-{day:012d}'
            self.ids.append(source_id)
            recorded_at = f'2026-01-0{day}T00:00:00.000Z'
            note = f'---\nid: {source_id}\nrecorded_at: {recorded_at}\n---\n\nSame synthetic text.\n'
            (self.source / 'inbox' / f'{source_id}.md').write_bytes(note.encode('utf-8'))
        self.run_python('process.py', '--root', self.source)

    def run_python(self, script, *args):
        subprocess.run([sys.executable, str(PROCESSOR / script), *map(str, args)],
                       check=True, capture_output=True)

    def stats(self, root):
        result = subprocess.run(
            ['node', str(PROCESSOR / 'memory-tool.mjs'), 'stats', '--root', str(root)],
            check=True, capture_output=True, text=True,
        )
        return json.loads(result.stdout)['totals']

    def test_equal_bodies_remain_distinct_observations(self):
        evidence = [
            json.loads((self.source / 'evidence' / f'{source_id}.json').read_bytes())
            for source_id in self.ids
        ]
        self.assertEqual(evidence[0]['text'], evidence[1]['text'])
        self.assertEqual([row['id'] for row in evidence], self.ids)
        for row in evidence:
            self.assertEqual(row['sha256'], hashlib.sha256(
                (self.source / row['source_file']).read_bytes()
            ).hexdigest())
        self.assertNotEqual(evidence[0]['sha256'], evidence[1]['sha256'])
        self.assertEqual(self.stats(self.source)['pending'], 2)

    def test_inbox_and_evidence_restore_leaves_sources_pending(self):
        source_id = self.ids[0]
        row = json.loads((self.source / 'evidence' / f'{source_id}.json').read_bytes())
        graph_path = self.source / 'memory/graph.json'
        ledger_path = self.source / 'memory/processed.json'
        graph = json.loads(graph_path.read_bytes())
        ledger = json.loads(ledger_path.read_bytes())
        graph['sources'].append({
            'id': source_id, 'path': row['source_file'], 'sha256': row['sha256'],
            'recorded_at': row['recorded_at'],
        })
        journal = 'memory/runs/synthetic.md'
        (self.source / journal).write_text('Synthetic cycle.\n', encoding='utf-8')
        ledger['observations'].append({
            'id': source_id, 'source_file': row['source_file'], 'source_sha256': row['sha256'],
            'status': 'processed', 'processed_at': ledger['updated_at'],
            'outputs': ['memory/graph.json'], 'run': journal,
        })
        graph_path.write_text(json.dumps(graph), encoding='utf-8')
        ledger_path.write_text(json.dumps(ledger), encoding='utf-8')
        self.assertEqual(self.stats(self.source)['processed'], 1)

        target = self.work / 'target'
        self.run_python('init-instance.py', '--root', target)
        for relative in (row['source_file'], f'evidence/{source_id}.json'):
            shutil.copyfile(self.source / relative, target / relative)
        totals = self.stats(target)
        self.assertEqual(totals['observations'], 1)
        self.assertEqual(totals['processed'], 0)
        self.assertEqual(totals['pending'], 1)
        self.assertEqual(json.loads((target / 'memory/graph.json').read_bytes())['sources'], [])
        self.assertEqual(json.loads((target / 'questions/queue.json').read_bytes())['questions'], [])


if __name__ == '__main__':
    unittest.main()
