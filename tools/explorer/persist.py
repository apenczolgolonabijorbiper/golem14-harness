"""Save only the generated page; never rebase or force-push over newer source."""
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PAGE = 'docs/architecture-explorer.html'


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def persist(expected_head):
    if git('rev-parse', 'HEAD') != expected_head:
        raise RuntimeError('Checkout moved; regenerate from the intended source revision')
    if git('diff', '--cached', '--name-only'):
        raise RuntimeError('Refusing to commit an already staged change')
    git('fetch', 'origin', 'refs/heads/master')
    if git('rev-parse', 'FETCH_HEAD') != expected_head:
        raise RuntimeError('master advanced during this build; artifact retained. Run the workflow on current master')
    git('add', '--', PAGE)
    if not git('diff', '--cached', '--name-only'):
        print('Explorer is already current; no commit needed.')
        return
    git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'docs: refresh generated architecture explorer')
    # A racing source push makes this ordinary fast-forward push fail safely.
    # Branch protection is respected; the workflow artifact remains downloadable.
    git('push', 'origin', 'HEAD:refs/heads/master')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-head', required=True)
    persist(parser.parse_args().expected_head)
