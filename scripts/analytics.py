"""Analytics engine: data-quality checks and small statistics helpers.

Pure functions over the validated daily snapshots (see evolution.py). Nothing here
touches the network or the filesystem, so every rule can be unit tested.
"""
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
    return {'slope': slope, 'intercept': intercept, 'r2': r2, 'n': n, 'slopeStdErr': stderr}


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
