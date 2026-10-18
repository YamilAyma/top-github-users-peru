#!/usr/bin/env python3
"""Capture committed ranking observations; stdlib only, never invent observation dates."""
import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from zoneinfo import ZoneInfo
from location_rules import recognized_cities

ROOT = Path(__file__).resolve().parents[1]
ZONE = ZoneInfo('America/Lima')
COLUMNS = ['login', 'publicContributions', 'privateContributions', 'followers']
VERSION = 1
DAILY_DAYS = 90


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.PIPE)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timestamps must include a timezone')
    return result.astimezone(timezone.utc)


def validate_snapshot(snapshot):
    if not isinstance(snapshot, dict):
        raise ValueError('Invalid snapshot')
    required = {'date', 'source_updated_at', 'source_commit', 'cache_sha256', 'users'}
    if not required <= set(snapshot) or set(snapshot) - required - {'city_membership'}:
        raise ValueError('Unexpected snapshot fields')
    observed = timestamp(snapshot['source_updated_at'])
    if snapshot['date'] != observed.astimezone(ZONE).date().isoformat():
        raise ValueError('Snapshot date does not match its source timestamp')
    if not re.fullmatch(r'[a-f0-9]{40}', snapshot['source_commit']):
        raise ValueError('Invalid source commit')
    if not re.fullmatch(r'[a-f0-9]{64}', snapshot['cache_sha256']):
        raise ValueError('Invalid cache checksum')
    rows = snapshot['users']
    if not isinstance(rows, list) or not rows:
        raise ValueError('A snapshot requires profiles')
    logins = set()
    for row in rows:
        if not isinstance(row, list) or len(row) != len(COLUMNS):
            raise ValueError('Invalid compact profile row')
        login = row[0]
        if not isinstance(login, str) or not re.fullmatch(r'[A-Za-z0-9-]+', login):
            raise ValueError('Invalid GitHub login')
        if login.lower() in logins:
            raise ValueError('Duplicate GitHub login')
        logins.add(login.lower())
        if any(type(value) is not int or value < 0 for value in row[1:]):
            raise ValueError('Counts must be nonnegative integers')
    membership = snapshot.get('city_membership')
    if membership is not None:
        if not isinstance(membership, dict):
            raise ValueError('Invalid city membership')
        for city, indices in membership.items():
            if not isinstance(city, str) or not re.fullmatch(r'[a-z]+(?:-[a-z]+)*', city):
                raise ValueError('Invalid city code')
            if not isinstance(indices, list) or any(type(i) is not int or not 0 <= i < len(rows) for i in indices) or indices != sorted(set(indices)):
                raise ValueError('Invalid city profile indices')
    if rows != sorted(rows, key=lambda row: row[0].lower()):
        raise ValueError('Snapshot profiles must be sorted by login')


