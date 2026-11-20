"""Synthetic installer checks; all application/state writes stay in temporary directories."""
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(__file__).resolve().parents[1]
script = source / 'integration/install-cursor.py'
def hashes(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary).resolve()
    repo, instance = root / 'app', root / 'private'
    repo.mkdir()
    (repo / 'AGENTS.md').write_bytes(b'# Existing application rules\r\nKeep this text.\r\n')
    rules = repo / '.cursor/rules'
    rules.mkdir(parents=True)
    (rules / 'existing.mdc').write_text('Preserve unrelated rule')
    before_source = hashes(source)
    def run(ok=True):
        result = subprocess.run([sys.executable, str(script), '--repo', str(repo),
                                 '--instance-root', str(instance)], capture_output=True, text=True)
        assert (result.returncode == 0) == ok, result.stdout + result.stderr
        return result
    run()
    assert (repo / 'AGENTS.md').read_bytes().startswith(b'# Existing application rules\r\nKeep this text.\r\n')
    assert (rules / 'existing.mdc').read_text() == 'Preserve unrelated rule'
    assert 'alwaysApply: true' in (rules / 'golem-harness.mdc').read_text()
    assert not instance.exists()
    before = hashes(repo)
    run()
    assert hashes(repo) == before
    assert hashes(repo / 'vendor/golem-harness') == before_source
    # Changed rule: fail before any other writes.
    (rules / 'golem-harness.mdc').write_text('Owner customization')
    before = hashes(repo)
    run(False)
    assert hashes(repo) == before
    # Restore the rule then detect a damaged engine.
    (rules / 'golem-harness.mdc').write_bytes((source / 'integration/install-cursor.py').read_bytes())
    # Reset rule by removing it; the modified engine must still block recreation.
    (rules / 'golem-harness.mdc').unlink()
    (repo / 'vendor/golem-harness/AGENTS.md').write_text('Altered engine')
    before = hashes(repo)
    run(False)
    assert hashes(repo) == before
    assert hashes(source) == before_source
print('PASS: Cursor install, instruction preservation, rule creation, idempotency, conflict refusal, engine integrity, no runtime initialization')
