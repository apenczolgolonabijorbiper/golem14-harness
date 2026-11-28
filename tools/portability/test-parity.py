"""Negative tests for release parity: drift must never become a green package."""
import copy
import runpy
from types import SimpleNamespace
import json
from pathlib import Path
import shutil
import tempfile
import unittest

P = SimpleNamespace(**runpy.run_path(str(Path(__file__).with_name('check-parity.py'))))


class ParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        # Copy just the required contract/code/test inputs; no Git/network needed.
        for directory in [*P.SOURCE_ROOTS, 'portability', 'schemas', 'docs', 'tools/portability']:
            shutil.copytree(P.ROOT / directory, cls.root / directory, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('__pycache__'))

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_valid_complete_contract(self):
        self.assertEqual(P.check(self.root)['status'], 'passed')

    def test_unmapped_new_entrypoint_is_rejected(self):
        path = self.root / 'processor/new-runtime.ps1'
        path.write_text('Write-Output hello')
        try:
            with self.assertRaisesRegex(ValueError, 'Unclassified'):
                P.check(self.root)
        finally:
            path.unlink()

    def test_source_spec_and_golden_edits_are_rejected(self):
        for name, diagnostic in [('processor/process.mjs', 'Reference drift'),
                                 ('portability/specs/MEMORY.sudo.md', 'Specification/fixture drift'),
                                 ('portability/fixtures/cases.json', 'Specification/fixture drift')]:
            path = self.root / name
            old = path.read_bytes()
            try:
                path.write_bytes(old + b'\n')
                with self.assertRaisesRegex(ValueError, diagnostic):
                    P.check(self.root)
            finally:
                path.write_bytes(old)

    def test_refreshing_only_source_pin_cannot_bypass_evidence(self):
        manifest_path = self.root / 'portability/manifest.json'
        source = self.root / 'processor/process.mjs'
        old_manifest, old_source = manifest_path.read_bytes(), source.read_bytes()
        try:
            source.write_bytes(old_source + b'\n')
            manifest = json.loads(old_manifest)
            for row in manifest['inventory']:
                if row['path'] == 'processor/process.mjs':
                    row['sha256'] = P.sha(source.read_bytes())
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'Stale traceability/evidence'):
                P.check(self.root)
        finally:
            manifest_path.write_bytes(old_manifest)
            source.write_bytes(old_source)

    def test_same_pr_requires_fixture_and_spec_or_reviewed_no_impact(self):
        base = {'inventory': [{'path': 'processor/x.py', 'scope': 'core', 'sha256': 'old'}],
                'operations': [{'id': 'x', 'reference_files': ['processor/x.py'],
                                'reference_digest': 'old-ref', 'spec_digest': 'old-spec', 'fixture_digest': 'old-fixture'}]}
        current = copy.deepcopy(base)
        current['inventory'][0]['sha256'] = 'new'
        current['operations'][0]['reference_digest'] = 'new-ref'
        e = {'x': {'decision': 'bootstrap'}}
        with self.assertRaisesRegex(ValueError, 'bind base'):
            P.assess_impact(base, current, e)
        e['x'].update(previous_reference_digest='old-ref', decision='changed')
        with self.assertRaisesRegex(ValueError, 'specification AND fixture'):
            P.assess_impact(base, current, e)
        current['operations'][0].update(spec_digest='new-spec', fixture_digest='new-fixture')
        self.assertEqual(P.assess_impact(base, current, e), ['x'])
        e['x']['decision'] = 'no-impact'
        with self.assertRaisesRegex(ValueError, 'named reviewer'):
            P.assess_impact(base, current, e)
        e['x'].update(reviewer='example-reviewer', review_reference='https://github.com/example/review')
        self.assertEqual(P.assess_impact(base, current, e), ['x'])

    def test_runtime_schema_change_also_requires_parity_review(self):
        base = {'inventory': [], 'contract_files': {'schemas/graph.json': 'old'},
                'operations': [{'id': 'x', 'reference_files': ['processor/x.py'],
                                'spec_files': ['schemas/graph.json'], 'reference_digest': 'reference',
                                'spec_digest': 'old-spec', 'fixture_digest': 'fixture'}]}
        current = copy.deepcopy(base)
        current['contract_files']['schemas/graph.json'] = 'new'
        current['operations'][0]['spec_digest'] = 'new-spec'
        with self.assertRaisesRegex(ValueError, 'specification AND fixture'):
            P.assess_impact(base, current, {'x': {'decision': 'changed', 'previous_reference_digest': 'reference'}})


if __name__ == '__main__':
    unittest.main()
