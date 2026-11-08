"""Analytics engine: data-quality checks and small statistics helpers.

Pure functions over the validated daily snapshots (see evolution.py). Nothing here
touches the network or the filesystem, so every rule can be unit tested.
"""
from bisect import bisect_right
from datetime import date
from statistics import median
import sys
sys.dont_write_bytecode = True

ENGINE_VERSION = 1
# A snapshot with fewer profiles than this share of its neighbours' median is incomplete.
MIN_COVERAGE = 0.8
# Below this expected profile count a coverage check is just noise, so it is skipped.
MIN_EXPECTED = 50
# Neighbours used as the expectation for the profile count (each side).
NEIGHBOURS = 3
# Share of matched profiles whose public counter drops at once, and the minimum sample to trust it.
WINDOW_SHIFT_DROP = 0.15
WINDOW_SHIFT_MIN_MATCHED = 50
# A single jump explaining at least this share of the growth caps the confidence at 'baja'.
JUMP_DRIVEN_SHARE = 0.5
THRESHOLDS = {'minCoverage': MIN_COVERAGE, 'minExpectedProfiles': MIN_EXPECTED, 'windowShiftDrop': WINDOW_SHIFT_DROP,
              'windowShiftMinMatched': WINDOW_SHIFT_MIN_MATCHED, 'neighbours': NEIGHBOURS}


def _by_login(snapshot):
    return {row[0].lower(): row for row in snapshot['users']}


def snapshot_quality(daily):
    """Return one quality record per daily snapshot, oldest first.

    status is one of:
      ok            nothing unusual
      incomplete    far fewer profiles than expected; excluded from aggregates
      window-shift  many public counters dropped together (a rolling-window adjustment, not activity); kept but flagged
      duplicate     identical source data to the previous snapshot; kept but flagged
    """
    ordered = sorted(daily, key=lambda s: s['date'])
    counts = [len(s['users']) for s in ordered]
    records = []
    previous = None  # the last snapshot that is not incomplete
    for index, snapshot in enumerate(ordered):
        neighbours = counts[max(0, index - NEIGHBOURS):index] + counts[index + 1:index + 1 + NEIGHBOURS]
        expected = median(neighbours) if neighbours else counts[index]
        coverage = counts[index] / expected if expected else 1.0
        record = {'date': snapshot['date'], 'profiles': counts[index], 'expectedProfiles': round(expected),
                  'coverage': round(coverage, 3), 'weekday': date.fromisoformat(snapshot['date']).weekday(),
                  'matched': None, 'dropShare': None, 'status': 'ok', 'excluded': False, 'reasons': []}
        if expected >= MIN_EXPECTED and coverage < MIN_COVERAGE:
            record.update(status='incomplete', excluded=True, reasons=['low-coverage'])
        else:
            if previous is not None:
                now, before = _by_login(snapshot), _by_login(previous)
                common = now.keys() & before.keys()
                record['matched'] = len(common)
                if common:
                    drops = sum(1 for key in common if now[key][1] < before[key][1])
                    record['dropShare'] = round(drops / len(common), 3)
                if len(common) >= WINDOW_SHIFT_MIN_MATCHED and record['dropShare'] >= WINDOW_SHIFT_DROP:
                    record.update(status='window-shift', reasons=['window-shift'])
                if snapshot.get('cache_sha256') and snapshot.get('cache_sha256') == previous.get('cache_sha256'):
                    record.update(status='duplicate', reasons=record['reasons'] + ['duplicate'])
            previous = snapshot
        records.append(record)
    return records


def quality_report(daily):
    records = snapshot_quality(daily)
    flagged = {}
    for record in records:
        if record['status'] != 'ok':
            flagged.setdefault(record['status'], []).append(record['date'])
    return {'version': ENGINE_VERSION, 'thresholds': THRESHOLDS, 'checked': len(records),
            'excluded': [r['date'] for r in records if r['excluded']], 'flagged': flagged, 'snapshots': records}


