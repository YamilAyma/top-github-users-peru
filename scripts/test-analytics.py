"""Regression checks for the analytics engine: data quality and statistics helpers."""
import unittest
from analytics import snapshot_quality, quality_report, usable, linear_fit, confidence, percentile


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


if __name__ == '__main__':
    unittest.main()
