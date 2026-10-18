"""Regression checks for historical comparisons, ranks and unknown city coverage."""
from datetime import date
import json
from pathlib import Path
import tempfile
import unittest
from evolution import ranked, scope_rows, comparison, build_history_views, storage


def snap(day, users, membership=None):
    result = {'date': day, 'source_updated_at': day + 'T18:00:00Z', 'source_commit': 'a' * 40,
              'cache_sha256': 'b' * 64, 'users': users}
    if membership is not None:
        result['city_membership'] = membership
    return result


class EvolutionTests(unittest.TestCase):
    def test_competition_ties_case_and_totals(self):
        s = snap('2026-10-01', [['Alice', 10, 0, 1], ['bob', 10, 4, 1], ['carol', 5, 0, 2]])
        self.assertEqual(ranked(s, 'publicContributions'), {'alice': 1, 'bob': 1, 'carol': 3})
        self.assertEqual(ranked(s, 'total')['bob'], 1)
        self.assertEqual(ranked(s, 'followers')['carol'], 1)

    def test_city_unknown_and_empty_are_distinct(self):
        s = snap('2026-10-01', [['alice', 2, 0, 1]])
        self.assertIsNone(scope_rows(s, 'lima'))
        s['city_membership'] = {'lima': []}
        self.assertEqual(scope_rows(s, 'lima'), [])

    def test_matched_delta_separates_entries_exits_and_declines(self):
        a = snap('2026-10-01', [['Alice', 20, 0, 1], ['bob', 10, 0, 2]])
        b = snap('2026-10-09', [['alice', 15, 0, 4], ['carol', 100, 0, 5]])
        delta = comparison(a, b)
        self.assertEqual((delta['matched'], delta['entered'], delta['left']), (1, 1, 1))
        self.assertEqual(delta['publicDeltaMatched'], -5)
        self.assertEqual(delta['followersDeltaMatched'], 3)
        self.assertEqual(delta['movers'], [])
        self.assertIsNone(comparison(a, b, 'lima'))

    def test_derived_series_preserve_gaps_and_never_invent_city_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            docs = Path(tmp)
            a = snap('2026-10-01', [['alice', 20, 0, 1]])
            b = snap('2026-10-09', [['alice', 15, 0, 2], ['bob', 30, 0, 3]], {'lima': [1]})
            records = {tier: {} for tier in ('daily', 'monthly', 'yearly')}
            for s in (a, b):
                for tier in records:
                    records[tier][storage.period_key(s, tier)] = s
            storage.save_history(docs / 'history', storage.plan_history(records, None, date(2026, 10, 9)))
            summary = build_history_views(docs, ['lima'])
            self.assertEqual(summary['scopes']['lima']['series']['daily'][0]['profiles'], None)
            self.assertIsNone(summary['scopes']['lima']['weekly'])
            self.assertEqual(summary['scopes']['peru']['weekly']['from'], '2026-10-01')
            trends = json.loads((docs / 'data/trends-publicContributions.json').read_text())
            self.assertEqual(trends['dates'], ['2026-10-01', '2026-10-09'])
            self.assertEqual(trends['ranks']['bob'], [None, 1])
            self.assertEqual(trends['ranks']['alice'], [1, 2])

if __name__ == '__main__':
    unittest.main(verbosity=2)
