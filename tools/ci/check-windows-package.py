"""Verify the Linux-built Harness ZIP and run the focused Windows checks."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from zipfile import ZipFile


def verify_and_extract(package, destination):
    checksum = package.with_suffix(package.suffix + '.sha256').read_text().split()
    if checksum != [hashlib.sha256(package.read_bytes()).hexdigest(), package.name]:
        raise ValueError('Package checksum mismatch')
    with ZipFile(package) as archive:
        prefix = 'golem-harness/'
        manifest = json.loads(archive.read(prefix + 'RELEASE.json'))
        names = archive.namelist()
        if len(set(names)) != len(names) or set(names) != {
            prefix + name for name in (*manifest['files'], 'RELEASE.json')
        }:
            raise ValueError('Package inventory mismatch')
        for name in names:
            parts = name.split('/')
            if any(part in {'', '.', '..'} or ':' in part or '\\' in part for part in parts):
                raise ValueError(f'Invalid package member: {name}')
            data = archive.read(name)
            if name != prefix + 'RELEASE.json':
                expected = manifest['files'][name.removeprefix(prefix)]
                if hashlib.sha256(data).hexdigest() != expected:
                    raise ValueError(f'Package member hash mismatch: {name}')
            target = destination.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    return destination / 'golem-harness'


def check(directory, node_version):
    package, = directory.glob('*.zip')
    env = {**os.environ, 'GOLEM_PYTHON': sys.executable}
    actual = subprocess.check_output(['node', '-p', 'process.versions.node'], text=True).strip()
    if actual != node_version and not actual.startswith(node_version + '.'):
        raise RuntimeError(f'Expected Node {node_version}, found {actual}')
    with tempfile.TemporaryDirectory(prefix='harness release ') as temp:
        stage = verify_and_extract(package, Path(temp))
        subprocess.run(['node', '--test', 'server/subprocess.test.mjs', 'processor/indexer.test.mjs'],
                       cwd=stage, env=env, check=True)
        subprocess.run(['node', '--input-type=module', '-e',
                        "import {fixture} from './server/test-fixtures.mjs';"
                        "const cleanups = []; try { console.log(fixture({after: fn => cleanups.push(fn)},"
                        "{profile:true}).root); } finally { for (const fn of cleanups.reverse()) fn(); }"],
                       cwd=stage, env=env, check=True)
        if node_version == '24':
            for installer in ('codex', 'cursor'):
                subprocess.run([sys.executable, f'integration/test-install-{installer}.py'],
                               cwd=stage, env=env, check=True)
            subprocess.run([sys.executable, 'processor/test-observation-portability.py'],
                           cwd=stage, env=env, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--node-version', required=True, choices=['22.12.0', '24'])
    args = parser.parse_args()
    check(args.directory, args.node_version)
