"""Regression checks for the analytics engine: data quality and statistics helpers."""
import unittest
from analytics import (snapshot_quality, quality_report, usable, linear_fit, confidence, percentile,
                       t_critical, predict, trend_label, jumps, build_user_insights, gini, top_share, log_histogram,
                       build_group_insights)


def snap(day, count, public=10, sha=None, bump=None):
    users = [[f'user{i}', public + (bump(i) if bump else 0), 0, 5] for i in range(count)]
    return {'date': day, 'users': users, 'cache_sha256': sha or day}


class QualityTests(unittest.TestCase):
    def test_incomplete_snapshot_is_flagged_and_excluded(self):
        daily = [snap(f'2026-10-{d:02d}', 100) for d in (1, 2, 3)] + [snap('2026-10-04', 40)] + [snap(f'2026-10-{d:02d}', 100) for d in (5, 6, 7)]
        report = quality_report(daily)
        self.assertEqual(report['excluded'], ['2026-10-04'])
        self.assertEqual(report['flagged']['incomplete'], ['2026-10-04'])
        record = next(r for r in report['snapshots'] if r['date'] == '2026-10-04')
        self.assertLess(record['coverage'], 0.5)
        self.assertEqual(record['reasons'], ['low-coverage'])
        self.assertEqual([s['date'] for s in usable(daily, report)], [d for d in (s['date'] for s in daily) if d != '2026-10-04'])

    def test_neighbour_after_incomplete_compares_with_last_complete_snapshot(self):
        daily = [snap('2026-10-01', 100), snap('2026-10-02', 100), snap('2026-10-03', 40), snap('2026-10-04', 100), snap('2026-10-05', 100)]
        records = {r['date']: r for r in snapshot_quality(daily)}
        self.assertEqual(records['2026-10-04']['status'], 'ok')
        self.assertEqual(records['2026-10-04']['matched'], 100)

    def test_window_shift_when_many_counters_drop_together(self):
        before = snap('2026-10-18', 100, public=50)
        after = snap('2026-10-19', 100, public=50, bump=lambda i: -3 if i < 25 else 1)
        records = snapshot_quality([before, after])
        self.assertEqual(records[1]['status'], 'window-shift')
        self.assertEqual(records[1]['dropShare'], 0.25)
        self.assertEqual(records[1]['weekday'], 0)  # 2026-10-19 is a Monday
        self.assertFalse(records[1]['excluded'])

    def test_tiny_snapshots_are_not_judged_on_coverage(self):
        daily = [snap('2026-10-01', 1), snap('2026-10-02', 2), snap('2026-10-03', 2)]
        self.assertEqual(quality_report(daily)['excluded'], [])

    def test_few_drops_are_normal(self):
        before = snap('2026-10-18', 100, public=50)
        after = snap('2026-10-19', 100, public=50, bump=lambda i: -1 if i < 3 else 1)
        self.assertEqual(snapshot_quality([before, after])[1]['status'], 'ok')

    def test_small_samples_do_not_trigger_window_shift(self):
        before = snap('2026-10-18', 20, public=50)
        after = snap('2026-10-19', 20, public=50, bump=lambda i: -3)
        self.assertEqual(snapshot_quality([before, after])[1]['status'], 'ok')

    def test_duplicate_source_is_flagged_but_kept(self):
        daily = [snap('2026-10-01', 100, sha='x'), snap('2026-10-02', 100, sha='x')]
        records = snapshot_quality(daily)
        self.assertEqual(records[1]['status'], 'duplicate')
        self.assertFalse(records[1]['excluded'])

    def test_single_snapshot_and_empty_history(self):
        self.assertEqual(snapshot_quality([snap('2026-10-01', 50)])[0]['status'], 'ok')
        self.assertEqual(quality_report([])['checked'], 0)


class StatsTests(unittest.TestCase):
    def test_linear_fit_exact_line(self):
        fit = linear_fit([(0, 1), (1, 3), (2, 5), (3, 7)])
        self.assertAlmostEqual(fit['slope'], 2)
        self.assertAlmostEqual(fit['intercept'], 1)
        self.assertAlmostEqual(fit['r2'], 1)
        self.assertEqual(fit['n'], 4)

    def test_linear_fit_ignores_missing_and_needs_three_points(self):
        self.assertIsNone(linear_fit([(0, 1), (1, None), (2, 5)]))
        self.assertIsNone(linear_fit([(1, 1), (1, 2), (1, 3)]))
        self.assertAlmostEqual(linear_fit([(0, 0), (1, None), (2, 2), (3, 3)])['slope'], 1)

    def test_flat_series_has_no_r2(self):
        fit = linear_fit([(0, 5), (1, 5), (2, 5)])
        self.assertEqual(fit['slope'], 0)
        self.assertIsNone(fit['r2'])

    def test_confidence_tiers(self):
        self.assertEqual(confidence(3, 3), 'insuficiente')
        self.assertEqual(confidence(8, 10), 'insuficiente' if 8 < 5 else 'baja')
        self.assertEqual(confidence(12, 20), 'media')
        self.assertEqual(confidence(22, 21, r2=0.9), 'media')
        self.assertEqual(confidence(25, 40, r2=0.9), 'alta')
        self.assertEqual(confidence(25, 40, r2=0.2), 'media')

    def test_percentile(self):
        self.assertEqual(percentile([], 50), None)
        self.assertEqual(percentile([7], 90), 7)
        self.assertEqual(percentile([1, 2, 3, 4], 50), 2.5)
        self.assertEqual(percentile([4, 1, 3, 2], 100), 4)
        self.assertEqual(percentile([1, 2, 3, 4, 5], 0), 1)


