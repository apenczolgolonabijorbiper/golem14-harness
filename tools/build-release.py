"""Build and test the standalone harness distribution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    'README.md', 'VERSION', 'LICENSE', 'docs/RELEASE_NOTES.md',
    'docs/EXTRACTION.md', 'docs/MEMORY_MODEL.md', 'docs/PROCESSING.md',
    'docs/PROVENANCE.md', 'docs/ARCHITECTURE_MAPPING.md',
    'docs/CHATGPT_WORK.md', 'docs/CODEX.md', 'docs/DIRECTORY_LAYOUT.md',
    'integration/SETUP.work.md', 'integration/SETUP.codex.md',
    'integration/SETUP.instance.md', 'integration/install-host.py',
    'integration/install-codex.py', 'integration/test-install-codex.py',
    'integration/AGENTS.application.md', 'integration/install-cursor.py',
    'integration/test-install-cursor.py',
    'processor/init-instance.py', 'processor/memory-tool.mjs', 'processor/process.py',
    'processor/test-observation-portability.py', 'processor/test-validation.py',
    'schemas/memory-graph.schema.json',
    'server/claim-validation.test.mjs', 'server/memory-core.test.mjs',
    'server/memory-model.mjs', 'server/application-profile.mjs', 'server/instance-layout.mjs',
    'server/neutral-core.test.mjs',
    'server/domain-memory.test.mjs', 'server/test-fixtures.mjs',
    'adapters/reference-git/adapter.mjs', 'adapters/template/adapter.mjs',
    'adapters/conformance/adapter.test.mjs',
    'docs/INSTANCE_LAYOUT.md', 'docs/UPGRADE_0_6.md', 'docs/ADAPTERS.md', 'docs/APPLICATION_PROFILES.md', 'docs/UPGRADE_0_5.md',
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(output):
    checksum = output.with_suffix(output.suffix + '.sha256')
    if output.exists() or checksum.exists():
        raise FileExistsError('Choose an unused output filename')
    entries = {name: (ROOT / name).read_bytes() for name in FILES}
    entries['AGENTS.md'] = (ROOT / 'integration/AGENTS.distribution.md').read_bytes()
    manifest = {
        'version': entries['VERSION'].decode().strip(),
        'schema_version': 1,
        'provenance': 'docs/PROVENANCE.md',
        'files': {name: digest(data) for name, data in entries.items()},
    }
    entries['RELEASE.json'] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary)
        for name, data in entries.items():
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        subprocess.run(['node', '--test', 'server/memory-core.test.mjs',
                        'server/claim-validation.test.mjs', 'server/domain-memory.test.mjs',
                        'adapters/conformance/adapter.test.mjs', 'server/neutral-core.test.mjs'],
                       cwd=stage, check=True, env={**os.environ, 'GOLEM_PYTHON': os.environ.get('GOLEM_PYTHON', sys.executable)})
        for script in ['processor/test-validation.py', 'processor/test-observation-portability.py',
                       'integration/test-install-cursor.py', 'integration/test-install-codex.py']:
            subprocess.run([sys.executable, script], cwd=stage, check=True)
    with zipfile.ZipFile(output, 'x') as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo('golem-harness/' + name, (2020, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with checksum.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(f'{digest(output.read_bytes())}  {output.name}\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    build(parser.parse_args().output)
