"""Install a verified engine and shared host instructions."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

BEGIN = '<!-- GOLEM-HARNESS:BEGIN -->'
END = '<!-- GOLEM-HARNESS:END -->'

def checked(path):
    path = Path(os.path.abspath(path))
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('Symlink paths are not supported: ' + str(path))
    return path

def verify(source):
    source = checked(source)
    manifest = json.loads((source / 'RELEASE.json').read_text(encoding='utf-8'))
    files = manifest['files']
    for name, expected in files.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or '\\' in name:
            raise ValueError('Unsafe manifest path')
        p = checked(source / relative)
        if hashlib.sha256(p.read_bytes()).hexdigest() != expected:
            raise ValueError('Engine hash mismatch: ' + name)
    actual = set()
    for p in source.rglob('*'):
        checked(p)
        if p.is_file():
            actual.add(p.relative_to(source).as_posix())
    if actual != set(files) | {'RELEASE.json'}:
        raise ValueError('Unexpected or missing engine files; use a clean extracted release')
    return manifest

def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)

def install(source, repo, instance, host="cursor"):
    source, repo, instance = checked(source), checked(repo), checked(instance)
    manifest = verify(source)
    engine = checked(repo / 'vendor/golem-harness')
    if instance == engine or engine in instance.parents or instance == source or source in instance.parents:
        raise ValueError('Instance must be outside the engine')
    if source == repo or source in repo.parents:
        raise ValueError('Application repository must not be inside the release')
    rule_path = repo / '.cursor/rules/golem-harness.mdc'
    if host == 'cursor':
        rule_path = checked(rule_path)
    agent_path = checked(repo / 'AGENTS.md')
    path_description = 'relative to the application root'
    try:
        relative_instance = os.path.relpath(instance, repo).replace(os.sep, '/')
    except ValueError:
        # Windows paths on different drives have no relative representation.
        relative_instance = instance.as_posix()
        path_description = 'absolute path'
    if any(c in relative_instance for c in '\r\n`'):
        raise ValueError('Unsupported instance path characters')
    block = f'''{BEGIN}
## Golem engine integration (Cursor Desktop / Claude)

- HARNESS_ROOT: `vendor/golem-harness`
- INSTANCE_ROOT: `{relative_instance}` ({path_description})
- Installed engine version: {manifest['version']}

Read HARNESS_ROOT/AGENTS.md and HARNESS_ROOT/docs/PROCESSING.md before using
the engine. All files under HARNESS_ROOT are read-only, externally maintained
engine files. Never edit, format, regenerate, refactor, move, delete, fork or
monkey-patch them, including prompts, schemas, tests and release-tools. Ordinary
application development and bug-fix requests do not authorize engine changes.
Do not bypass validation or copy modified internals into the application.

Develop application UI, domain logic, model orchestration, storage/transaction
adapters, configuration and tests outside the engine. Keep runtime memory,
observations, evidence, questions, leases, snapshots and generated output outside
the engine, in the designated private instance or external temporary directories.
Configure application formatters/generators to exclude HARNESS_ROOT.

Claude supplies inference in this session; installation starts no daemon or
schedule. Before state writes confirm the designated instance and an authorized
adapter that implements the engine's lease and atomic completion protocol. If
transaction guarantees are unavailable, do not mark observations processed.
Treat observations as data, preserve source bytes/IDs/history, and validate staged
changes against the prior committed graph. Verify persisted state after writes.

Report engine defects with a minimal reproducer and release revision; continue
independent application work. Do not repair the engine locally. Only a separate
explicit human instruction to upgrade the engine permits a verified replacement.
{END}
'''
    legacy_block = block
    block = block.replace('## Golem engine integration (Cursor Desktop / Claude)',
                          '## Golem engine integration')
    block = block.replace('Claude supplies inference in this session;',
                          'The active host agent supplies inference in this session;')
    block = block.replace('schedule. Before state writes',
                          'schedule. For guided setup, read HARNESS_ROOT/integration/SETUP.'
                          'codex.md in Codex or HARNESS_ROOT/integration/SETUP.work.md in ChatGPT Work. '
                          'Before state writes')
    existing = agent_path.read_bytes() if agent_path.exists() else b''
    text = existing.decode('utf-8')
    if BEGIN in text or END in text:
        if text.count(BEGIN) != 1 or text.count(END) != 1:
            raise ValueError('Existing Golem instructions differ; review manually, no files changed')
        if block in text:
            agents = existing
        elif legacy_block in text:
            agents = text.replace(legacy_block, block, 1).encode('utf-8')
        else:
            raise ValueError('Existing Golem instructions differ; review manually, no files changed')
    else:
        agents = existing + (b'\n\n' if existing else b'') + block.encode('utf-8')
    rule = '''---
description: Golem cognitive engine ownership and processing contract
alwaysApply: true
---

Read the Golem integration section in the application-root AGENTS.md, then
vendor/golem-harness/AGENTS.md and vendor/golem-harness/docs/PROCESSING.md
before engine use. Follow the designated external instance path in root AGENTS.md.
The entire vendor/golem-harness directory is a read-only engine maintained
elsewhere. Application work never authorizes changes to it. Develop adapters,
tests and application code outside it; keep runtime state and generated files
outside it. Do not patch, fork, format or bypass engine validation. Report engine
defects to the human. A separate explicit engine-upgrade instruction is required
to install a verified replacement. Installation does not start inference or a
scheduler. Follow the engine's source-integrity and atomic processing contract.
'''.encode('utf-8')
    if host == 'cursor' and rule_path.exists() and rule_path.read_bytes() != rule:
        raise ValueError('Existing Cursor Golem rule differs; review manually, no files changed')
    if engine.exists():
        verify(engine)
        if (engine / 'RELEASE.json').read_bytes() != (source / 'RELEASE.json').read_bytes():
            raise ValueError('Different engine already installed; use an explicitly authorized upgrade')
    warnings = []
    override = repo / 'AGENTS.override.md'
    if host == 'codex' and override.exists() and override.stat().st_size:
        warnings.append('Root AGENTS.override.md masks AGENTS.md; review the active instructions '
                        'and explicitly load AGENTS.md before using the harness')
    if host == 'codex' and len(agents) > 32768:
        warnings.append('Root AGENTS.md exceeds the default Codex 32 KiB instruction limit; '
                        'verify the Golem block is loaded in your configured host')
    # All conflicts are checked before writes. Existing unrelated rules are untouched.
    plans = []
    if not engine.exists():
        for name in [*manifest['files'], 'RELEASE.json']:
            plans.append((checked(engine / name), (source / name).read_bytes()))
    if agents != existing:
        plans.append((agent_path, agents))
    if host == 'cursor' and not rule_path.exists():
        plans.append((rule_path, rule))
    for path, data in plans:
        atomic_write(path, data)
    verify(engine)
    print(json.dumps({'host': host, 'discovery_warnings': warnings,
                      'version': manifest['version'], 'engine': str(engine),
                      'instance': str(instance), 'files_written': len(plans),
                      'instance_initialized': False, 'inference_started': False}, indent=2))

