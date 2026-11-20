"""Install a verified Golem release for Codex CLI and Desktop."""
import argparse
from pathlib import Path
import runpy

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path,
                        help='Application root; the engine is installed under vendor/golem-harness')
    parser.add_argument('--instance-root', required=True, type=Path,
                        help='Data directory for this instance (inbox, memory, instance configuration, profiles, questions)')
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1]
    try:
        # run_path avoids creating bytecode caches in the verified release.
        installer = runpy.run_path(str(source / 'integration/install-host.py'))
        installer['install'](source, args.repo, args.instance_root, host='codex')
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, str(error) + '\n')
