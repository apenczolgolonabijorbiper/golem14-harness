"""Real-process locking, atomic visibility and interrupted-owner recovery."""
import hashlib
import json
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
from importlib import import_module

sys.dont_write_bytecode = True
import process as indexer
initialize = import_module('init-instance').initialize
PROCESSOR = Path(__file__).resolve().parent


def worker(root, mode):
    replace = indexer.os.replace
    first = True
    def gated_replace(source, target):
        nonlocal first
        if first:
            first = False
            print('READY', flush=True)
            sys.stdin.readline()
            if mode == 'fail':
                raise OSError('Injected publication failure')
            replace(source, target)
            print('PUBLISHED', flush=True)
            sys.stdin.readline()
        else:
            replace(source, target)
    indexer.os.replace = gated_replace
    indexer.index(root)


class IndexerTest(unittest.TestCase):
    def setUp(self):
        self.work = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.root = initialize(self.work / 'instance')
        self.ids = []
        for n in range(100):
            uid = f'00000000-0000-4000-8000-{n:012d}'
            self.ids.append(uid)
            raw = (f'---\nid: {uid}\nrecorded_at: 2026-01-01T00:00:00.000Z\n'
                   'kind: observation\n---\n\nSynthetic Zażółć 世界.\n' + 'Large body. ' * 1000 + '\n').encode()
            (self.root / 'inbox' / f'{uid}.md').write_bytes(raw)

    def run_indexer(self, root=None):
        return subprocess.run([sys.executable, str(PROCESSOR / 'process.py'), '--root', str(root or self.root)],
                              capture_output=True, text=True, timeout=30)

    def start_worker(self, mode='gate'):
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--worker', str(self.root), mode],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.close_worker, child)
        self.lines = queue.Queue()
        def collect():
            for line in child.stdout:
                self.lines.put(line.strip())
        threading.Thread(target=collect, daemon=True).start()
        self.assertEqual(self.lines.get(timeout=20), 'READY')
        return child

    @staticmethod
    def close_worker(child):
        if child.poll() is None:
            child.kill()
            child.wait(timeout=10)
        for stream in (child.stdin, child.stdout, child.stderr):
            stream.close()

    @staticmethod
    def advance(child):
        child.stdin.write('\n')
        child.stdin.flush()

    def evidence(self, root=None):
        return {p.name: p.read_bytes() for p in ((root or self.root) / 'evidence').glob('*.json')}

    def test_overlapping_processes_and_reader_match_baseline(self):
        baseline = initialize(self.work / 'baseline')
        for source in (self.root / 'inbox').glob('*.md'):
            (baseline / 'inbox' / source.name).write_bytes(source.read_bytes())
        self.assertEqual(self.run_indexer(baseline).returncode, 0)
        child = self.start_worker()
        self.assertEqual(self.evidence(), {})
        competitor = self.run_indexer()
        self.assertEqual(competitor.returncode, 1)
        self.assertIn('Indexer busy:', competitor.stderr)
        self.assertNotIn('Indexed:', competitor.stdout)
        stop, observed = threading.Event(), threading.Event()
        failures = []
        def reader():
            try:
                while not stop.is_set():
                    for path in (self.root / 'evidence').glob('*.json'):
                        value = json.loads(path.read_bytes())
                        self.assertEqual(value['id'] + '.json', path.name)
                        observed.set()
            except Exception as error:
                failures.append(error)
        reader_thread = threading.Thread(target=reader)
        reader_thread.start()
        try:
            self.advance(child)
            self.assertEqual(self.lines.get(timeout=20), 'PUBLISHED')
            self.assertTrue(observed.wait(20), 'Reader must observe a live locked publisher')
            self.assertIn('Indexer busy:', self.run_indexer().stderr)
            self.advance(child)
            child.wait(timeout=30)
        finally:
            stop.set()
            reader_thread.join(timeout=10)
        self.assertEqual(failures, [])
        self.assertEqual(child.returncode, 0, child.stderr.read())
        lines = [self.lines.get(timeout=5) for _ in range(100)]
        self.assertEqual(sorted(lines), sorted('Indexed: ' + uid for uid in self.ids))
        self.assertEqual(self.evidence(), self.evidence(baseline))
        self.assertEqual(len(self.evidence()), 100)
        before = self.evidence()
        again = self.run_indexer()
        self.assertEqual((again.returncode, again.stdout), (0, ''))
        self.assertEqual(self.evidence(), before)
        self.validate_completed_fixture()

    def validate_completed_fixture(self):
        graph_path = self.root / 'memory/graph.json'
        graph = json.loads(graph_path.read_bytes())
        ledger_path = self.root / 'memory/processed.json'
        ledger = json.loads(ledger_path.read_bytes())
        for uid in self.ids:
            path = f'inbox/{uid}.md'
            digest = hashlib.sha256((self.root / path).read_bytes()).hexdigest()
            self.assertEqual(json.loads((self.root / 'evidence' / f'{uid}.json').read_bytes())['sha256'], digest)
            graph['sources'].append({'id': uid, 'path': path, 'sha256': digest, 'recorded_at': '2026-01-01T00:00:00.000Z'})
            ledger['observations'].append({'id': uid, 'source_file': path, 'source_sha256': digest,
                                          'status': 'processed', 'processed_at': ledger['updated_at'],
                                          'outputs': ['memory/graph.json'], 'run': 'memory/runs/synthetic.md'})
        graph_path.write_bytes(json.dumps(graph).encode())
        ledger_path.write_bytes(json.dumps(ledger).encode())
        result = subprocess.run(['node', str(PROCESSOR / 'memory-tool.mjs'), 'validate', '--root', str(self.root)],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_killed_owner_recovers_without_stealing_live_lock(self):
        target = self.root / 'evidence' / f'{self.ids[0]}.json'
        target.write_bytes(b'{"preserved":true}\n')
        child = self.start_worker()
        self.assertTrue(list((self.root / 'evidence').glob('.golem-index-*.tmp')))
        self.assertEqual(self.run_indexer().returncode, 1)
        self.assertEqual(len(self.evidence()), 1)
        child.kill()
        child.wait(timeout=10)
        result = self.run_indexer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count('Indexed:'), 99)
        self.assertEqual(target.read_bytes(), b'{"preserved":true}\n')
        self.assertEqual(list((self.root / 'evidence').glob('.golem-index-*.tmp')), [])
        self.assertTrue((self.root / '.golem-indexer.lock').exists())
        self.assertEqual(self.run_indexer().stdout, '')

    def test_error_before_publication_cleans_temp_and_releases_lock(self):
        child = self.start_worker('fail')
        self.advance(child)
        child.wait(timeout=10)
        self.assertNotEqual(child.returncode, 0)
        self.assertIn('Injected publication failure', child.stderr.read())
        self.assertEqual(self.evidence(), {})
        self.assertEqual(list((self.root / 'evidence').glob('.golem-index-*.tmp')), [])
        result = self.run_indexer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count('Indexed:'), 100)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--worker':
        worker(Path(sys.argv[2]), sys.argv[3])
    else:
        unittest.main()
