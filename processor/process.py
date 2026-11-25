"""Deterministic JSON-reference indexer; no interpretation or claim inference."""
import argparse
from contextlib import contextmanager
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


class IndexerBusy(Exception):
    pass


@contextmanager
def indexer_lock(root):
    # Keep this inode permanently: unlinking it could give concurrent processes
    # different lock objects. OS locks are released even after process death.
    descriptor = os.open(root / '.golem-indexer.lock', os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(descriptor, 'r+b') as stream:
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise IndexerBusy('Indexer busy: another process holds this instance indexer lock') from error
            raise
        # Closing releases the lock. Never touch the cognition processing lease.
        yield


def publish_evidence(out, evidence):
    descriptor, name = tempfile.mkstemp(prefix='.golem-index-', suffix='.tmp', dir=out.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write((json.dumps(evidence, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, out)
    finally:
        temporary.unlink(missing_ok=True)


def index(root):
    root = Path(root).resolve()
    with indexer_lock(root):
        directory = root / 'evidence'
        directory.mkdir(exist_ok=True)
        # A killed owner may leave an unpublished temporary. Only the lock owner
        # may remove these reserved files; finalized evidence is never removed.
        for temporary in directory.glob('.golem-index-*.tmp'):
            temporary.unlink()
        for source in sorted((root / 'inbox').glob('*.md')):
            raw = source.read_bytes()
            content = raw.decode('utf-8')
            if not content.startswith('---\n') or '\n---\n' not in content[4:]:
                print('Malformed:', source.name)
                continue
            header, body = content[4:].split('\n---\n', 1)
            fields = dict(re.findall(r'^([a-z_]+):\s*(.*)$', header, re.M))
            uid = fields.get('id', '')
            if not re.fullmatch(r'[0-9a-fA-F-]{36}', uid):
                print('Invalid ID:', source.name)
                continue
            out = directory / (uid + '.json')
            if out.exists():
                continue
            evidence = {'id': uid, 'source_file': source.relative_to(root).as_posix(),
                        'sha256': hashlib.sha256(raw).hexdigest(),
                        'recorded_at': fields.get('recorded_at'), 'event_date': fields.get('event_date'),
                        'kind': fields.get('kind'), 'text': body.strip(), 'interpretation': 'not_inferred'}
            if fields.get('question_id'):
                try:
                    question_text = json.loads(fields.get('question_text', '""'))
                except json.JSONDecodeError:
                    question_text = fields.get('question_text')
                evidence['question'] = {'id': fields['question_id'], 'text': question_text,
                                        'source': fields.get('question_source')}
            publish_evidence(out, evidence)
            print('Indexed:', uid, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True, help='Private instance directory')
    args = parser.parse_args()
    try:
        index(args.root)
    except (IndexerBusy, OSError, UnicodeError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
