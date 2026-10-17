#!/usr/bin/env python3
"""Functional browser checks, including GitHub Pages subpath and failure states."""
import csv
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT.parent)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}/{ROOT.name}/docs/'
data = json.loads((ROOT / 'docs/data/peru.json').read_text())
users = data['users']
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
        page = browser.new_page(viewport={'width':1440, 'height':1100}, device_scale_factor=1, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        # Avatars are optional external content. Verify fallback without network dependence.
        page.route('https://avatars.githubusercontent.com/**', lambda route: route.abort())
        page.goto(base, wait_until='networkidle')
        page.wait_for_selector('#rows tr')
        assert page.locator('#rows tr').count() == 25
        assert page.locator('#rows tr').first.locator('.handle').inner_text() == '@' + max(users, key=lambda u:u['publicContributions'])['login']
        assert page.locator('#stat-users').inner_text().replace(',', '') == str(len(users))
        page.locator('[data-metric="followers"]').click()
        assert page.locator('#rows tr').first.locator('.handle').inner_text() == '@' + max(users, key=lambda u:u['followers'])['login']
        # Near-end scrolling appends a batch without replacing existing rows.
        page.evaluate("window.firstRow = document.querySelector('#rows tr')")
        page.locator('#feed-sentinel').scroll_into_view_if_needed()
        page.wait_for_function("document.querySelectorAll('#rows tr').length >= 50")
        assert page.evaluate("window.firstRow === document.querySelector('#rows tr')")
        page.locator('#auto-load').uncheck()
        before = page.locator('#rows tr').count()
        page.locator('footer').scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        assert page.locator('#rows tr').count() == before
        # Manual fallback reaches the exact end, with no duplicated profiles.
        while page.locator('#load-more').is_visible():
            page.locator('#load-more').click()
        assert page.locator('#rows tr').count() == len(users)
        assert 'Llegaste al final' in page.locator('#results').inner_text()
        handles = page.locator('#rows .handle').all_inner_texts()
        assert len(set(handles)) == len(users)
        page.locator('#search').fill('@sergiodxa')
        assert page.locator('#rows tr').count() == 1
        assert page.locator('#rows .profile').get_attribute('href') == 'https://github.com/sergiodxa'
        assert page.locator('#rows .position').inner_text() == '1'
        page.locator('#search').fill('Sergio Xalambri')
        assert page.locator('#rows tr').count() == 1
        page.locator('#city').select_option('arequipa')
        assert page.locator('#rows tr').count() == 0
        assert not page.locator('#export').is_enabled()
        page.locator('#search').fill('')
        expected = [u for u in users if 'arequipa' in u['cities']]
        assert page.locator('#rows tr').count() == min(25, len(expected))
        with page.expect_download() as download_info:
            page.locator('#export').click()
        rows = list(csv.reader(io.StringIO(Path(download_info.value.path()).read_text(encoding='utf-8-sig'))))
        assert len(rows) == len(expected) + 1
        assert rows[1][0] == max(expected, key=lambda u:u['followers'])['login']
        page.locator('#city').select_option('')
        page.locator('[data-metric="total"]').click()
        leader = max(users, key=lambda u:u['publicContributions'] + u['privateContributions'])
        assert page.locator('#rows tr').first.locator('.handle').inner_text() == '@' + leader['login']
        page.locator('button[data-sort="total"]').click()
        assert page.locator('th[data-sort="total"]').get_attribute('aria-sort') == 'ascending'
        assert int(page.locator('#rows tr').first.locator('td').nth(4).inner_text().replace(',', '')) == min(u['publicContributions']+u['privateContributions'] for u in users)
        page.locator('[data-metric="publicContributions"]').click()
        assert page.locator('#rows tr').count() == 25
        page.evaluate('window.scrollTo(0, 0)')
        artifacts = Path('/tmp/peru-dashboard-review'); artifacts.mkdir(exist_ok=True)
        page.screenshot(path=str(artifacts / 'desktop.png'), full_page=True)
        for width in (320,390,768):
            page.set_viewport_size({'width':width,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Page overflow at {width}'
            page.locator('#search').fill('sergiodxa')
            assert page.locator('#rows tr').count() == 1
            page.locator('#search').fill('')
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(artifacts / 'mobile.png'), full_page=True)
        # Footer-only ASCII motion, user pause, and reduced-motion preference.
        assert page.locator('footer #peru-flag').count() == 1
        page.locator('footer').scroll_into_view_if_needed()
        flag = page.locator('#peru-flag')
        initial = flag.text_content()
        page.wait_for_function("document.getElementById('peru-flag').textContent !== " + json.dumps(initial))
        page.locator('#flag-toggle').click()
        assert page.locator('#flag-toggle').get_attribute('aria-pressed') == 'true'
        paused = flag.text_content()
        page.wait_for_timeout(250)
        assert flag.text_content() == paused
        page.locator('footer').screenshot(path=str(artifacts / 'footer.png'))
        page.emulate_media(reduced_motion='reduce')
        page.reload(wait_until='networkidle')
        page.locator('footer').scroll_into_view_if_needed()
        assert page.locator('#flag-toggle').inner_text() == 'Animar bandera'
        paused = flag.text_content()
        page.wait_for_timeout(200)
        assert flag.text_content() == paused
        page.emulate_media(reduced_motion='no-preference')
        # A failed local data request exposes a working retry state.
        page.route('**/data/peru.json', lambda route: route.fulfill(status=503, body='Unavailable'))
        page.reload(wait_until='networkidle')
        assert page.locator('#retry').is_visible()
        assert page.locator('#rows tr').count() == min(25, len(users))
        assert page.locator('#static-pagination a[rel=next]').is_visible()
        page.unroute('**/data/peru.json')
        page.locator('#retry').click()
        page.wait_for_selector('#rows tr')
        assert page.locator('#retry').is_hidden()
        # Hostile text must remain text; CSV formulas must be escaped.
        fixture={'updatedAt':None,'cities':[], 'users':[{'login':'safe-user','name':'=1+1','location':'<img src=x onerror=alert(1)>','avatarUrl':'','publicContributions':2,'privateContributions':3,'followers':1,'cities':[]}, {'login':'tied-user','name':'Tied','location':'','avatarUrl':'','publicContributions':2,'privateContributions':0,'followers':0,'cities':[]}]}
        page.route('**/data/peru.json', lambda route:route.fulfill(json=fixture))
        page.reload(wait_until='networkidle')
        page.wait_for_selector('#rows tr')
        assert page.locator('#rows .position').all_inner_texts() == ['1','1']
        assert page.locator('#rows td.location img').count() == 0
        with page.expect_download() as download_info:
            page.locator('#export').click()
        rows=list(csv.reader(io.StringIO(Path(download_info.value.path()).read_text(encoding='utf-8-sig'))))
        assert rows[1][1] == "'=1+1"
        assert not errors, errors
        browser.close()
        print('PASS: data, metrics, ties, sorting, search, cities, infinite scrolling, manual loading, end of feed, CSV, profile links, mobile layouts, ASCII animation/pause/reduced motion, data failure/retry, safe text; no JavaScript errors.')
finally:
    server.shutdown()
    server.server_close()
