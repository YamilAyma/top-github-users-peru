#!/usr/bin/env python3
"""Exercise available historical UI, plus isolated multi-date fixtures (never published)."""
from datetime import date, timedelta
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT.parent)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}/{ROOT.name}/docs/'
artifacts = Path('/workspace/scratch/evolution-review'); artifacts.mkdir(parents=True, exist_ok=True)

# Sparse, multi-month history: ties, a late arrival, absent locations and decreasing counters.
observations=[]
for i in range(90):
    if i % 9 == 4: continue
    day=(date(2026,7,20)+timedelta(days=i)).isoformat()
    users=[['alice',100-i,3,100+i], ['carol',80+i,0,100+i]]
    if i >= 22: users.insert(1,['bob',100-i,5,20])
    snapshot={'date':day,'users':users}
    if i>=5: snapshot['city_membership']={'lima':[0], 'arequipa':[]}
    observations.append(snapshot)
groups={}
for s in observations: groups.setdefault('daily/'+s['date'][:7]+'.json',[]).append(s)
monthly={s['date'][:7]:s for s in observations}; yearly={s['date'][:4]:s for s in observations}
groups['monthly/2026.json']=list(monthly.values()); groups['yearly/2026.json']=list(yearly.values())
catalog={'daily_window':{'from':'2026-07-20','through':'2026-10-17','days':90},'series':{}}
for tier in ('daily','monthly','yearly'):
    catalog['series'][tier]=[{'path':path,'periods':[{'date':s['date']} for s in records]} for path,records in groups.items() if path.startswith(tier+'/')]
summary={'window':catalog['daily_window'],'scopes':{}}
for city in ('peru','lima','arequipa'):
    series={}
    for tier in ('daily','monthly','yearly'):
        records=observations if tier=='daily' else list(monthly.values()) if tier=='monthly' else list(yearly.values())
        points=[]
        for s in records:
            rows=s['users'] if city=='peru' else None if 'city_membership' not in s else [s['users'][j] for j in s['city_membership'][city]]
            points.append({'date':s['date'],'profiles':len(rows) if rows is not None else None,'publicContributions':sum(r[1] for r in rows) if rows is not None else None,'followers':sum(r[3] for r in rows) if rows is not None else None})
        series[tier]=points
    summary['scopes'][city]={'series':series,'weekly':{'from':'2026-10-10','through':'2026-10-17','matched':3,'entered':0,'left':0,'publicDeltaMatched':-7,'followersDeltaMatched':14,'movers':[{'login':'carol','change':1}]} if city=='peru' else None}