def history(days, users):
    """days: number of daily snapshots; users: {login: callable(day_index) -> value or None}."""
    out = []
    for d in range(days):
        rows = [[login, fn(d), 0, 1] for login, fn in users.items() if fn(d) is not None]
        out.append({'date': f'2026-10-{d + 1:02d}', 'users': rows, 'cache_sha256': str(d)})
    return out


def pub(row):
    return row[1]


class InsightTests(unittest.TestCase):
    def test_pace_trend_and_projection_of_a_linear_user(self):
        data = history(15, {'fast': lambda d: 100 + 10 * d, 'slow': lambda d: 500 + 1 * d})
        ins = build_user_insights(data, pub)
        fast = ins['fast']
        self.assertEqual(fast['trend'], 'alza')
        self.assertAlmostEqual(fast['perDay'], 10)
        self.assertAlmostEqual(fast['slope'], 10)
        self.assertEqual(fast['projection']['value'], 100 + 10 * (14 + 30))
        self.assertEqual(fast['projection']['low'], fast['projection']['high'])  # perfect line: no spread
        self.assertEqual(fast['confidence'], 'media')  # 15 captures over 14 days

    def test_short_history_has_low_confidence(self):
        ins = build_user_insights(history(12, {'a': lambda d: 10 * d, 'b': lambda d: 5}), pub)
        self.assertEqual(ins['a']['confidence'], 'baja')

    def test_projection_overtakes_slower_neighbour_and_catch_up_is_reported(self):
        data = history(12, {'fast': lambda d: 100 + 20 * d, 'slow': lambda d: 500 + 1 * d})
        ins = build_user_insights(data, pub)
        self.assertEqual(ins['fast']['projection']['rank'], 1)   # 100 + 20 * 41 = 920 > 541
        self.assertEqual(ins['slow']['projection']['rank'], 2)
        # fast is at 320, slow at 511; gap 191 closes at 19 per day: ~10 days
        self.assertEqual(ins['fast']['catchUp'], {'login': 'slow', 'gap': 191, 'days': 10})
        self.assertNotIn('catchUp', ins['slow'])

    def test_flat_user_is_stable_without_noise_claims(self):
        ins = build_user_insights(history(12, {'flat': lambda d: 50, 'other': lambda d: 10 + d}), pub)
        self.assertEqual(ins['flat']['trend'], 'estable')
        self.assertEqual(ins['flat']['perDay'], 0)

    def test_noisy_series_without_a_real_trend_is_stable(self):
        wobble = [100, 103, 99, 104, 98, 102, 100, 105, 99, 103, 100, 101]
        ins = build_user_insights(history(12, {'n': lambda d: wobble[d], 'x': lambda d: d}), pub)
        self.assertEqual(ins['n']['trend'], 'estable')

    def test_a_step_is_not_a_trend(self):
        # Flat, one small bump, then flat again: the slope is positive but the line explains little.
        values = [100, 100, 100, 100, 100, 100, 158, 150, 140, 130, 120, 110, 100, 100]
        ins = build_user_insights(history(14, {'step': lambda d: values[d], 'x': lambda d: d}), pub)
        self.assertEqual(ins['step']['trend'], 'estable')

    def test_not_enough_history_means_no_projection(self):
        ins = build_user_insights(history(4, {'a': lambda d: 10 * d, 'b': lambda d: 5}), pub)
        self.assertEqual(ins['a']['confidence'], 'insuficiente')
        self.assertNotIn('projection', ins['a'])
        self.assertEqual(build_user_insights(history(1, {'a': lambda d: 1}), pub), {})

    def test_single_jump_is_flagged_and_caps_confidence(self):
        data = history(14, {'spiky': lambda d: 100 + (500 if d >= 7 else 0) + d, 'x': lambda d: 7})
        entry = build_user_insights(data, pub)['spiky']
        self.assertEqual(entry['jumps'][0]['date'], '2026-10-08')
        self.assertGreaterEqual(entry['jumps'][0]['share'], 0.9)
        self.assertTrue(entry['jumpDriven'])
        self.assertEqual(entry['confidence'], 'baja')
        self.assertIn('projection', entry)

    def test_users_missing_from_the_last_snapshot_are_left_out(self):
        data = history(8, {'stays': lambda d: d, 'left': lambda d: d if d < 5 else None})
        ins = build_user_insights(data, pub)
        self.assertIn('stays', ins)
        self.assertNotIn('left', ins)

    def test_late_arrivals_are_fitted_on_their_own_history(self):
        data = history(14, {'old': lambda d: 10 * d, 'new': lambda d: 3 * d if d >= 6 else None})
        entry = build_user_insights(data, pub)['new']
        self.assertEqual(entry['n'], 8)
        self.assertEqual(entry['spanDays'], 7)
        self.assertAlmostEqual(entry['slope'], 3)

    def test_prediction_interval_widens_with_the_horizon(self):
        fit = linear_fit([(0, 0), (1, 2), (2, 1), (3, 4), (4, 3), (5, 6)])
        _, low30, high30 = predict(fit, 35)
        _, low5, high5 = predict(fit, 10)
        self.assertGreater(high30 - low30, high5 - low5)

    def test_t_critical_and_trend_label_edges(self):
        self.assertEqual(t_critical(1), 12.706)
        self.assertEqual(t_critical(100), 1.96)
        self.assertIsNone(t_critical(0))
        self.assertEqual(trend_label(None), 'sin-datos')

    def test_jumps_ignore_small_changes(self):
        points = [(i, 100 + i, f'2026-10-{i + 1:02d}', 'u') for i in range(8)]
        self.assertEqual(jumps(points), [])


