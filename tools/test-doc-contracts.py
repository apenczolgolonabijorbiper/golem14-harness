"""Check shipped guidance for known stale promises; retain scoped release history."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
BEGIN = '<!-- historical-release-material: begin -->'
END = '<!-- historical-release-material: end -->'
HISTORICAL = {'docs/EXTRACTION.md', 'docs/UPGRADE_0_5.md', 'docs/UPGRADE_0_6.md'}
# Deliberately target affirmative promises/obsolete diagnostics, not every use of
# historical/legacy: retained events, negative compatibility statements and older
# release evidence remain legitimate. Whitespace/Markdown wrapping is immaterial.
STALE = [
    r'(?:neutral and|neutral or) historical layouts?(?: are)? supported',
    r'\(neutral or historical layout\)',
    r'historical persona paths remain readable',
    r'legacy fields/classifications remain valid',
    r'preserve all original fields/classification spellings',
    r'conflicting claim attribution',
    r'(?:subject, speaker or object|subject, speaker and entity-valued object)',
    r'processing\.md contains older wording',
]


def current_text(path, text):
    if BEGIN in text or END in text:
        if path not in HISTORICAL or text.count(BEGIN) != 1 or text.count(END) != 1:
            raise ValueError('Unscoped/unbalanced historical exception: ' + path)
        prefix, rest = text.split(BEGIN)
        if END not in rest:
            raise ValueError('Historical markers out of order: ' + path)
        _, suffix = rest.split(END)
        if not all(s in prefix for s in ['superseded', 'INSTANCE_LAYOUT.md', 'PROCESSING.md', 'MEMORY_PROVIDERS.md']):
            raise ValueError('Historical material needs current-version notice: ' + path)
        return prefix + suffix
    if path in HISTORICAL:
        raise ValueError('Historical notice/markers missing: ' + path)
    return text


def violations(path, text):
    normalized = ' '.join(current_text(path, text).replace('`', '').lower().split())
    return [pattern for pattern in STALE if re.search(pattern, normalized)]


def validate_release_metadata(version, readme, notes):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
        raise ValueError('Invalid release VERSION')
    if readme.splitlines()[0] != '# Golem native cognitive harness — ' + version:
        raise ValueError('README title must match VERSION')
    examples = re.findall(r'golem-cognitive-harness-([0-9]+\.[0-9]+\.[0-9]+)\.zip', readme)
    if not examples or any(v != version for v in examples):
        raise ValueError('README archive examples must match VERSION')
    if notes.splitlines()[0] != '# Golem XIV Harness ' + version:
        raise ValueError('Release notes title must match VERSION')


class DocumentationContractTest(unittest.TestCase):
    def test_release_version_alignment(self):
        validate_release_metadata((ROOT / 'VERSION').read_text().strip(),
                                  (ROOT / 'README.md').read_text(encoding='utf-8'),
                                  (ROOT / 'docs/RELEASE_NOTES.md').read_text(encoding='utf-8'))

    def test_stale_readme_and_release_notes_are_rejected(self):
        version = '1.2.3'
        readme = '# Golem native cognitive harness — 1.2.3\nBuild golem-cognitive-harness-1.2.3.zip\n'
        notes = '# Golem XIV Harness 1.2.3\n'
        validate_release_metadata(version, readme, notes)
        for r, n in [(readme.replace('— 1.2.3', '— 1.2.2'), notes),
                     (readme.replace('1.2.3.zip', '1.2.2.zip'), notes),
                     (readme, notes.replace('1.2.3', '1.2.2'))]:
            with self.assertRaises(ValueError):
                validate_release_metadata(version, r, n)

    def test_known_stale_promises_fail_with_line_wrapping(self):
        for promise in [
            'Neutral and historical layouts are supported without mutation.',
            '(neutral or historical layout)',
            'historical persona paths remain readable without mutation.',
            'Legacy fields/classifications remain valid.',
            'Preserve all original fields/classification spellings in retained claims.',
            '| `Conflicting claim attribution` | both aliases may coexist |',
            'The subject, speaker and entity-valued object must include sources.',
            'PROCESSING.md contains older wording about historical layouts.',
        ]:
            self.assertTrue(violations('docs/PROCESSING.md', promise.replace(' ', '\n')), promise)

    def test_negative_statements_and_history_are_allowed_only_when_scoped(self):
        self.assertEqual(violations('docs/PROCESSING.md',
            'Historical layouts/claim aliases are not supported. No historical persona-path resolution. '
            'Retain historical events and canonical claims.'), [])
        notice = 'superseded INSTANCE_LAYOUT.md PROCESSING.md MEMORY_PROVIDERS.md\n'
        history = notice + BEGIN + '\n## 0.6.0\nHistorical persona paths remain readable.\n' + END
        self.assertEqual(violations('docs/EXTRACTION.md', history), [])
        for path, text in [('docs/PROCESSING.md', history), ('docs/EXTRACTION.md', history.replace(END, '')),
                           ('docs/EXTRACTION.md', history.replace('superseded', ''))]:
            with self.assertRaises(ValueError):
                current_text(path, text)
        # A new current promise outside the explicit historical region still fails.
        self.assertTrue(violations('docs/EXTRACTION.md', history + ' Legacy fields/classifications remain valid.'))

    def test_current_shipped_guidance(self):
        paths = [ROOT / 'README.md', *sorted((ROOT / 'docs').glob('*.md')),
                 *sorted((ROOT / 'integration').glob('*.md')),
                 *sorted((ROOT / 'profiles/templates').glob('*/README.md'))]
        template = ROOT / 'tools/explorer/template.html'
        if template.exists():
            paths.append(template)
        for path in paths:
            name = path.relative_to(ROOT).as_posix()
            self.assertEqual(violations(name, path.read_text(encoding='utf-8')), [], name)

    def test_embedded_documentation_matches_sources(self):
        page = (ROOT / 'docs/architecture-explorer.html').read_text(encoding='utf-8')
        match = re.search(r'<script id="atlas-data" type="application/json">(.*?)</script>', page, re.S)
        self.assertIsNotNone(match)
        data = json.loads(match[1])
        for doc in data['docs']:
            self.assertEqual(violations(doc['path'], doc['text']), [], doc['path'])
            path = ROOT / doc['path']
            # Some repository-only docs are embedded but do not ship separately.
            if path.exists():
                self.assertEqual(doc['text'], path.read_text(encoding='utf-8'), doc['path'])
        # Test the page's current explanatory copy separately from embedded history.
        copy = page[:match.start()] + page[match.end():]
        self.assertEqual(violations('docs/architecture-explorer.html', copy), [])


if __name__ == '__main__':
    unittest.main()
