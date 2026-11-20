"""Create a new private instance; refuse nonempty destinations."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

def initialize(root, profile=False, legacy_layout=False):
    root = Path(root).absolute()
    if root.is_symlink() or (root.exists() and any(root.iterdir())):
        raise ValueError('Destination must be absent or empty; existing instances are never reset')
    root.mkdir(parents=True, exist_ok=True)
    at = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    for directory in ['inbox', 'evidence', 'memory/events', 'memory/runs', 'questions', 'instance', 'profiles']:
        (root / directory).mkdir(parents=True, exist_ok=True)
    files = {
        'memory/graph.json': {'schema_version': 1, 'updated_at': at, 'sources': [], 'entities': [], 'claims': []},
        'memory/processed.json': {'schema_version': 1, 'updated_at': at, 'observations': []},
        'memory/processing-lock.json': {'schema_version': 1, 'status': 'idle', 'observation_ids': []},
        'questions/queue.json': {'schema_version': 1, 'updated_at': at, 'questions': []},
        ('persona/hypotheses.json' if legacy_layout else 'memory/hypotheses.json'): {'updated_at': at, 'hypotheses': []},
        ('persona/identity.md' if legacy_layout else 'instance/purpose.md'): '# Instance purpose\n\nDefine the purpose, scope, language and review priorities of this memory.\n',
        'memory/index.md': '# Memory\n\nNo analyzed observations.\n',
        'questions/queue.md': '# Questions\n\nNo questions.\n',
    }
    if profile:
        profile_path = 'persona/profile.md' if legacy_layout else 'profiles/default.md'
        files[profile_path] = '# Purpose\n\nDescribe the memory purpose.\n\n## Entity kinds\n\n## Predicates\n\n## Evidence rules\n\n## Review focus\n'
        files['golem.config.json'] = {'schema_version': 1, 'profile': {'path': profile_path}}
    for name, value in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        with (root / name).open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    return root

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--profile', action='store_true', help='Create and explicitly select a Markdown profile template')
    parser.add_argument('--legacy-layout', action='store_true', help='Create historical purpose/hypothesis paths for a new empty instance only')
    args = parser.parse_args()
    try:
        print(initialize(args.root, args.profile, args.legacy_layout))
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')