def route_fixture(route):
    path=route.request.url.split('/docs/')[-1].split('?')[0]
    if path=='history/index.json': return route.fulfill(json=catalog)
    if path=='data/evolution-summary.json': return route.fulfill(json=summary)
    if path.startswith('history/'):
        key=path.removeprefix('history/')
        if key in groups: return route.fulfill(json={'snapshots':groups[key]})
    route.continue_()

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'))
        context=browser.new_context(viewport={'width':1440,'height':1050}, accept_downloads=True)
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('https://avatars.githubusercontent.com/**',lambda r:r.abort())
        page.goto(base,wait_until='networkidle')
        page.locator('#history-preview').scroll_into_view_if_needed()
        page.wait_for_selector('#preview-charts svg')
        assert page.locator('.city-discovery').count()==0
        assert page.locator('#city option').count()==35
        assert page.locator('#city').evaluate("el=>Boolean(el.closest('.scope-selector'))")
        assert page.locator('#preview-charts h3').all_inner_texts()==['Contribuciones públicas','Seguidores acumulados']
        assert 'capturas disponibles' in page.locator('#preview-coverage').inner_text()
        assert 'sin cambios' in page.locator('#preview-population').inner_text()
        # Scope updates the entire overview, including URL and future explorer navigation.
        source=json.loads((ROOT/'docs/data/peru.json').read_text())
        for city in ['trujillo','chiclayo','cusco','iquitos']:
            count=sum(city in user['cities'] for user in source['users'])
            page.locator('#city').select_option(city)
            assert int(page.locator('#stat-users').inner_text().replace(',',''))==count
            assert page.locator('#rows tr').count()==min(count,25)
            assert f'city={city}' in page.url
            assert f'city={city}' in page.locator('#history-preview .text-link').get_attribute('href')
        page.locator('#city').select_option('trujillo')
        page.reload(wait_until='networkidle')
        assert page.locator('#city').input_value()=='trujillo'
        assert int(page.locator('#stat-users').inner_text())==sum('trujillo' in user['cities'] for user in source['users'])
        page.goto(base+'publicas/pagina/2/?city=trujillo',wait_until='networkidle')
        assert page.locator('#rows tr').count()==sum('trujillo' in user['cities'] for user in source['users'])
        assert 'Mostrando 1' in page.locator('#results').inner_text()
        page.goto(base,wait_until='networkidle')
        page.locator('#city').select_option('')
        page.locator('.table-scroll').scroll_into_view_if_needed()
        page.wait_for_selector('#rows .trend-cell svg')
        trends=json.loads((ROOT/'docs/data/trends-publicContributions.json').read_text())
        first_login=page.locator('#rows tr').first.get_attribute('data-login').lower()
        expected=sum(v is not None for v in trends['ranks'][first_login])
        assert page.locator('#rows .trend-cell svg').first.locator('circle').count()==expected
        if expected==1: assert 'Primera captura' in page.locator('#rows .trend-cell').first.inner_text()
        first_x=page.locator('#rows .trend-cell svg').first.locator('circle').first.get_attribute('cx')
        last_x=page.locator('#rows .trend-cell svg').first.locator('circle').last.get_attribute('cx')
        if expected>1: assert float(last_x)-float(first_x)>100, 'Observed days should use the sparkline width'
        # Lines must encode each selected counter; rank movements are separate and never SVG.
        for metric,label in [('publicContributions','contribuciones públicas'),('total','contribuciones totales'),('followers','seguidores')]:
            page.locator(f'[data-metric="{metric}"]').click()
            page.wait_for_function("label=>document.getElementById('trend-period').textContent.includes(label)",arg=label)
            data=json.loads((ROOT/f'docs/data/trends-{metric}.json').read_text())
            key=page.locator('#rows tr').first.get_attribute('data-login').lower()
            actual=[v for v in data['values'][key] if v is not None]
            title=page.locator('#rows .trend-cell svg').first.locator(':scope > title').text_content()
            assert f': {actual[0]};' in title and f': {actual[-1]}.' in title
            assert label in title
            assert page.locator('#rows .movement-cell svg').count()==0
            assert page.locator('#rows .movement-cell .rank-token').first.inner_text()=='#'+str(next(v for v in data['ranks'][key] if v is not None))
            assert 'view=value' in page.locator('#rows .trend-detail').first.get_attribute('href')
            assert 'view=rank' in page.locator('#rows .rank-detail').first.get_attribute('href')
        page.locator('[data-metric="publicContributions"]').click()
        login=page.locator('#rows tr').first.get_attribute('data-login')
        page.locator('#rows [data-favorite]').first.click()
        assert page.locator('#rows [data-favorite]').first.get_attribute('aria-pressed')=='true'
        page.locator('#only-favorites').check()
        assert page.locator('#rows tr').count()==1
        page.reload(wait_until='networkidle')
        page.locator('#only-favorites').check()
        assert page.locator('#rows tr').count()==1
        assert page.locator('#rows tr').first.get_attribute('data-login')==login
        page.locator('#rows .trend-detail').click()
        page.wait_for_selector('#evolution-app:not([hidden])')
        assert page.locator('#compare-chips button').count()==1
        if expected==1: assert 'Primera captura' in page.locator('#e-coverage').inner_text()
        assert page.locator('#profile-chart svg circle').count()==expected
        with page.expect_download() as download:
            page.locator('#download-card').click()
        card=Path(download.value.path()).read_text()
        assert login.lower() in card and 'svg' in card
        page.screenshot(path=str(artifacts/'evolution-initial.png'),full_page=True)
        page.locator('#e-city').select_option('lima')
        # The legacy first observation has no location metadata; never infer it.
        assert 'No hay cobertura local comparable' in page.locator('#matched-summary').inner_text()
        page.goto(base+'ciudades/lima/',wait_until='networkidle')
        assert page.locator('#rows .local-rank').first.inner_text().startswith('Puesto local:')
        assert 'Primera captura' in page.locator('#history-preview').inner_text() or 'Sin cobertura' in page.locator('#history-preview').inner_text()
        for width in (320,390,768,1440):
            page.set_viewport_size({'width':width,'height':900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), ('city',width)
        page.set_viewport_size({'width':1440,'height':1050})
        page.route('**/history/**',route_fixture)
        page.route('**/data/evolution-summary.json',route_fixture)
        page.goto(base+'evolucion/?users=alice,bob&from=2026-07-20&to=2026-10-17',wait_until='networkidle')
        assert page.locator('#evolution-app').is_visible()
        assert page.locator('#compare-chips button').count()==2
        assert page.locator('#e-view').input_value()=='value'
        assert page.locator('#profile-chart svg').count()==2
        path=page.locator('#profile-chart svg path').first.get_attribute('d')
        assert path.count('M')>1, 'Missing days must break the line'
        assert 'escala compartida' in page.locator('#profile-chart').inner_text()
        # Shared scale must place equal metric values at equal Y coordinates across profiles.
        ys=page.locator('#profile-chart svg').evaluate_all("svgs=>svgs.map(s=>[...s.querySelectorAll('circle')].map(c=>[c.getAttribute('cx'),c.getAttribute('cy')]))")
        same_x=set(x for x,y in ys[0]) & set(x for x,y in ys[1])
        assert all(dict(ys[0])[x]==dict(ys[1])[x] for x in same_x)
        assert 'Contribuciones públicas' in page.locator('#profile-chart svg').first.get_attribute('aria-label')
        page.locator('#e-view').select_option('rank')
        assert page.locator('#profile-chart svg').count()==0
        assert page.locator('.rank-journey').count()==2
        assert page.locator('.rank-journey').first.locator('.rank-endpoints .rank-token').all_inner_texts()==['#1','#2']
        assert '↓ 1 puesto' in page.locator('.rank-journey').first.inner_text()
        page.locator('.rank-events summary').first.click()
        assert page.locator('.rank-events').first.locator('time').count()>1
        with page.expect_download() as rank_download:
            page.locator('#download-card').click()
        assert 'Puesto nacional' in Path(rank_download.value.path()).read_text()
        page.locator('#e-view').select_option('value')
        page.locator('#e-profile').fill('carol');page.locator('#compare-form button').click()
        assert page.locator('#compare-chips button').count()==3
        page.locator('#e-profile').fill('fourth');page.locator('#compare-form button').click()
        assert 'tres perfiles' in page.locator('#compare-status').inner_text()
        page.locator('#e-metric').select_option('followers')
        page.locator('#e-view').select_option('value')
        assert 'Seguidores' in page.locator('#profile-chart').inner_text()
        page.locator('#past-search').fill('bob')
        assert page.locator('#past-rows tr').count()==1
        assert 'No presente al inicio' in page.locator('#past-rows').inner_text()
        page.locator('#e-from').select_option('2026-10-17')
        page.locator('#e-to').select_option('2026-07-20')
        assert page.locator('#e-from').input_value()=='2026-07-20'
        assert page.locator('#e-to').input_value()=='2026-10-17'
        page.locator('#e-tier').select_option('monthly')
        page.wait_for_function("document.querySelector('#evolution-app').getAttribute('aria-busy')!== 'true'")
        assert page.locator('#e-from option').count()==4
        page.locator('#e-tier').select_option('yearly')
        page.wait_for_function("document.querySelector('#evolution-app').getAttribute('aria-busy')!== 'true'")
        assert page.locator('#e-from option').count()==1
        assert 'Primera captura' in page.locator('#e-coverage').inner_text()
        assert page.locator('#profile-chart svg').first.locator('circle').count()==1
        page.locator('#e-tier').select_option('daily')
        page.wait_for_function("document.querySelector('#evolution-app').getAttribute('aria-busy')!== 'true'")
        page.locator('#e-city').select_option('lima')
        assert 'No hay cobertura local comparable' in page.locator('#matched-summary').inner_text()
        page.locator('#e-city').select_option('')
        page.locator('#e-metric').select_option('publicContributions');page.locator('#e-view').select_option('rank')
        page.locator('#past-search').fill('')
        page.screenshot(path=str(artifacts/'evolution-fixture-desktop.png'),full_page=True)
        for width in (320,390,768,1440):
            page.set_viewport_size({'width':width,'height':900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), ('evolution',width)
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(artifacts/'evolution-fixture-mobile.png'),full_page=True)
        # A missing archive exposes retry without retaining a misleading prior graph.
        page.route('**/history/daily/*.json',lambda r:r.fulfill(status=503,body='Unavailable'))
        page.reload(wait_until='networkidle')
        assert page.locator('#evolution-retry').is_visible()
        assert page.locator('#evolution-app').is_hidden()
        page.unroute('**/history/daily/*.json')
        page.locator('#evolution-retry').click()
        page.wait_for_selector('#evolution-app:not([hidden])')
        assert not errors,errors
        context.close()
        # Static text, canonical and navigation are useful without JS.
        context=browser.new_context(java_script_enabled=False)
        page=context.new_page();page.goto(base+'evolucion/')
        assert page.locator('h1').is_visible()
        assert page.locator('.history-static').is_visible()
        assert page.locator('#evolution-app').is_hidden()
        page.goto(base)
        assert page.locator('.favorite-controls').is_hidden()
        context.close();browser.close()
        print('PASS: single-capture states, sparklines, favorites persistence, cities, comparison/shared scale, gaps, dates, archive tiers, historic search, card download, responsive layouts, retry and no-JS fallback.')
finally:
    server.shutdown();server.server_close()