def source_snapshot(repo, now, refresh_base=None, seed=False):
    """A changed cache commit after the checkpoint proves a new published observation.

    Exit codes from the upstream action alone are insufficient. A seed retains
    the existing commit's date, even when old, and is not a fresh API collection.
    """
    source = git(repo, 'log', '-1', '--format=%H', '--', 'cache/peru.json').decode().strip()
    if not source:
        raise ValueError('The cache has no committed source')
    raw = (repo / 'cache/peru.json').read_bytes()
    if raw != git(repo, 'show', f'{source}:cache/peru.json'):
        return None, 'cache differs from its committed source'
    updated = git(repo, 'show', '-s', '--format=%cI', source).decode().strip()
    observed = timestamp(updated)
    if observed > now + timedelta(minutes=5):
        raise ValueError('Source timestamp is in the future')
    if not seed:
        if not re.fullmatch(r'[a-f0-9]{40}', refresh_base or ''):
            raise ValueError('Refresh checkpoint must be a full commit SHA')
        base = git(repo, 'rev-parse', '--verify', f'{refresh_base}^{{commit}}').decode().strip()
        if source == base:
            return None, 'no cache commit after the refresh checkpoint'
        ancestor = subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', base, source], capture_output=True)
        if ancestor.returncode == 1:
            return None, 'cache commit is not newer than the refresh checkpoint'
        if ancestor.returncode != 0:
            raise ValueError('Cannot verify refresh checkpoint ancestry')
        if observed < now - timedelta(hours=24):
            return None, 'new cache commit is older than 24 hours'
        before = git(repo, 'show', f'{base}:cache/peru.json')
        if before == raw:
            return None, 'cache content did not change since the refresh checkpoint'
    data = json.loads(raw)
    if not isinstance(data, list) or not data:
        raise ValueError('Expected a nonempty cache list')
    rows = []
    for user in data:
        if not isinstance(user, dict):
            raise ValueError('Invalid cached profile')
        rows.append([user[key] for key in COLUMNS])
    # Validate type before sorting; avoid accepting bools, floats or duplicate logins.
    if any(not isinstance(row[0], str) for row in rows):
        raise ValueError('Invalid login type')
    rows.sort(key=lambda row: row[0].lower())
    snapshot = {'date': observed.astimezone(ZONE).date().isoformat(),
                'source_updated_at': observed.isoformat().replace('+00:00', 'Z'),
                'source_commit': source, 'cache_sha256': hashlib.sha256(raw).hexdigest(), 'users': rows}
    # Preserve old observations without location metadata. New captures use the
    # configuration committed with their source, never today's locations for past dates.
    try:
        config_raw = git(repo, 'show', f'{source}:config.json')
    except subprocess.CalledProcessError:
        config_raw = None
    if config_raw is not None:
        config = json.loads(config_raw)
        cities = next(item['cities'] for item in config['locations'] if item['country'] == 'peru')
        by_login = {user['login'].lower(): user for user in data}
        membership = {city: [] for city in cities}
        for i, row in enumerate(rows):
            for city in recognized_cities(by_login[row[0].lower()].get('location'), cities):
                membership[city].append(i)
        snapshot['city_membership'] = membership
    validate_snapshot(snapshot)
    return snapshot, 'seed from committed cache' if seed else 'new committed cache'


def period_key(snapshot, tier):
    return snapshot['date'][:{'daily': 10, 'monthly': 7, 'yearly': 4}[tier]]


def load_history(root):
    result = {}
    for tier in ('daily', 'monthly', 'yearly'):
        records = {}
        folder = root / tier
        if folder.exists():
            if folder.is_symlink():
                raise ValueError('History folders must not be symlinks')
            for path in sorted(folder.glob('*.json')):
                if path.is_symlink():
                    raise ValueError('History files must not be symlinks')
                pattern = r'\d{4}-\d{2}' if tier == 'daily' else r'\d{4}'
                if not re.fullmatch(pattern, path.stem):
                    raise ValueError('Unexpected history file: ' + str(path))
                payload = json.loads(path.read_text())
                if payload.get('version') != VERSION or payload.get('columns') != COLUMNS:
                    raise ValueError('Unsupported history schema')
                for snapshot in payload['snapshots']:
                    validate_snapshot(snapshot)
                    expected_file = snapshot['date'][:7 if tier == 'daily' else 4]
                    if path.stem != expected_file:
                        raise ValueError('Snapshot stored in the wrong file')
                    key = period_key(snapshot, tier)
                    if key in records:
                        raise ValueError('Duplicate snapshot period')
                    records[key] = snapshot
        result[tier] = records
    return result


def render_group(snapshots):
    # One compact snapshot per line: small JSON and append-friendly Git diffs.
    header = '{"version":1,"columns":' + compact(COLUMNS) + ',"snapshots":[\n'
    return header + ',\n'.join(compact(s) for s in snapshots) + '\n]}\n'


