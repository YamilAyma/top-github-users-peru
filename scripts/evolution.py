"""Build small, public derived history views from validated observations."""
from datetime import date
import importlib.util
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('history_storage', Path(__file__).with_name('capture-history.py'))
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)
METRICS = ('publicContributions', 'total', 'followers')


def metric_value(row, metric):
    return row[1] + row[2] if metric == 'total' else row[3] if metric == 'followers' else row[1]


def ranked(snapshot, metric):
    ordered = sorted(snapshot['users'], key=lambda row: (-metric_value(row, metric), row[0].lower()))
    ranks = {}
    previous = None
    for index, row in enumerate(ordered):
        value = metric_value(row, metric)
        if value != previous:
            rank = index + 1
        ranks[row[0].lower()] = rank
        previous = value
    return ranks


def scope_rows(snapshot, city):
    if not city:
        return snapshot['users']
    membership = snapshot.get('city_membership', {})
    if city not in membership:
        return None  # Unknown location coverage is not an empty city.
    return [snapshot['users'][index] for index in membership[city]]


def point(snapshot, city):
    rows = scope_rows(snapshot, city)
    return {'date': snapshot['date'], 'profiles': len(rows) if rows is not None else None,
            'publicContributions': sum(row[1] for row in rows) if rows is not None else None,
            'followers': sum(row[3] for row in rows) if rows is not None else None}


def comparison(before, after, city=''):
    first, last = scope_rows(before, city), scope_rows(after, city)
    if first is None or last is None:
        return None
    a, b = ({r[0].lower(): r for r in rows} for rows in (first, last))
    common = a.keys() & b.keys()
    old_ranks, new_ranks = ranked(before, 'publicContributions'), ranked(after, 'publicContributions')
    movers = sorted(({'login': b[key][0], 'change': old_ranks[key] - new_ranks[key]} for key in common),
                    key=lambda row: (-row['change'], row['login'].lower()))
    return {'from': before['date'], 'through': after['date'], 'matched': len(common),
            'entered': len(b.keys() - a.keys()), 'left': len(a.keys() - b.keys()),
            'publicDeltaMatched': sum(b[key][1] - a[key][1] for key in common),
            'followersDeltaMatched': sum(b[key][3] - a[key][3] for key in common),
            'movers': [row for row in movers if row['change'] > 0][:5]}


def build_history_views(docs, cities):
    records = storage.load_history(docs / 'history')
    index_path = docs / 'history/index.json'
    catalog = json.loads(index_path.read_text()) if index_path.exists() else {'daily_window': None, 'latest': None}
    summary = {'version': 1, 'window': catalog['daily_window'], 'latest': catalog['latest'], 'scopes': {}}
    for city in ['', *cities]:
        series = {tier: [point(s, city) for _, s in sorted(rows.items())] for tier, rows in records.items()}
        daily = [s for _, s in sorted(records['daily'].items()) if scope_rows(s, city) is not None]
        weekly = None
        if len(daily) >= 2:
            latest = date.fromisoformat(daily[-1]['date'])
            # Use a real observation 7–14 days earlier, always expose the dates.
            baseline = [s for s in daily[:-1] if 7 <= (latest - date.fromisoformat(s['date'])).days <= 14]
            if baseline:
                weekly = comparison(baseline[-1], daily[-1], city)
        summary['scopes'][city or 'peru'] = {'series': series, 'weekly': weekly}
    out = docs / 'data'
    out.mkdir(exist_ok=True)
    (out / 'evolution-summary.json').write_text(storage.compact(summary) + '\n')
    daily = [s for _, s in sorted(records['daily'].items())]
    dates = [s['date'] for s in daily]
    logins = sorted({r[0].lower() for s in daily for r in s['users']})
    for metric in METRICS:
        daily_ranks = [ranked(s, metric) for s in daily]
        payload = {'version': 1, 'metric': metric, 'window': catalog['daily_window'], 'dates': dates,
                   'ranks': {login: [ranks.get(login) for ranks in daily_ranks] for login in logins}}
        (out / f'trends-{metric}.json').write_text(storage.compact(payload) + '\n')
    return summary
