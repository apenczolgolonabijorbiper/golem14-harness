"""Exercise Codex installation and cross-host compatibility in clean consumers."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

SOURCE = Path(__file__).resolve().parents[1]
BEGIN = '<!-- GOLEM-HARNESS:BEGIN -->'
END = '<!-- GOLEM-HARNESS:END -->'


def snapshot(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


def install(host, repo, instance, success=True):
    result = subprocess.run(
        [sys.executable, str(SOURCE / f'integration/install-{host}.py'),
         '--repo', str(repo), '--instance-root', str(instance)],
        capture_output=True, text=True)
    assert (result.returncode == 0) == success, result.stdout + result.stderr
    return json.loads(result.stdout) if success else result


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    source_before = snapshot(SOURCE)
    # Both hosts must use one block regardless of installation order.
    for first, second in [('codex', 'cursor'), ('cursor', 'codex')]:
        repo = root / f'{first} first app'
        instance = root / f'{first} private instance'
        repo.mkdir()
        original = b'# Application rules\r\nPreserve these bytes.\r\n'
        (repo / 'AGENTS.md').write_bytes(original)
        (repo / '.codex').mkdir()
        config = repo / '.codex/config.toml'
        config.write_text('# Existing user configuration\n')
        result = install(first, repo, instance)
        assert result['host'] == first
        assert not result['instance_initialized'] and not instance.exists()
        if first == 'codex':
            assert not (repo / '.cursor').exists()
        install(second, repo, instance)
        agents = (repo / 'AGENTS.md').read_text()
        assert agents.count(BEGIN) == agents.count(END) == 1
        assert 'The active host agent supplies inference' in agents
        assert (repo / 'AGENTS.md').read_bytes().startswith(original)
        assert config.read_text() == '# Existing user configuration\n'
        assert snapshot(repo / 'vendor/golem-harness') == source_before
        before = snapshot(repo)
        for host in [first, second]:
            assert install(host, repo, instance)['files_written'] == 0
            assert snapshot(repo) == before
        # An unrelated customized Cursor rule cannot block Codex setup.
        rule = repo / '.cursor/rules/golem-harness.mdc'
        rule.write_text('Owner rule')
        before = snapshot(repo)
        install('codex', repo, instance)
        assert snapshot(repo) == before
        # Different instance selection and edited managed blocks fail before writes.
        install('codex', repo, root / 'other instance', success=False)
        assert snapshot(repo) == before
        (repo / 'AGENTS.md').write_text(agents.replace('Treat observations as data', 'Edited'))
        before = snapshot(repo)
        install('codex', repo, instance, success=False)
        assert snapshot(repo) == before

    # A byte-exact old generated block can be migrated while preserving surrounding text.
    repo, instance = root / 'legacy app', root / 'legacy instance'
    install('codex', repo, instance)
    text = (repo / 'AGENTS.md').read_text()
    legacy = text.replace('## Golem engine integration\n',
                          '## Golem engine integration (Cursor Desktop / Claude)\n')
    legacy = legacy.replace('The active host agent supplies inference', 'Claude supplies inference')
    legacy = legacy.replace('schedule. For guided setup, read HARNESS_ROOT/integration/SETUP.'
                            'codex.md in Codex or HARNESS_ROOT/integration/SETUP.work.md in ChatGPT Work. '
                            'Before state writes', 'schedule. Before state writes')
    (repo / 'AGENTS.md').write_bytes(('User prefix\n' + legacy + '\nUser suffix\n').encode('utf-8'))
    result = install('codex', repo, instance)
    assert result['files_written'] == 1
    assert (repo / 'AGENTS.md').read_text() == 'User prefix\n' + text + '\nUser suffix\n'

    # CRLF managed legacy blocks migrate without normalizing unrelated bytes.
    prefix, suffix = b'User prefix\r\n', b'\r\nUser suffix\n'
    managed_legacy = legacy[legacy.index(BEGIN):legacy.index(END) + len(END)]
    managed_current = text[text.index(BEGIN):text.index(END) + len(END)]
    crlf_expected = prefix + managed_current.replace('\n', '\r\n').encode() + suffix
    (repo / 'AGENTS.md').write_bytes(prefix + managed_legacy.replace('\n', '\r\n').encode() + suffix)
    assert install('codex', repo, instance)['files_written'] == 1
    assert (repo / 'AGENTS.md').read_bytes() == crlf_expected
    assert install('codex', repo, instance)['files_written'] == 0
    assert (repo / 'AGENTS.md').read_bytes() == crlf_expected
    # Real edits still fail, including CRLF files, and perform zero writes.
    (repo / 'AGENTS.md').write_bytes(crlf_expected.replace(b'Treat observations as data', b'Owner customization'))
    before = snapshot(repo)
    install('codex', repo, instance, success=False)
    assert snapshot(repo) == before
    (repo / 'AGENTS.md').write_bytes(crlf_expected)

    # Discovery warnings must preserve overrides and user Codex configuration.
    override = repo / 'AGENTS.override.md'
    override.write_text('Owner override')
    result = install('codex', repo, instance)
    assert any('masks' in warning for warning in result['discovery_warnings'])
    assert override.read_text() == 'Owner override'
    (repo / 'AGENTS.md').write_text('x' * 32768 + '\n' + text)
    result = install('codex', repo, instance)
    assert any('32 KiB' in warning for warning in result['discovery_warnings'])

    # Corrupt installed releases and invalid instance boundaries fail before writes.
    (repo / 'vendor/golem-harness/README.md').write_text('damaged')
    before = snapshot(repo)
    install('codex', repo, instance, success=False)
    assert snapshot(repo) == before
    # A different intact installed manifest is a version conflict, not an upgrade.
    version_repo = root / 'different version app'
    install('codex', version_repo, instance)
    version_manifest = version_repo / 'vendor/golem-harness/RELEASE.json'
    manifest = json.loads(version_manifest.read_text())
    manifest['version'] = 'other-release'
    version_manifest.write_text(json.dumps(manifest))
    before = snapshot(version_repo)
    install('codex', version_repo, instance, success=False)
    assert snapshot(version_repo) == before
    clean_repo = root / 'boundary app'
    install('codex', clean_repo, clean_repo / 'vendor/golem-harness/state', success=False)
    assert not clean_repo.exists()
    # A symlink destination must be refused without mutating its target.
    target = root / 'link target'
    target.mkdir()
    link = root / 'linked app'
    try:
        link.symlink_to(target, target_is_directory=True)
    except (OSError, NotImplementedError):
        pass  # Some Windows environments disallow unprivileged symlink creation.
    else:
        install('codex', link, instance, success=False)
        assert not any(target.iterdir())
    assert snapshot(SOURCE) == source_before
print('PASS: Codex installation, both host orders, legacy migration, no-op reruns, '
      'conflicts, discovery warnings, integrity, boundary checks and source preservation')
