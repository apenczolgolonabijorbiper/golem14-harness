"""Guard lightweight-only diffs and mixed/runtime CI routing."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('scope', Path(__file__).with_name('validation-scope.py'))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class ScopeTests(unittest.TestCase):
    def test_full_pr_diff_and_runtime_renames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True,
                                               stderr=subprocess.DEVNULL).strip()
            def commit(message):
                git('add', '.')
                git('commit', '-m', message)
                return git('rev-parse', 'HEAD')
            def classify(base, head, event='pull_request'):
                output = root / 'scope-output'
                if output.exists():
                    output.unlink()
                subprocess.run([sys.executable, str(Path(__file__).with_name('validation-scope.py'))],
                               cwd=root, check=True, capture_output=True,
                               env={**os.environ, 'SCOPE_BASE': base, 'SCOPE_HEAD': head,
                                    'SCOPE_EVENT': event, 'GITHUB_OUTPUT': str(output)})
                value = output.read_text().strip()
                output.unlink()
                return value
            git('init', '-b', 'master')
            git('config', 'user.name', 'Synthetic Test')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'commit.gpgsign', 'false')
            (root / 'server').mkdir()
            (root / 'docs').mkdir()
            (root / 'server/runtime.js').write_text('baseline\n')
            base = commit('baseline')
            (root / 'server/runtime.js').write_text('changed runtime\n')
            runtime = commit('runtime change')
            (root / 'docs/guide.md').write_text('docs\n')
            head = commit('documentation change')
            self.assertEqual(classify(base, head), 'platforms=true')
            self.assertEqual(classify(runtime, head, 'push'), 'platforms=false')
            git('mv', 'server/runtime.js', 'docs/runtime.md')
            renamed = commit('rename runtime into docs')
            self.assertEqual(classify(head, renamed), 'platforms=true')
            self.assertEqual(classify('0' * 40, head, 'push'), 'platforms=true')

    def test_complete_explorer_pr_stays_lightweight(self):
        self.assertFalse(scope.requires_platforms([
            '.github/workflows/release.yml', '.github/workflows/validate.yml',
            '.gitignore', 'README.md', 'docs/EXPLORER.md', 'docs/architecture-explorer.html',
            'tools/build-explorer.py', 'tools/test-explorer.py',
            'tools/explorer/template.html', 'tools/explorer/modules.json',
            'tools/explorer/persist.py', 'tools/ci/validation-scope.py']))

    def test_mixed_runtime_changes_always_get_platforms(self):
        for path in ['server/memory-model.mjs', 'processor/process.py',
                     'schemas/memory-graph.schema.json', 'adapters/template/adapter.mjs',
                     'integration/AGENTS.distribution.md', 'integration/SETUP.work.md',
                     'tools/build-release.py', 'tools/benchmark-cycle.mjs', 'VERSION']:
            with self.subTest(path=path):
                self.assertTrue(scope.requires_platforms(['docs/EXPLORER.md', path]))

    def test_unknown_paths_and_renames_fail_safe(self):
        self.assertTrue(scope.requires_platforms(['new-runtime.js']))
        self.assertTrue(scope.requires_platforms(['package.json']))
        self.assertTrue(scope.requires_platforms(['tools/new-tool.py']))
        self.assertFalse(scope.requires_platforms(['docs/MEMORY_MODEL.md']))
        self.assertFalse(scope.requires_platforms([]))


if __name__ == '__main__':
    unittest.main()
