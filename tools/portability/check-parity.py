"""Fail closed on local-core coverage, hash drift and same-PR impact evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOTS = ('processor', 'server', 'adapters', 'integration')
SOURCE_SUFFIXES = {'.py', '.mjs', '.js', '.cjs', '.ps1', '.psm1', '.cs', '.vb', '.pl', '.rb', '.sh'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest_map(values):
    return sha(json.dumps(values, sort_keys=True, separators=(',', ':')).encode())


def discover(root):
    return {p.relative_to(root).as_posix() for directory in SOURCE_ROOTS
            for p in (root / directory).rglob('*')
            if p.is_file() and p.suffix in SOURCE_SUFFIXES
            and not any(part in {'node_modules', '__pycache__'} for part in p.parts)}


def fingerprint(root, paths):
    return digest_map({p: sha((root / p).read_bytes()) for p in sorted(set(paths))})


def assess_impact(base, current, evidence):
    """Compare covered operations to a base manifest; no automatic impact inference."""
    old_ops = {op['id']: op for op in base['operations']}
    old_files = {f['path']: f.get('sha256') for f in base['inventory'] if f['scope'] == 'core'}
    new_files = {f['path']: f.get('sha256') for f in current['inventory'] if f['scope'] == 'core'}
    old_files.update({p: h for p, h in base.get('contract_files', {}).items() if p.startswith('schemas/')})
    new_files.update({p: h for p, h in current.get('contract_files', {}).items() if p.startswith('schemas/')})
    changed = {p for p in old_files.keys() | new_files.keys() if old_files.get(p) != new_files.get(p)}
    impacted = {op['id'] for op in base['operations'] + current['operations']
                if changed.intersection(op['reference_files'] + op.get('spec_files', []))}
    current_ops = {op['id']: op for op in current['operations']}
    for name in impacted:
        if name not in current_ops:
            raise ValueError('Removed operation needs a breaking-contract migration, not silent deletion: ' + name)
        e = evidence[name]
        before = old_ops.get(name)
        if before is None:
            if e['decision'] != 'changed':
                raise ValueError('New operation needs changed specification/fixture evidence: ' + name)
            continue
        if e.get('previous_reference_digest') != before['reference_digest']:
            raise ValueError('Impact evidence does not bind base reference: ' + name)
        if e['decision'] == 'changed':
            op = current_ops[name]
            if op['spec_digest'] == before['spec_digest'] or op['fixture_digest'] == before['fixture_digest']:
                raise ValueError('Changed behavior needs same-PR specification AND fixture updates: ' + name)
        elif e['decision'] == 'no-impact':
            if not e.get('reviewer') or not e.get('review_reference', '').startswith('https://github.com/'):
                raise ValueError('No-impact decision needs named reviewer and review reference: ' + name)
        else:
            raise ValueError('Existing changed core cannot use bootstrap evidence: ' + name)
    return sorted(impacted)


def check(root=ROOT, base=None):
    manifest = json.loads((root / 'portability/manifest.json').read_text())
    if manifest['schema_version'] != 1 or manifest['contract_version'] != '1.0.0':
        raise ValueError('Unsupported portability manifest version')
    inventory = manifest['inventory']
    paths = [row['path'] for row in inventory]
    if len(paths) != len(set(paths)):
        raise ValueError('Duplicate inventory path')
    actual = discover(root)
    if actual != set(paths):
        raise ValueError('Unclassified or removed runtime entrypoint/module: ' + ', '.join(sorted(actual ^ set(paths))))
    core = set()
    for row in inventory:
        if row['scope'] not in {'core', 'tooling', 'test'} or not row.get('reason'):
            raise ValueError('Invalid inventory classification: ' + row['path'])
        if row['scope'] == 'core':
            core.add(row['path'])
            if sha((root / row['path']).read_bytes()) != row['sha256']:
                raise ValueError('Reference drift: ' + row['path'])
    # Every normative payload file must be pinned; additions cannot silently miss packaging.
    contract = {p.relative_to(root).as_posix() for p in (root / 'portability').rglob('*') if p.is_file()
                and p.relative_to(root / 'portability').parts[0] not in {'evidence'}
                and p.name != 'manifest.json'}
    pinned = manifest['contract_files']
    if not contract.issubset(pinned):
        raise ValueError('Unpinned contract file: ' + ', '.join(sorted(contract - pinned.keys())))
    schema_paths = {p.relative_to(root).as_posix() for p in (root / 'schemas').rglob('*.json')}
    if not schema_paths.issubset(pinned):
        raise ValueError('Unpinned runtime schema')
    for path, expected in pinned.items():
        if sha((root / path).read_bytes()) != expected:
            raise ValueError('Specification/fixture drift: ' + path)
    cases = json.loads((root / 'portability/fixtures/cases.json').read_text())['cases']
    scenarios = json.loads((root / 'portability/fixtures/scenarios.json').read_text())['scenarios']
    case_ids = {c['id'] for c in cases}
    scenario_ids = {s['id'] for s in scenarios}
    if len(case_ids) != len(cases) or len(scenario_ids) != len(scenarios):
        raise ValueError('Duplicate fixture identity')
    for case in cases:
        if ('expected' in case) == ('error' in case):
            raise ValueError('Fixture needs exactly one golden result/error: ' + case['id'])
    evidence = json.loads((root / 'portability/evidence/parity.json').read_text())
    if evidence['contract_version'] != manifest['contract_version']:
        raise ValueError('Evidence contract version mismatch')
    decisions = {e['operation']: e for e in evidence['assessments']}
    ops = manifest['operations']
    if len({o['id'] for o in ops}) != len(ops) or set(decisions) != {o['id'] for o in ops}:
        raise ValueError('Missing/duplicate operation impact evidence')
    mapped = set()
    for op in ops:
        refs = set(op['reference_files'])
        if not refs or not refs.issubset(core):
            raise ValueError('Invalid reference coverage: ' + op['id'])
        mapped |= refs
        if not op['surfaces'] or not op['spec_files'] or not op['fixture_files']:
            raise ValueError('Incomplete operation mapping: ' + op['id'])
        if not (set(op['cases']) <= case_ids and set(op['scenarios']) <= scenario_ids) or not (op['cases'] or op['scenarios']):
            raise ValueError('Missing operation fixture: ' + op['id'])
        if any(c['operation'] != op['id'] for c in cases if c['id'] in op['cases']):
            raise ValueError('Golden case belongs to a different operation: ' + op['id'])
        if any(op['id'] not in s['operations'] for s in scenarios if s['id'] in op['scenarios']):
            raise ValueError('Scenario does not exercise mapped operation: ' + op['id'])
        if not all(p in pinned for p in op['spec_files'] + op['fixture_files']):
            raise ValueError('Operation refers to unpinned normative input: ' + op['id'])
        for suite in op['conformance_suites']:
            if not (root / suite).is_file():
                raise ValueError('Missing conformance suite: ' + suite)
        e = decisions[op['id']]
        for field, files in [('reference_digest', op['reference_files']), ('spec_digest', op['spec_files']), ('fixture_digest', op['fixture_files'])]:
            actual_digest = fingerprint(root, files)
            if actual_digest != op[field] or actual_digest != e[field]:
                raise ValueError('Stale traceability/evidence ' + field + ': ' + op['id'])
        if e['decision'] not in {'bootstrap', 'changed', 'no-impact'} or not e.get('rationale'):
            raise ValueError('Invalid impact decision: ' + op['id'])
    if mapped != core:
        raise ValueError('Unmapped core modules: ' + ', '.join(sorted(core - mapped)))
    # Static relative imports cannot disappear behind a tooling classification.
    import re
    for path in core:
        if path.endswith(('.mjs', '.js')):
            for relative in re.findall(r'''(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]''', (root / path).read_text()):
                dependency = (root / path).parent.joinpath(relative).resolve().relative_to(root.resolve()).as_posix()
                if dependency.endswith(('.mjs', '.js')) and dependency not in core:
                    raise ValueError('Unmapped transitive runtime import: ' + path + ' -> ' + dependency)
    impacted = []
    if base:
        previous = subprocess.run(['git', 'show', base + ':portability/manifest.json'], cwd=root, capture_output=True, text=True)
        if previous.returncode == 0:
            impacted = assess_impact(json.loads(previous.stdout), manifest, decisions)
        else:
            # Distinguish first introduction from an invalid/missing base ref.
            subprocess.run(['git', 'rev-parse', '--verify', base + '^{commit}'], cwd=root, check=True, capture_output=True)
    return {'status': 'passed', 'contract_version': manifest['contract_version'],
            'manifest_sha256': sha((root / 'portability/manifest.json').read_bytes()),
            'core_files': len(core), 'operations': len(ops), 'golden_cases': len(cases),
            'scenarios': len(scenarios), 'base_impact_operations': impacted}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', help='PR base or last published tag for same-change impact checks')
    args = parser.parse_args()
    try:
        print(json.dumps(check(base=args.base), indent=2))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')