def plan_history(records, snapshot, as_of):
    result = {tier: dict(rows) for tier, rows in records.items()}
    if snapshot:
        validate_snapshot(snapshot)
        for tier, rows in result.items():
            key = period_key(snapshot, tier)
            old = rows.get(key)
            if old and old['source_commit'] == snapshot['source_commit']:
                if old != snapshot:
                    raise ValueError('A source commit cannot have conflicting snapshots')
                continue
            if old and timestamp(old['source_updated_at']) == timestamp(snapshot['source_updated_at']):
                raise ValueError('Different source commits have the same timestamp; refusing ambiguous replacement')
            if not old or timestamp(old['source_updated_at']) < timestamp(snapshot['source_updated_at']):
                rows[key] = snapshot
    cutoff = as_of - timedelta(days=DAILY_DAYS - 1)
    result['daily'] = {key: value for key, value in result['daily'].items() if cutoff <= date.fromisoformat(key) <= as_of}
    if any(date.fromisoformat(s['date']) > as_of for rows in result.values() for s in rows.values()):
        raise ValueError('History contains a future observation date')
    files = {}
    catalog = {'version': VERSION, 'timezone': 'America/Lima', 'columns': COLUMNS,
               'daily_window': {'from': cutoff.isoformat(), 'through': as_of.isoformat(), 'days': DAILY_DAYS},
               'series': {}}
    for tier, rows in result.items():
        grouped = {}
        for key in sorted(rows):
            item = rows[key]
            filename = item['date'][:7 if tier == 'daily' else 4]
            grouped.setdefault(filename, []).append(item)
        entries = []
        for filename, snapshots in sorted(grouped.items()):
            path = f'{tier}/{filename}.json'
            contents = render_group(snapshots)
            files[path] = contents
            periods = [{'period': period_key(s, tier), 'date': s['date'], 'profiles': len(s['users']),
                        'closed': period_key(s, tier) < as_of.isoformat()[:{'daily': 10, 'monthly': 7, 'yearly': 4}[tier]]}
                       for s in snapshots]
            entries.append({'path': path, 'bytes': len(contents.encode()), 'snapshots': len(snapshots), 'periods': periods})
        catalog['series'][tier] = entries
    all_snapshots = [s for rows in result.values() for s in rows.values()]
    latest = max(all_snapshots, key=lambda s: timestamp(s['source_updated_at'])) if all_snapshots else None
    catalog['latest'] = ({'date': latest['date'], 'source_commit': latest['source_commit'],
                          'source_updated_at': latest['source_updated_at'], 'profiles': len(latest['users'])} if latest else None)
    files['index.json'] = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    return files


def save_history(root, files):
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError('History root must not be a symlink')
    # All parsing and validation happen before writes. Atomic replacement per file.
    for name, contents in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError('Unsafe history path')
        if path.exists() and path.read_text() == contents:
            continue
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.' + path.name + '.', delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(contents)
        try:
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    for tier in ('daily', 'monthly', 'yearly'):
        for path in (root / tier).glob('*.json'):
            if path.relative_to(root).as_posix() not in files:
                path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--refresh-base', help='Full HEAD recorded immediately before the upstream refresh')
    mode.add_argument('--seed', action='store_true', help='Initialize from the existing committed cache with its original date')
    mode.add_argument('--prune-only', action='store_true', help='Maintain retention without creating an observation')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    root = ROOT / 'docs/history'
    records = load_history(root)
    snapshot, reason = None, 'retention only'
    if not args.prune_only:
        snapshot, reason = source_snapshot(ROOT, now, args.refresh_base, args.seed)
        if args.seed and any(records.values()):
            existing = [s for rows in records.values() for s in rows.values()]
            if not snapshot or any(s['source_commit'] != snapshot['source_commit'] for s in existing):
                raise ValueError('--seed is only for empty history or an identical repeat')
    files = plan_history(records, snapshot, now.astimezone(ZONE).date())
    save_history(root, files)
    size = sum(len(contents.encode()) for contents in files.values())
    print(f'{"CAPTURED " + snapshot["date"] if snapshot else "SKIPPED capture"}: {reason}; {len(files)} JSON files, {size:,} bytes')


if __name__ == '__main__':
    main()
