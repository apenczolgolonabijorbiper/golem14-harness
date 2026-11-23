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
    'server/cognitive-task.mjs', 'server/cognitive-reference.mjs', 'server/cognitive-task.test.mjs',
    'processor/cognitive-tool.mjs', 'integration/COGNITIVE_TASK.sudo.md',
    'server/cognitive-evaluation.test.mjs',
    'docs/COGNITIVE_TASKS.md', 'docs/COGNITIVE_CONFORMANCE.md',
    'schemas/cognitive-task.schema.json', 'schemas/cognitive-result.schema.json',
    'schemas/cognitive-learning.schema.json', 'schemas/cognitive-context.schema.json',
    'cognition/conformance/cases.mjs', 'cognition/conformance/vendor-evaluation.json', 'cognition/conformance/vendor-input.json', 'tools/evaluate-cognition.mjs',
    'server/memory-timings.test.mjs',
    'server/cycle-artifacts.mjs',
    'server/application-source.mjs',
    'processor/source-bundle.mjs',
    'server/application-source.test.mjs',
    'docs/APPLICATION_SOURCES.md',
    'server/guidance.mjs',
    'server/profile-inspection.mjs',
    'server/profile-inspection.test.mjs',
    'server/purpose-guidance.test.mjs',
    'server/profile-lifecycle.test.mjs',
    'integration/SETUP.profile.md',
    'server/software-development-template.test.mjs',
    'profiles/templates/software-development-tfs-git/README.md',
    'profiles/templates/software-development-tfs-git/golem.config.json',
    'profiles/templates/software-development-tfs-git/profiles/core.md',
    'profiles/templates/software-development-tfs-git/profiles/work-items.md',
    'profiles/templates/software-development-tfs-git/profiles/git-history.md',
    'profiles/templates/software-development-tfs-git/profiles/chat.md',
    'profiles/templates/software-development-tfs-git/profiles/vocabulary.json',
    'profiles/templates/software-development-tfs-git/fixtures/observations.json',
    'profiles/templates/software-development-tfs-git/fixtures/expected.json',

    'README.md', 'VERSION', 'LICENSE', 'docs/RELEASE_NOTES.md',
    'docs/architecture-explorer.html',
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
    'schemas/memory-graph.schema.json', 'schemas/hypotheses.schema.json',
    'server/operation-metrics.mjs', 'server/adapter-performance.test.mjs',
    'processor/write-candidate.mjs', 'server/candidate-writer.test.mjs',
    'tools/benchmark-cycle.mjs', 'docs/PERFORMANCE.md',
    'server/candidate-merge.mjs', 'server/candidate-merge.test.mjs', 'docs/CANDIDATE_MERGE.md',
    'server/core-policies.mjs', 'server/hypotheses.mjs', 'server/core-priorities.test.mjs',
    'tools/benchmark-capacity.mjs', 'tools/measure-cli.mjs', 'tools/intake-example.mjs', 'server/intake.test.mjs',
    'docs/ANALYSIS_WORKFLOW.md', 'docs/INTAKE_PROVENANCE.md', 'docs/CAPACITY_BENCHMARKS.md',
    'server/claim-validation.test.mjs', 'server/memory-core.test.mjs', 'server/cognitive-task.test.mjs',
    'server/memory-model.mjs', 'server/application-profile.mjs', 'server/instance-layout.mjs',
    'server/neutral-core.test.mjs', 'server/subprocess.mjs', 'server/subprocess.test.mjs',
    'server/domain-memory.test.mjs', 'server/test-fixtures.mjs',
    'adapters/reference-git/adapter.mjs', 'adapters/template/adapter.mjs',
    'adapters/conformance/adapter.test.mjs',
    'docs/INSTANCE_LAYOUT.md', 'docs/UPGRADE_0_6.md', 'docs/ADAPTERS.md', 'docs/APPLICATION_PROFILES.md', 'docs/UPGRADE_0_5.md',
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def release_entries():
    # Direct local builds and CI both package a fresh page. Generator/template
    # stay repository-only; only the output enters the integrity manifest.
    subprocess.run([sys.executable, str(ROOT / 'tools/build-explorer.py')], check=True)
    entries = {name: (ROOT / name).read_bytes() for name in FILES}
    entries['AGENTS.md'] = (ROOT / 'integration/AGENTS.distribution.md').read_bytes()
    return entries


def build(output):
    checksum = output.with_suffix(output.suffix + '.sha256')
    if output.exists() or checksum.exists():
        raise FileExistsError('Choose an unused output filename')
    entries = release_entries()
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
        subprocess.run(['node', '--test', 'server/memory-core.test.mjs', 'server/cognitive-task.test.mjs',
                        'server/cognitive-evaluation.test.mjs', 'server/application-source.test.mjs',
                        'server/profile-inspection.test.mjs',
                        'server/software-development-template.test.mjs',
                        'server/purpose-guidance.test.mjs',
                        'server/profile-lifecycle.test.mjs',

                        'server/claim-validation.test.mjs', 'server/domain-memory.test.mjs', 'server/candidate-merge.test.mjs',
                        'server/adapter-performance.test.mjs', 'server/candidate-writer.test.mjs', 'server/memory-timings.test.mjs',
                        'adapters/conformance/adapter.test.mjs', 'server/neutral-core.test.mjs', 'server/subprocess.test.mjs', 'server/core-priorities.test.mjs', 'server/intake.test.mjs'],
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
