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
# Distribution and concentration statistics need a minimum group size to mean anything.
MIN_GROUP = 10
# Gap between a profile's percentile by activity and by audience that makes it stand out, and the minimum sample.
RANK_GAP = 0.6
MIN_SCATTER = 30
# Weeks of history needed before a seasonal reading is meaningful.
SEASONALITY_WEEKS = 8
# Minimum R2 for calling a series a trend instead of noise or a one-off step.
MIN_TREND_R2 = 0.3
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
    """alza / baja / estable. Needs a slope clearly away from zero and a line that explains the series (R2 >= 0.3)."""
    if fit is None:
        return 'sin-datos'
    slope, error = fit['slope'], fit['slopeStdErr']
    if slope == 0 or error is None or (error > 0 and abs(slope) < 2 * error) or (fit['r2'] is not None and fit['r2'] < MIN_TREND_R2):
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


def gini(values):
    """Gini coefficient (0 = perfectly even, 1 = everything in one profile) of non-negative numbers."""
    data = sorted(v for v in values if v is not None)
    n, total = len(data), sum(data)
    if n == 0 or total <= 0:
        return None
    weighted = sum((index + 1) * value for index, value in enumerate(data))
    return max(0.0, (2 * weighted) / (n * total) - (n + 1) / n)


def top_share(values, count):
    """Share of the total held by the `count` largest values."""
    data = sorted((v for v in values if v is not None), reverse=True)
    total = sum(data)
    return sum(data[:count]) / total if total > 0 else None


def log_histogram(values, bins=8):
    """Counts on log-spaced buckets between the smallest and largest value. Edges are rounded, counts exact."""
    from math import expm1, log1p
    data = [v for v in values if v is not None]
    if not data:
        return None
    low, high = min(data), max(data)
    if low == high:
        return {'edges': [low, high], 'counts': [len(data)]}
    step = (log1p(high) - log1p(low)) / bins
    edges = [round(expm1(log1p(low) + step * i)) for i in range(bins)] + [high]
    counts = [0] * bins
    for v in data:
        index = min(bins - 1, int((log1p(v) - log1p(low)) / step))
        counts[index] += 1
    return {'edges': edges, 'counts': counts}


def group_summary(logins, series, current, insights, names, first_day, last_day):
    """Distribution, concentration, growth and trend mix for one group of profiles.

    `logins` are lowercase members, `series` maps login -> [(day, value, date, name)], `current` login -> latest value.
    Growth compares the same members at the first and last usable capture, so entries and exits do not inflate it.
    """
    members = [l for l in logins if l in current]
    values = [current[l] for l in members]
    result = {'profiles': len(members)}
    if not members:
        return result
    result['total'] = sum(values)
    result['small'] = len(members) < MIN_GROUP
    if not result['small']:
        result.update(mean=round(sum(values) / len(values), 1), median=median(values), p90=round(percentile(values, 90)),
                      p99=round(percentile(values, 99)), max=max(values), gini=round(gini(values), 3),
                      top10Share=round(top_share(values, 10), 3), top1PctShare=round(top_share(values, max(1, round(len(values) * 0.01))), 3),
                      histogram=log_histogram(values))
    # Growth between the first and last usable captures, for members present in both.
    deltas, firsts = {}, {}
    for login in members:
        points = series[login]
        if points[0][0] == first_day:
            firsts[login] = points[0][1]
            deltas[login] = current[login] - points[0][1]
    growth = {'matched': len(deltas), 'newInGroup': len(members) - len(deltas)}
    if deltas:
        positive = {l: d for l, d in deltas.items() if d > 0}
        gained = sum(positive.values())
        base = sum(firsts.values())
        growth.update(delta=sum(deltas.values()), pct=round(sum(deltas.values()) / base * 100, 2) if base else None,
                      growers=len(positive), growersShare=round(len(positive) / len(deltas), 3), medianDelta=median(deltas.values()),
                      top10Share=round(sum(sorted(positive.values(), reverse=True)[:10]) / gained, 3) if gained else None)
        if len(members) >= MIN_GROUP:
            cutoff = median(values)
            emerging = [(l, deltas[l] / max(20, firsts[l])) for l in positive if current[l] <= cutoff and len(series[l]) >= 5 and firsts[l] >= 0]
            growth['emerging'] = [{'login': names[l], 'delta': deltas[l], 'pct': round(r * 100), 'value': current[l]}
                                  for l, r in sorted(emerging, key=lambda t: (-t[1], t[0]))[:5]]
            growth['topGainers'] = [{'login': names[l], 'delta': d} for l, d in sorted(positive.items(), key=lambda t: (-t[1], t[0]))[:5]]
    result['growth'] = growth
    mix = {}
    for login in members:
        trend = (insights.get(login) or {}).get('trend', 'sin-datos')
        mix[trend] = mix.get(trend, 0) + 1
    result['trends'] = mix
    paces = [insights[l]['perDay'] for l in members if l in insights and insights[l].get('perDay') is not None]
    result['medianPerDay'] = round(median(paces), 2) if paces else None
    return result


