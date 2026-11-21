"""Exercise the shipped validator against isolated processing snapshots."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from importlib import import_module

sys.dont_write_bytecode = True
initialize = import_module('init-instance').initialize
CLI = Path(__file__).with_name('memory-tool.mjs')
SOURCE_ID = '00000000-0000-4000-8000-000000000001'
RECORDED_AT = '2026-01-01T12:00:00.000Z'


class ValidationTest(unittest.TestCase):
    def setUp(self):
        work = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.root = initialize(work / 'candidate')
        self.previous = work / 'prior-graph.json'
        graph_file = self.root / 'memory/graph.json'
        self.previous.write_bytes(graph_file.read_bytes())

        self.source_path = f'inbox/{SOURCE_ID}.md'
        raw = f'---\nid: {SOURCE_ID}\nrecorded_at: {RECORDED_AT}\n---\n\nSynthetic observation.\n'.encode()
        (self.root / self.source_path).write_bytes(raw)
        self.source_hash = hashlib.sha256(raw).hexdigest()
        graph = json.loads(graph_file.read_bytes())
        graph['sources'].append({
            'id': SOURCE_ID, 'path': self.source_path, 'sha256': self.source_hash,
            'recorded_at': RECORDED_AT,
        })
        graph_file.write_text(json.dumps(graph), encoding='utf-8')

    def validate(self):
        return subprocess.run(
            ['node', str(CLI), 'validate', '--root', str(self.root),
             '--previous', str(self.previous)], capture_output=True, text=True,
        )

    def test_staged_ledger_required(self):
        violation = f'Graph source is not processed: {SOURCE_ID}'
        result = self.validate()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.splitlines(), [
            f'Memory validation failed: {violation}', violation,
        ])

        ledger_file = self.root / 'memory/processed.json'
        ledger = json.loads(ledger_file.read_bytes())
        ledger['observations'].append({
            'id': SOURCE_ID, 'source_file': self.source_path,
            'source_sha256': self.source_hash, 'status': 'processed',
            'processed_at': ledger['updated_at'], 'outputs': ['memory/graph.json'],
            'run': 'memory/runs/synthetic.json',
        })
        ledger_file.write_text(json.dumps(ledger), encoding='utf-8')
        result = self.validate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['sources'], 1)

    def test_full_list_retains_subsequent_violations(self):
        (self.root / 'memory/processed.json').write_text('{}', encoding='utf-8')
        result = self.validate()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.splitlines(), [
            'Memory validation failed: Invalid processed ledger',
            'Invalid processed ledger',
            f'Graph source is not processed: {SOURCE_ID}',
        ])


if __name__ == '__main__':
    unittest.main()