def usable(daily, report):
    """Snapshots that are safe to use for aggregates and baselines."""
    excluded = set(report['excluded'])
    return [s for s in daily if s['date'] not in excluded]


def linear_fit(points):
    """Least squares over (x, y) pairs. Returns None when there is no usable trend.

    Result: slope, intercept, r2 (None for a flat series), n and the standard error of the slope.
    """
    data = [(float(x), float(y)) for x, y in points if y is not None]
    n = len(data)
    if n < 3:
        return None
    mean_x, mean_y = sum(x for x, _ in data) / n, sum(y for _, y in data) / n
    sxx = sum((x - mean_x) ** 2 for x, _ in data)
    if sxx == 0:
        return None
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in data)
    syy = sum((y - mean_y) ** 2 for _, y in data)
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x
    residual = sum((y - (intercept + slope * x)) ** 2 for x, y in data)
    r2 = None if syy == 0 else max(0.0, 1 - residual / syy)
    stderr = (residual / (n - 2) / sxx) ** 0.5 if n > 2 else None
    return {'slope': slope, 'intercept': intercept, 'r2': r2, 'n': n, 'slopeStdErr': stderr,
            'residualStd': (residual / (n - 2)) ** 0.5, 'meanX': mean_x, 'sxx': sxx}


def confidence(n, span_days, r2=None):
    """Plain-language confidence for a trend or projection: insufficient, low, medium or high."""
    if n < 5 or span_days < 7:
        return 'insuficiente'
    if n < 10 or span_days < 14:
        return 'baja'
    if n < 20 or span_days < 30 or (r2 is not None and r2 < 0.5):
        return 'media'
    return 'alta'


def percentile(values, p):
    """Linear-interpolated percentile (0–100) of a list of numbers."""
    data = sorted(values)
    if not data:
        return None
    if len(data) == 1:
        return float(data[0])
    position = (len(data) - 1) * p / 100
    low = int(position)
    high = min(low + 1, len(data) - 1)
    return data[low] + (data[high] - data[low]) * (position - low)


# Two-sided 95 % Student t critical values by degrees of freedom (falls back to the normal 1.96).
_T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
        12: 2.179, 15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042, 60: 2.000}


def t_critical(df):
    if df < 1:
        return None
    keys = [k for k in _T95 if k <= df]
    return _T95[max(keys)] if df < 60 else 1.96


def predict(fit, x):
    """Point forecast and 95 % prediction interval at x for a fit from linear_fit."""
    y = fit['intercept'] + fit['slope'] * x
    t = t_critical(fit['n'] - 2)
    if t is None:
        return y, y, y
    spread = t * fit['residualStd'] * (1 + 1 / fit['n'] + (x - fit['meanX']) ** 2 / fit['sxx']) ** 0.5
    return y, y - spread, y + spread


def trend_label(fit):
    """alza / baja / estable. A slope within two standard errors of zero is not distinguishable from flat."""
    if fit is None:
        return 'sin-datos'
    slope, error = fit['slope'], fit['slopeStdErr']
    if slope == 0 or error is None or (error > 0 and abs(slope) < 2 * error):
        return 'estable'
    return 'alza' if slope > 0 else 'baja'


def _series(daily, metric_value):
    """login -> [(day offset, value)] over the given (already filtered) daily snapshots."""
    ordered = sorted(daily, key=lambda s: s['date'])
    origin = date.fromisoformat(ordered[0]['date'])
    series = {}
    for snapshot in ordered:
        x = (date.fromisoformat(snapshot['date']) - origin).days
        for row in snapshot['users']:
            series.setdefault(row[0].lower(), []).append((x, metric_value(row), snapshot['date'], row[0]))
    return series, origin