def build_group_insights(daily, metric_value, insights, scopes):
    """Group summaries for every scope. `scopes` maps scope id -> list of member logins (lowercase)."""
    if len(daily) < 2:
        return {}
    series, origin = _series(daily, metric_value)
    last_day = (date.fromisoformat(max(s['date'] for s in daily)) - origin).days
    first_day = 0
    current = {login: pts[-1][1] for login, pts in series.items() if pts[-1][0] == last_day}
    names = {login: pts[-1][3] for login, pts in series.items()}
    return {scope: group_summary(members, series, current, insights, names, first_day, last_day) for scope, members in scopes.items()}


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mean_x, mean_y = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    syy = sum((y - mean_y) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / (sxx * syy) ** 0.5


def _average_ranks(values):
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def spearman(xs, ys):
    """Rank correlation: robust to the heavy tails these counters have."""
    return pearson(_average_ranks(xs), _average_ranks(ys))


def scatter_analysis(rows):
    """How activity (public contributions) relates to audience (followers) across profiles.

    Profiles are compared by percentile, so the heavy tails and the minimum-follower cut-off do not distort the result.
    rows: (login, public contributions, followers). Needs MIN_SCATTER profiles; returns None otherwise.
    """
    from math import log1p
    n = len(rows)
    if n < MIN_SCATTER:
        return None
    public, followers = [r[1] for r in rows], [r[2] for r in rows]
    p_public = [(rank - 0.5) / n for rank in _average_ranks(public)]
    p_followers = [(rank - 0.5) / n for rank in _average_ranks(followers)]
    gaps = [(row, a - b) for row, a, b in zip(rows, p_public, p_followers)]
    pack = lambda items: [{'login': r[0], 'public': r[1], 'followers': r[2], 'gap': round(abs(g), 2)} for r, g in items[:5]]
    activity = sorted((t for t in gaps if t[1] >= RANK_GAP), key=lambda t: (-t[1], t[0][0]))
    audience = sorted((t for t in gaps if t[1] <= -RANK_GAP), key=lambda t: (t[1], t[0][0]))
    rho, r = spearman(public, followers), pearson([log1p(v) for v in public], [log1p(v) for v in followers])
    # A correlation is undefined when one axis has no variation; report it as missing instead of failing.
    return {'n': n, 'spearman': None if rho is None else round(rho, 3), 'pearsonLog': None if r is None else round(r, 3),
            'rankGap': RANK_GAP, 'moreAudience': pack(audience), 'moreActivity': pack(activity),
            'audienceCount': len(audience), 'activityCount': len(activity)}


def community_health(daily):
    """Registered profiles, weekly growth, who is moving and entry/exit rotation over the usable captures."""
    ordered = sorted(daily, key=lambda s: s['date'])
    if len(ordered) < 2:
        return None
    logins = [{row[0].lower() for row in s['users']} for s in ordered]
    rotation = [{'date': ordered[i]['date'], 'profiles': len(logins[i]), 'entered': len(logins[i] - logins[i - 1]), 'left': len(logins[i - 1] - logins[i])}
                for i in range(1, len(ordered))]
    latest, latest_date = ordered[-1], date.fromisoformat(ordered[-1]['date'])
    older = [s for s in ordered[:-1] if (latest_date - date.fromisoformat(s['date'])).days >= 7]
    result = {'profiles': len(latest['users']), 'rotation': rotation,
              'medianPublic': median(r[1] for r in latest['users']), 'medianFollowers': median(r[3] for r in latest['users'])}
    if older:
        base = older[-1]
        before, now = {r[0].lower(): r for r in base['users']}, {r[0].lower(): r for r in latest['users']}
        common = before.keys() & now.keys()
        grew = sum(1 for k in common if now[k][1] > before[k][1])
        result['weekly'] = {'from': base['date'], 'through': latest['date'], 'matched': len(common),
                            'publicDelta': sum(now[k][1] - before[k][1] for k in common),
                            'followersDelta': sum(now[k][3] - before[k][3] for k in common),
                            'activeShare': round(grew / len(common), 3) if common else None,
                            'entered': len(now.keys() - before.keys()), 'left': len(before.keys() - now.keys())}
    return result


def geo_concentration(latest, cities):
    """Share of profiles and of public contributions per city (profiles can declare several cities)."""
    users = latest['users']
    total_profiles, total_public = len(users), sum(r[1] for r in users) or 1
    membership = latest.get('city_membership') or {}
    rows, covered = [], set()
    for city in cities:
        indices = membership.get(city)
        if not indices:
            continue
        covered.update(indices)
        rows.append({'id': city, 'profiles': len(indices), 'share': round(len(indices) / total_profiles, 3),
                     'publicShare': round(sum(users[i][1] for i in indices) / total_public, 3)})
    rows.sort(key=lambda r: (-r['profiles'], r['id']))
    return {'cities': rows, 'unassigned': total_profiles - len(covered), 'profiles': total_profiles}


def seasonality_status(daily):
    ordered = sorted(daily, key=lambda s: s['date'])
    weeks = ((date.fromisoformat(ordered[-1]['date']) - date.fromisoformat(ordered[0]['date'])).days // 7) if len(ordered) > 1 else 0
    return {'available': weeks >= SEASONALITY_WEEKS, 'weeks': weeks, 'neededWeeks': SEASONALITY_WEEKS}


def build_community(daily, cities):
    if len(daily) < 2:
        return None
    latest = sorted(daily, key=lambda s: s['date'])[-1]
    rows = [(r[0], r[1], r[3]) for r in latest['users']]
    scatter = scatter_analysis(rows)
    return {'health': community_health(daily), 'scatter': scatter, 'geo': geo_concentration(latest, cities),
            'seasonality': seasonality_status(daily),
            'points': [[row[0], row[1], row[3], row[1] + row[2]] for row in latest['users']] if scatter else []}
