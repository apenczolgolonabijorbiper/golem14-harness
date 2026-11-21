"""Build the repository-only, standalone Interactive Architecture Explorer.

Python standard library only. The output, generator and template are deliberately
absent from tools/build-release.py's explicit distribution allowlist.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = 'docs/architecture-explorer.html'
ASSETS = ROOT / 'tools/explorer'


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def build(output):
    # Ignore output-only commits so checking out the generated commit and running
    # again does not change revision/date forever. Full history is needed in CI.
    revision = git('log', '-1', '--format=%H', '--', '.', f':(exclude){OUTPUT}')
    date = git('show', '-s', '--format=%cs', revision)
    metadata = json.loads((ASSETS / 'modules.json').read_text(encoding='utf-8'))
    paths = []
    for directory in ['processor', 'server', 'adapters', 'integration', 'tools']:
        for path in (ROOT / directory).rglob('*'):
            name = path.relative_to(ROOT).as_posix()
            if (path.suffix in {'.py', '.mjs'} and path.is_file()
                    and not path.name.startswith('test-') and '.test.' not in path.name
                    and path.name != 'test-fixtures.mjs'
                    and not name.startswith('tools/explorer/')
                    and path.name not in {'build-explorer.py', 'test-explorer.py'}):
                paths.append(name)
    modules = []
    for name in sorted(paths):
        code = (ROOT / name).read_text(encoding='utf-8')
        title, group, description, notes = metadata.get(name, [
            Path(name).stem, 'Core' if name.startswith('server/') else 'Maintenance',
            'Discovered source module. Inspect the declarations and embedded source for its contract.', []])
        declarations = [{'line': i, 'signature': line.strip()}
                        for i, line in enumerate(code.splitlines(), 1)
                        if re.match(r'(export (async )?(function|class|const) |def |class |async function |function )', line)]
        imports = re.findall(r"(?:from\s+|import\s*\()\s*['\"]([^'\"]+)", code)
        modules.append(dict(path=name, title=title, group=group, description=description,
                            notes=notes, functions=declarations,
                            imports=[x for x in imports if x.startswith('.')], code=code))
    docpaths = [ROOT / 'README.md', ROOT / 'integration/AGENTS.distribution.md',
                *sorted((ROOT / 'docs').glob('*.md')),
                *sorted((ROOT / 'integration').glob('SETUP.*.md'))]
    data = dict(version=(ROOT / 'VERSION').read_text(encoding='utf-8').strip(),
                commit=revision, source_date=date,
                release_notes=(ROOT / 'docs/RELEASE_NOTES.md').read_text(encoding='utf-8'),
                modules=modules,
                docs=[dict(path=p.relative_to(ROOT).as_posix(), text=p.read_text(encoding='utf-8')) for p in docpaths],
                graph=json.loads((ROOT / 'schemas/memory-graph.schema.json').read_text(encoding='utf-8')),
                hypotheses=json.loads((ROOT / 'schemas/hypotheses.schema.json').read_text(encoding='utf-8')))
    # JSON in an HTML script element must not contain literal markup, even when
    # a future embedded document includes closing script tags or HTML examples.
    payload = json.dumps(data, ensure_ascii=True, sort_keys=True).replace('<', r'\u003c')
    template = (ASSETS / 'template.html').read_text(encoding='utf-8')
    if template.count('/*__DATA__*/') != 1:
        raise ValueError('Template must contain exactly one data marker')
    page = template.replace('__VERSION__', data['version']).replace('__SOURCE_DATE__', date)
    page = page.replace('/*__DATA__*/', payload)
    output = Path(output).resolve()
    inputs = {ROOT / m['path'] for m in modules} | set(docpaths)
    inputs |= {ASSETS / 'template.html', ASSETS / 'modules.json', ROOT / 'VERSION'}
    inputs |= set((ROOT / 'schemas').glob('*.json'))
    if output in {p.resolve() for p in inputs}:
        raise ValueError('Output cannot overwrite explorer inputs')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding='utf-8', newline='\n')
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / OUTPUT)
    args = parser.parse_args()
    print(f'{build(args.output)}  {args.output}')
