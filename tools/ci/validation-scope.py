"""Select expensive CI checks from the complete PR/push diff, not just HEAD."""
import os
from pathlib import PurePosixPath
import re
import subprocess


def requires_platforms(paths):
    for path in paths:
        # Installed executable code and integration instructions need every host.
        if path.startswith(('processor/', 'server/', 'schemas/', 'adapters/', 'integration/')):
            return True
        if path in {'README.md', '.gitignore', 'docs/architecture-explorer.html',
                    'tools/build-explorer.py', 'tools/test-explorer.py'}:
            continue
        if path.startswith('docs/') and PurePosixPath(path).suffix == '.md':
            continue
        if path in {'.github/workflows/windows-package.yml', 'tools/ci/check-windows-package.py'}:
            return True
        if path.startswith(('tools/explorer/', 'tools/ci/')):
            continue
        if path.startswith('.github/workflows/') and PurePosixPath(path).suffix in {'.yml', '.yaml'}:
            continue
        # VERSION, packaging, benchmarks, dependencies, and unknown paths fail
        # safe to full validation. No broad tools/** or *.md exclusion.
        return True
    return False


def main():
    base, head = os.environ.get('SCOPE_BASE', ''), os.environ['SCOPE_HEAD']
    if not re.fullmatch(r'[0-9a-f]{40}', head):
        raise ValueError('Expected a full head SHA')
    if not base or base == '0' * 40:
        full = True  # New branch / unavailable comparison: do not miss changes.
    else:
        if not re.fullmatch(r'[0-9a-f]{40}', base):
            raise ValueError('Expected a full base SHA')
        separator = '...' if os.environ.get('SCOPE_EVENT') == 'pull_request' else '..'
        raw = subprocess.check_output(['git', 'diff', '--no-renames', '--name-only', '-z', base + separator + head])
        full = requires_platforms(raw.decode('utf-8').rstrip('\0').split('\0') if raw else [])
    result = f'platforms={str(full).lower()}\n'
    print(result, end='')
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
        stream.write(result)


if __name__ == '__main__':
    main()