class GroupTests(unittest.TestCase):
    def test_gini_and_concentration(self):
        self.assertEqual(gini([5, 5, 5, 5]), 0)
        self.assertAlmostEqual(gini([0, 0, 0, 100]), 0.75)
        self.assertIsNone(gini([]))
        self.assertIsNone(gini([0, 0]))
        self.assertAlmostEqual(top_share([50, 30, 10, 10], 2), 0.8)
        self.assertIsNone(top_share([0, 0], 1))

    def test_histogram_counts_every_value_once(self):
        values = [0, 1, 2, 5, 10, 40, 100, 500, 1000, 5000]
        histogram = log_histogram(values, bins=5)
        self.assertEqual(sum(histogram['counts']), len(values))
        self.assertEqual(len(histogram['edges']), 6)
        self.assertEqual(histogram['edges'][0], 0)
        self.assertEqual(histogram['edges'][-1], 5000)
        self.assertEqual(log_histogram([7, 7, 7])['counts'], [3])
        self.assertIsNone(log_histogram([]))

    def groups(self, days=12, **users):
        data = history(days, users)
        ins = build_user_insights(data, pub)
        logins = list(users)
        return build_group_insights(data, pub, ins, {'all': logins, 'few': logins[:3], 'ghost': ['nobody']}), ins

    def test_distribution_growth_and_trend_mix(self):
        users = {f'u{i}': (lambda d, i=i: 100 + i * 10 + (5 * d if i < 4 else 0)) for i in range(12)}
        result, _ = self.groups(**users)
        g = result['all']
        self.assertEqual(g['profiles'], 12)
        self.assertFalse(g['small'])
        self.assertEqual(g['growth']['matched'], 12)
        self.assertEqual(g['growth']['growers'], 4)
        self.assertEqual(g['growth']['growersShare'], round(4 / 12, 3))
        self.assertEqual(g['growth']['delta'], 4 * 5 * 11)
        self.assertEqual(g['growth']['top10Share'], 1.0)
        self.assertEqual(g['trends']['alza'], 4)
        self.assertEqual(g['trends']['estable'], 8)
        self.assertEqual(sum(g['histogram']['counts']), 12)
        self.assertGreater(g['gini'], 0)

    def test_small_groups_skip_distribution_statistics(self):
        users = {f'u{i}': (lambda d, i=i: 10 * i + d) for i in range(12)}
        result, _ = self.groups(**users)
        self.assertTrue(result['few']['small'])
        self.assertNotIn('gini', result['few'])
        self.assertNotIn('histogram', result['few'])
        self.assertEqual(result['few']['profiles'], 3)
        self.assertEqual(result['ghost'], {'profiles': 0})

    def test_members_who_arrive_late_do_not_count_as_growth(self):
        users = {f'u{i}': (lambda d, i=i: 10 * i) for i in range(11)}
        users['late'] = lambda d: 5000 if d >= 6 else None
        result, _ = self.groups(days=12, **users)
        g = result['all']['growth']
        self.assertEqual(g['newInGroup'], 1)
        self.assertEqual(g['matched'], 11)
        self.assertEqual(g['delta'], 0)

    def test_emerging_profiles_have_low_base_and_real_growth(self):
        users = {f'big{i}': (lambda d, i=i: 5000 + 100 * i) for i in range(8)}
        users.update({f'low{i}': (lambda d, i=i: 30 + (2 + i) * d) for i in range(4)})
        result, _ = self.groups(days=12, **users)
        emerging = result['all']['growth']['emerging']
        self.assertEqual([e['login'] for e in emerging][:1], ['low3'])
        self.assertTrue(all(e['value'] <= 5000 for e in emerging))
        self.assertFalse(any(e['login'].startswith('big') for e in emerging))


if __name__ == '__main__':
    unittest.main()