def jumps(points, minimum=10, factor=5):
    """Days where the counter rose far above the user's own typical daily pace."""
    steps = []
    for (x0, v0, _, _), (x1, v1, d1, _) in zip(points, points[1:]):
        days = max(1, x1 - x0)
        steps.append((v1 - v0, days, d1))
    positive = [delta / days for delta, days, _ in steps if delta > 0]
    typical = max(1.0, median(positive)) if positive else 1.0
    growth = sum(delta for delta, _, _ in steps if delta > 0)
    found = []
    for delta, days, day in steps:
        if delta >= minimum and delta / days >= factor * typical:
            found.append({'date': day, 'delta': delta, 'times': round(delta / days / typical, 1),
                          'share': round(delta / growth, 2) if growth else None})
    return sorted(found, key=lambda j: -j['delta'])[:2]


def build_user_insights(daily, metric_value, horizon=30):
    """Per-user pace, trend, confidence, 30-day projection (value and rank) and notable jumps.

    `daily` must already exclude incomplete captures. Nothing is projected without enough history.
    """
    if len(daily) < 2:
        return {}
    series, origin = _series(daily, metric_value)
    last_day = (date.fromisoformat(max(s['date'] for s in daily)) - origin).days
    target = last_day + horizon
    current = {login: pts[-1][1] for login, pts in series.items() if pts[-1][0] == last_day}
    names = {login: pts[-1][3] for login, pts in series.items()}
    base = {}
    for login, pts in series.items():
        if login not in current:
            continue
        fit = linear_fit([(x, v) for x, v, _, _ in pts])
        span = pts[-1][0] - pts[0][0]
        entry = {'n': len(pts), 'spanDays': span,
                 'trend': trend_label(fit), 'confidence': confidence(len(pts), span, fit['r2'] if fit else None)}
        entry['perDay'] = round((pts[-1][1] - pts[0][1]) / span, 2) if span else None
        earlier = [p for p in pts if p[0] <= last_day - 7]
        entry['recentPerDay'] = round((pts[-1][1] - earlier[-1][1]) / (pts[-1][0] - earlier[-1][0]), 2) if earlier else None
        if fit:
            entry['slope'] = round(fit['slope'], 3)
            entry['r2'] = None if fit['r2'] is None else round(fit['r2'], 3)
            central, low, high = predict(fit, target)
        else:
            central = low = high = current[login]
        base[login] = (entry, central, max(0, low), max(0, high))
        entry['jumps'] = jumps(pts)
        if entry['jumps'] and (entry['jumps'][0]['share'] or 0) >= JUMP_DRIVEN_SHARE:
            # One event explains most of the growth: a straight line through it says little about the future.
            entry['jumpDriven'] = True
            if entry['confidence'] in ('media', 'alta'):
                entry['confidence'] = 'baja'
    ordered_central = sorted(c for _, c, _, _ in base.values())

    def above(x, exclude):
        count = len(ordered_central) - bisect_right(ordered_central, x)
        return count - (1 if base[exclude][1] > x else 0)

    ranked = sorted(current.items(), key=lambda kv: (-kv[1], kv[0]))
    insights = {}
    for login, (entry, central, low, high) in base.items():
        if entry['confidence'] != 'insuficiente':
            entry['projection'] = {'days': horizon, 'value': round(max(0, central)), 'low': round(low), 'high': round(high),
                                   'rank': 1 + above(central, login), 'rankBest': 1 + above(high, login), 'rankWorst': 1 + above(low, login)}
        # Nearest account above and how long it would take to catch it at the current linear paces.
        higher = [(l, v) for l, v in ranked if v > current[login]]
        if higher:
            rival_login, rival_value = min(higher, key=lambda lv: (lv[1], lv[0]))
            rival_slope = base[rival_login][0].get('slope')
            own_slope = entry.get('slope')
            if own_slope is not None and rival_slope is not None and own_slope > rival_slope:
                days = (rival_value - current[login]) / (own_slope - rival_slope)
                if days <= 180:
                    entry['catchUp'] = {'login': names[rival_login], 'gap': rival_value - current[login], 'days': round(days)}
        insights[login] = entry
    return insights
