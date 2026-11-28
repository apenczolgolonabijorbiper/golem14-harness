"""Create a new private instance; refuse nonempty destinations."""
import argparse
import json
import base64
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

def initialize(root, profile=False, profile_from=None, purpose_from=None, node="node", source_metadata=None):
    if profile and profile_from:
        raise ValueError("--profile and --profile-from are mutually exclusive")
    captured = {"files": {}, "metadata": {}}
    if profile_from or purpose_from:
        result = subprocess.run([node, str(Path(__file__).with_name("source-bundle.mjs")), str(profile_from or ""), str(purpose_from or "")], capture_output=True, text=True)
        if result.returncode:
            raise ValueError(result.stderr.strip())
        captured = json.loads(result.stdout)
    root = Path(root).absolute()
    if root.is_symlink() or (root.exists() and any(root.iterdir())):
        raise ValueError('Destination must be absent or empty; existing instances are never reset')
    # Refuse linked ancestors; validate all inputs before staging any destination bytes.
    for ancestor in [root, *root.parents]:
        if ancestor.is_symlink():
            raise ValueError('Linked destination ancestor refused')
    destination = root
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = tempfile.TemporaryDirectory(prefix='.golem-init-', dir=destination.parent)
    root = Path(staging.name) / 'instance'
    root.mkdir()
    at = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    for directory in ['inbox', 'evidence', 'memory/events', 'memory/runs', 'questions', 'instance', 'profiles']:
        (root / directory).mkdir(parents=True, exist_ok=True)
    files = {
        'memory/graph.json': {'schema_version': 2, 'updated_at': at, 'sources': [], 'entities': [], 'claims': []},
        'memory/processed.json': {'schema_version': 1, 'updated_at': at, 'observations': []},
        'memory/processing-lock.json': {'schema_version': 1, 'status': 'idle', 'observation_ids': []},
        'questions/queue.json': {'schema_version': 1, 'updated_at': at, 'questions': []},
        'memory/hypotheses.json': {'schema_version': 1, 'updated_at': at, 'hypotheses': []},
        'instance/purpose.md': '# Instance purpose\n\nDefine the purpose, scope, language and review priorities of this memory.\n',
        'memory/index.md': '# Memory\n\nNo analyzed observations.\n',
        'questions/queue.md': '# Questions\n\nNo questions.\n',
    }
    if profile:
        profile_path = 'profiles/default.md'
        files[profile_path] = '# Purpose\n\nDescribe the memory purpose.\n\n## Entity kinds\n\n## Predicates\n\n## Evidence rules\n\n## Review focus\n'
        files['golem.config.json'] = {'schema_version': 1, 'profile': {'path': profile_path}}
    for name, value in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        with (root / name).open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    for name, value in captured['files'].items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(value))
    existed = destination.exists()
    if existed:
        destination.rmdir()  # Still empty; a concurrent addition refuses publication.
    try:
        os.replace(root, destination)
    except OSError:
        if existed and not destination.exists():
            destination.mkdir()
        raise
    staging.cleanup()
    if source_metadata is not None:
        source_metadata.update(captured['metadata'])
    return destination

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--profile', action='store_true', help='Create and explicitly select a Markdown profile template')
    parser.add_argument('--profile-from', help='Reviewed application-owned source bundle (requires Node)')
    parser.add_argument('--purpose-from', help='Explicit UTF-8 purpose file; conflicts with bundle purpose.md')
    parser.add_argument('--node', default='node', help='Node executable for shared source validation')
    parser.add_argument('--json', action='store_true', help='Return destination and captured source metadata as JSON')
    args = parser.parse_args()
    try:
        metadata = {}
        result = initialize(args.root, args.profile, args.profile_from, args.purpose_from, args.node, metadata)
        print(json.dumps({'root': str(result), 'source': metadata}) if args.json else result)
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')
