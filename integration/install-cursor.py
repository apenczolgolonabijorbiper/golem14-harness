"""Install a verified Golem release for Cursor."""
import argparse
from pathlib import Path
import runpy

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--instance-root', required=True, type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1]
    try:
        # run_path avoids creating bytecode caches in the verified release.
        installer = runpy.run_path(str(source / 'integration/install-host.py'))
        installer['install'](source, args.repo, args.instance_root, host='cursor')
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, str(error) + '\n')
