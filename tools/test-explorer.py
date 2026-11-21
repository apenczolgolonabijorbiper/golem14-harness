"""Repository-only regressions for generation, provenance and safe persistence."""
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True, stderr=subprocess.DEVNULL).strip()


class ExplorerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'checkout'
        self.root.mkdir()
        for name in ['processor', 'server', 'adapters', 'integration', 'tools', 'schemas', 'docs']:
            shutil.copytree(ROOT / name, self.root / name,
                            ignore=shutil.ignore_patterns('__pycache__', 'architecture-explorer.html'))
        for name in ['README.md', 'VERSION', 'LICENSE']:
            shutil.copyfile(ROOT / name, self.root / name)
        git(self.root, 'init', '-b', 'master')
        git(self.root, 'config', 'user.name', 'Synthetic Test')
        git(self.root, 'config', 'user.email', 'test@example.invalid')
        git(self.root, 'config', 'commit.gpgsign', 'false')
        git(self.root, 'add', '.')
        git(self.root, 'commit', '-m', 'Synthetic source')
        self.builder = module('explorer_builder', ROOT / 'tools/build-explorer.py')
        self.builder.ROOT = self.root
        self.builder.ASSETS = self.root / 'tools/explorer'
        self.output = self.root / self.builder.OUTPUT

    def data(self):
        page = self.output.read_text(encoding='utf-8')
        match = re.search(r'<script id="atlas-data" type="application/json">(.*?)</script>', page, re.S)
        return page, json.loads(match.group(1))

    def test_repeat_build_and_generated_only_commit_are_identical(self):
        self.builder.build(self.output)
        first = self.output.read_bytes()
        self.builder.build(self.output)
        self.assertEqual(first, self.output.read_bytes())
        source = git(self.root, 'rev-parse', 'HEAD')
        git(self.root, 'add', self.builder.OUTPUT)
        git(self.root, 'commit', '-m', 'Generated page only')
        self.builder.build(self.output)
        self.assertEqual(first, self.output.read_bytes())
        self.assertEqual(self.data()[1]['commit'], source)

    def test_discovers_new_source_and_escapes_script_markup(self):
        malicious = 'export function synthetic() { return "</script><script>bad()</script>"; }\n'
        (self.root / 'server/synthetic.mjs').write_text(malicious, encoding='utf-8')
        (self.root / 'VERSION').write_text('9.8.7\n', encoding='utf-8')
        schema = self.root / 'schemas/memory-graph.schema.json'
        value = json.loads(schema.read_text(encoding='utf-8'))
        value['properties']['sources']['maxItems'] = 12345
        schema.write_text(json.dumps(value), encoding='utf-8')
        self.builder.build(self.output)
        page, data = self.data()
        self.assertEqual(data['version'], '9.8.7')
        self.assertEqual(data['graph']['properties']['sources']['maxItems'], 12345)
        added = next(m for m in data['modules'] if m['path'] == 'server/synthetic.mjs')
        self.assertEqual(added['code'], malicious)
        self.assertIn('synthetic()', added['functions'][0]['signature'])
        self.assertNotIn('</script><script>bad()', page)
        self.assertNotRegex(page, r'<script[^>]+src=|<link[^>]+stylesheet|@import')
        self.assertNotIn('__VERSION__', page)
        self.assertNotIn('/*__DATA__*/', page)

    def test_refuses_input_overwrite_and_packages_only_generated_html(self):
        original = (self.root / 'README.md').read_bytes()
        with self.assertRaisesRegex(ValueError, 'overwrite'):
            self.builder.build(self.root / 'README.md')
        self.assertEqual(original, (self.root / 'README.md').read_bytes())
        release = module('release_builder', self.root / 'tools/build-release.py')
        release.ROOT = self.root
        self.assertEqual([name for name in release.FILES if 'explorer' in name.lower()],
                         ['docs/architecture-explorer.html'])
        # A direct release build must regenerate stale tracked HTML.
        self.output.write_text('STALE HTML', encoding='utf-8')
        (self.root / 'VERSION').write_text('9.8.7\n', encoding='utf-8')
        entries = release.release_entries()
        self.assertEqual(entries['docs/architecture-explorer.html'], self.output.read_bytes())
        self.assertEqual(self.data()[1]['version'], '9.8.7')
        self.assertNotIn('STALE HTML', entries['docs/architecture-explorer.html'].decode())
        self.assertNotIn('tools/build-explorer.py', entries)
        self.assertFalse(any(name.startswith('tools/explorer/') for name in entries))

    def test_persistence_fast_forward_noop_and_stale_head_refusal(self):
        remote = Path(self.temp.name) / 'remote.git'
        subprocess.run(['git', 'init', '--bare', str(remote)], check=True, capture_output=True)
        git(self.root, 'remote', 'add', 'origin', str(remote))
        git(self.root, 'push', 'origin', 'master')
        source = git(self.root, 'rev-parse', 'HEAD')
        self.builder.build(self.output)
        persister = module('explorer_persist', ROOT / 'tools/explorer/persist.py')
        persister.ROOT = self.root
        persister.persist(source)
        generated = git(self.root, 'rev-parse', 'HEAD')
        self.assertNotEqual(source, generated)
        self.assertEqual(git(self.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', generated), self.builder.OUTPUT)
        self.builder.build(self.output)
        persister.persist(generated)
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), generated)
        # Local checkout stays at the old source while authoritative master moved.
        git(self.root, 'checkout', '--detach', source)
        self.builder.build(self.output)
        with self.assertRaisesRegex(RuntimeError, 'master advanced'):
            persister.persist(source)
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), source)
        self.assertFalse(git(self.root, 'diff', '--cached', '--name-only'))


if __name__ == '__main__':
    unittest.main()
