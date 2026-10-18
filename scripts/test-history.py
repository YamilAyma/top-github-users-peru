#!/usr/bin/env python3
"""Exercise calendar retention, provenance and shallow-checkout workflow behavior."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
sys.dont_write_bytecode = True
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('capture_history', Path(__file__).with_name('capture-history.py'))
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


def observation(day, revision=1, users=None):
    return {'date': day, 'source_updated_at': day + 'T18:00:00Z',
            'source_commit': f'{revision:040x}', 'cache_sha256': f'{revision:064x}',
            'users': users if users is not None else [['alice', 10, 2, 5], ['bob', 5, 0, 8]]}


def empty():
    return {key: {} for key in ('daily', 'monthly', 'yearly')}


def read_snapshots(files, tier):
    return [snapshot for path, body in files.items() if path.startswith(tier + '/')
            for snapshot in json.loads(body)['snapshots']]


class StorageTests(unittest.TestCase):
    def test_90_calendar_days_inclusive_and_durable_months_years(self):
        end = date(2027, 4, 1)
        records = empty()
        for i in range(400):
            day = end - timedelta(days=399 - i)
            snapshot = observation(day.isoformat(), i + 1)
            for tier in records:
                records[tier][history.period_key(snapshot, tier)] = snapshot
        files = history.plan_history(records, None, end)
        daily = read_snapshots(files, 'daily')
        self.assertEqual(len(daily), 90)
        self.assertEqual(daily[0]['date'], '2027-01-02')
        self.assertEqual(daily[-1]['date'], '2027-04-01')
        self.assertEqual(next(s for s in read_snapshots(files, 'yearly') if s['date'].startswith('2026'))['date'], '2026-12-31')
        monthly = read_snapshots(files, 'monthly')
        self.assertIn('2026-03-31', [s['date'] for s in monthly])
        index = json.loads(files['index.json'])
        periods = [p for entry in index['series']['monthly'] for p in entry['periods']]
        self.assertTrue(next(p for p in periods if p['period'] == '2026-03')['closed'])
        self.assertFalse(next(p for p in periods if p['period'] == '2027-04')['closed'])

    def test_leap_day_and_no_forward_fill(self):
        records = empty()
        for i, day in enumerate(['2024-02-28', '2024-02-29', '2024-03-03']):
            s = observation(day, i + 1)
            for tier in records:
                records[tier][history.period_key(s, tier)] = s
        files = history.plan_history(records, None, date(2024, 3, 3))
        self.assertEqual([s['date'] for s in read_snapshots(files, 'daily')], ['2024-02-28', '2024-02-29', '2024-03-03'])
        self.assertEqual([s['date'] for s in read_snapshots(files, 'monthly')], ['2024-02-29', '2024-03-03'])

    def test_same_day_replacement_repeat_and_no_regression(self):
        first = observation('2026-12-31', 1)
        later = observation('2026-12-31', 2, [['alice', 3, 0, 4]])
        later['source_updated_at'] = '2026-12-31T23:00:00Z'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = history.plan_history(empty(), first, date(2026, 12, 31))
            history.save_history(root, files)
            files = history.plan_history(history.load_history(root), later, date(2026, 12, 31))
            history.save_history(root, files)
            self.assertEqual(len(read_snapshots(files, 'daily')), 1)
            self.assertEqual(read_snapshots(files, 'yearly'), [later])
            again = history.plan_history(history.load_history(root), later, date(2026, 12, 31))
            self.assertEqual(files, again)
            self.assertEqual(files, history.plan_history(history.load_history(root), first, date(2026, 12, 31)))
            # A missing new-year update closes the prior period, without a fake Jan 1 observation.
            next_year = history.plan_history(history.load_history(root), None, date(2027, 1, 1))
            self.assertEqual(read_snapshots(next_year, 'yearly'), [later])
            period = json.loads(next_year['index.json'])['series']['yearly'][0]['periods'][0]
            self.assertTrue(period['closed'])

    def test_pruning_preserves_archives_and_owner_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note = root / 'notes.txt'
            note.write_text('keep')
            snapshot = observation('2026-01-01')
            history.save_history(root, history.plan_history(empty(), snapshot, date(2026, 1, 1)))
            files = history.plan_history(history.load_history(root), None, date(2026, 7, 1))
            history.save_history(root, files)
            self.assertFalse((root / 'daily/2026-01.json').exists())
            self.assertEqual(read_snapshots(files, 'monthly'), [snapshot])
            self.assertEqual(read_snapshots(files, 'yearly'), [snapshot])
            self.assertEqual(note.read_text(), 'keep')

    def test_schema_validation_and_ambiguous_source(self):
        for users in [[], [['alice', True, 0, 1]], [['alice', -1, 0, 1]], [['Alice', 0, 0, 0], ['alice', 1, 1, 1]], [['alice', 1.0, 0, 1]]]:
            with self.assertRaises(ValueError):
                history.validate_snapshot(observation('2026-10-16', users=users))
        snapshot = observation('2026-10-16')
        snapshot['date'] = '2026-10-17'
        with self.assertRaises(ValueError):
            history.validate_snapshot(snapshot)
        records = empty()
        first = observation('2026-10-16', 1)
        for tier in records:
            records[tier][history.period_key(first, tier)] = first
        with self.assertRaises(ValueError):
            history.plan_history(records, observation('2026-10-16', 2), date(2026, 10, 16))

    def test_optional_city_indices_and_legacy_compatibility(self):
        snapshot = observation('2026-10-16')
        history.validate_snapshot(snapshot)
        snapshot['city_membership'] = {'lima': [0, 1], 'arequipa': []}
        history.validate_snapshot(snapshot)
        for indices in [[True], [2], [1, 0], [0, 0], [-1]]:
            snapshot['city_membership'] = {'lima': indices}
            with self.assertRaises(ValueError):
                history.validate_snapshot(snapshot)

    def test_damaged_history_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'daily').mkdir()
            broken = root / 'daily/2026-10.json'; broken.write_text('{broken')
            with self.assertRaises(ValueError):
                history.load_history(root)
            self.assertEqual(broken.read_text(), '{broken')


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / 'source'
        self.repo.mkdir()
        self.run_git('init', '-q')
        self.run_git('config', 'user.name', 'Test')
        self.run_git('config', 'user.email', 'test@example.invalid')
        (self.repo / 'cache').mkdir()
        self.write_cache(5)
        self.first = self.commit('2026-10-16T02:00:00Z')
        self.now = datetime(2026, 10, 17, 3, tzinfo=timezone.utc)

    def tearDown(self):
        self.tmp.cleanup()

    def run_git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.PIPE).decode().strip()

    def write_cache(self, followers):
        (self.repo / 'cache/peru.json').write_text(json.dumps([{'login': 'alice', 'publicContributions': 10, 'privateContributions': 2, 'followers': followers, 'name': 'Not retained', 'avatarUrl': 'https://example.invalid/not-retained'}]))

    def commit(self, when):
        self.run_git('add', '.')
        env = os.environ.copy(); env.update(GIT_AUTHOR_DATE=when, GIT_COMMITTER_DATE=when)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-qm', 'Update'], env=env, check=True)
        return self.run_git('rev-parse', 'HEAD')

    def test_seed_keeps_source_date_and_only_compact_fields(self):
        snapshot, _ = history.source_snapshot(self.repo, self.now, seed=True)
        self.assertEqual(snapshot['date'], '2026-10-15')
        self.assertEqual(snapshot['users'], [['alice', 10, 2, 5]])
        self.assertEqual(snapshot['cache_sha256'], hashlib.sha256((self.repo / 'cache/peru.json').read_bytes()).hexdigest())

    def test_city_capture_uses_committed_source_configuration(self):
        (self.repo / 'config.json').write_text(json.dumps({'locations': [{'country': 'peru', 'cities': ['lima', 'arequipa']}]}))
        cache = json.loads((self.repo / 'cache/peru.json').read_text())
        cache[0]['location'] = 'Líma, Perú / Arequipa'
        (self.repo / 'cache/peru.json').write_text(json.dumps(cache))
        self.commit('2026-10-17T02:00:00Z')
        snapshot, _ = history.source_snapshot(self.repo, self.now, self.first)
        self.assertEqual(snapshot['city_membership'], {'lima': [0], 'arequipa': [0]})
        (self.repo / 'config.json').write_text('{broken')
        self.assertEqual(history.source_snapshot(self.repo, self.now, self.first)[0], snapshot)

    def test_readme_only_commit_is_not_a_new_capture(self):
        (self.repo / 'README.md').write_text('Changed today')
        self.commit('2026-10-17T02:00:00Z')
        snapshot, reason = history.source_snapshot(self.repo, self.now, self.first)
        self.assertIsNone(snapshot)
        self.assertIn('checkpoint', reason)

    def test_new_committed_cache_is_accepted_and_dirty_cache_rejected(self):
        self.write_cache(6)
        current = self.commit('2026-10-17T02:00:00Z')
        snapshot, _ = history.source_snapshot(self.repo, self.now, self.first)
        self.assertEqual(snapshot['date'], '2026-10-16')
        self.assertEqual(snapshot['source_commit'], current)
        self.write_cache(7)
        self.assertIsNone(history.source_snapshot(self.repo, self.now, self.first)[0])

    def test_stale_and_future_commits(self):
        self.write_cache(6)
        self.commit('2026-10-16T02:00:01Z')
        self.assertIsNone(history.source_snapshot(self.repo, self.now, self.first)[0])
        self.write_cache(7)
        self.commit('2026-10-18T02:00:00Z')
        with self.assertRaises(ValueError):
            history.source_snapshot(self.repo, self.now, self.first)

    def test_cli_capture_repeat_and_skip_without_changing_source(self):
        scripts = self.repo / 'scripts'; scripts.mkdir()
        source = Path(__file__).with_name('capture-history.py')
        script = scripts / source.name; shutil.copyfile(source, script)
        shutil.copyfile(source.with_name('location_rules.py'), scripts / 'location_rules.py')
        self.write_cache(6)
        self.commit((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat())
        command = [sys.executable, str(script), '--refresh-base', self.first]
        first = subprocess.run(command, text=True, capture_output=True, check=True)
        self.assertIn('CAPTURED', first.stdout)
        root = self.repo / 'docs/history'
        before = {str(p): p.read_bytes() for p in root.rglob('*.json')}
        subprocess.run(command, text=True, capture_output=True, check=True)
        self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob('*.json')})
        skipped = subprocess.run([sys.executable, str(script), '--refresh-base', self.run_git('rev-parse', 'HEAD')], text=True, capture_output=True, check=True)
        self.assertIn('SKIPPED capture', skipped.stdout)
        self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob('*.json')})
        self.assertEqual(json.loads((self.repo / 'cache/peru.json').read_text())[0]['followers'], 6)

    def test_shallow_checkout_rejects_false_boundary_date_but_accepts_real_refresh(self):
        (self.repo / 'README.md').write_text('Frontend change')
        self.commit('2026-10-17T01:00:00Z')
        clone = Path(self.tmp.name) / 'shallow'
        subprocess.run(['git', 'clone', '-q', '--depth=1', self.repo.as_uri(), str(clone)], check=True)
        checkpoint = history.git(clone, 'rev-parse', 'HEAD').decode().strip()
        self.assertEqual(history.git(clone, 'rev-parse', '--is-shallow-repository').decode().strip(), 'true')
        self.assertIsNone(history.source_snapshot(clone, self.now, checkpoint)[0])
        self.write_cache(6)
        source = self.commit('2026-10-17T02:00:00Z')
        subprocess.run(['git', '-C', str(clone), 'fetch', '-q', 'origin'], check=True)
        subprocess.run(['git', '-C', str(clone), 'merge', '-q', '--ff-only', 'origin/' + self.run_git('branch', '--show-current')], check=True)
        snapshot, _ = history.source_snapshot(clone, self.now, checkpoint)
        self.assertEqual(snapshot['source_commit'], source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
