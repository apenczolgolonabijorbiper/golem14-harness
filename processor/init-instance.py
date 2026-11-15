"""Create a new private instance; refuse nonempty destinations."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

def initialize(root):
    root = Path(root).absolute()
    if root.is_symlink() or (root.exists() and any(root.iterdir())):
        raise ValueError('Destination must be absent or empty; existing instances are never reset')
    root.mkdir(parents=True, exist_ok=True)
    at = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    for directory in ['inbox', 'evidence', 'memory/events', 'memory/runs', 'questions', 'persona']:
        (root / directory).mkdir(parents=True, exist_ok=True)
    files = {
        'memory/graph.json': {'schema_version': 1, 'updated_at': at, 'sources': [], 'entities': [], 'claims': []},
        'memory/processed.json': {'schema_version': 1, 'updated_at': at, 'observations': []},
        'memory/processing-lock.json': {'schema_version': 1, 'status': 'idle', 'observation_ids': []},
        'questions/queue.json': {'schema_version': 1, 'updated_at': at, 'questions': []},
        'persona/hypotheses.json': {'updated_at': at, 'hypotheses': []},
        'persona/identity.md': '# Instance identity\n\nNo biography has been supplied.\n',
        'memory/index.md': '# Memory\n\nNo analyzed observations.\n',
        'questions/queue.md': '# Questions\n\nNo questions.\n',
    }
    for name, value in files.items():
        with (root / name).open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    return root

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    try:
        print(initialize(args.root))
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')
