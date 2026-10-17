#!/usr/bin/env python3
"""Check every static SEO route, plus navigation without JS and nested feed behavior."""
import functools
import hashlib
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from urllib.parse import urljoin, urlparse, unquote
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import sys

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
PUBLIC = 'https://yamilayma.github.io/top-github-users-peru/'
class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.base='./'; self.canonical=[]; self.profiles=[]; self.links=[]; self.assets=[]; self.metric=None; self.start=0; self.title=''; self.in_title=False; self.description=''; self.city=''; self.structured=''; self.in_json=False
        self.feed(html)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='base': self.base=a['href']
        if tag=='body': self.metric=a.get('data-initial-metric'); self.start=int(a.get('data-start',0)); self.city=a.get('data-city','')
        if tag=='link' and a.get('rel')=='canonical': self.canonical.append(a['href'])
        if tag=='a':
            self.links.append(a['href'])
            if a.get('class')=='profile': self.profiles.append(a['href'].split('/')[-1])
        if tag=='meta' and a.get('name')=='description': self.description=a['content']
        if tag=='title': self.in_title=True
        if tag=='script' and a.get('type')=='application/ld+json': self.in_json=True
        if tag in ('script','img') and a.get('src'): self.assets.append(a['src'])
        if tag=='link' and a.get('rel') in ('stylesheet','preload'): self.assets.append(a['href'])
    def handle_endtag(self, tag):
        if tag=='title': self.in_title=False
        if tag=='script': self.in_json=False
    def handle_data(self, text):
        if self.in_title: self.title += text
        if self.in_json: self.structured += text

users=json.loads((DOCS/'data/peru.json').read_text())['users']
manifest=json.loads((DOCS/'.generated-pages.json').read_text())
urls=[n.text for n in ET.parse(DOCS/'sitemap.xml').findall('{*}url/{*}loc')]
assert len(urls)==len(manifest)==len(set(urls))
titles=set()
for file in manifest:
    html=(DOCS/file).read_text()
    assert '<!--ROWS-->' not in html and '<!--PAGE_' not in html
    assert html.index('charset=') < 1024
    parsed=Page(html)
    relative='' if file=='index.html' else file.removesuffix('index.html')
    expected=PUBLIC+relative
    assert parsed.canonical==[expected], (file,parsed.canonical)
    assert expected in urls
    assert parsed.title and parsed.title not in titles; titles.add(parsed.title)
    assert parsed.description
    if parsed.metric:
        def value(u): return u['publicContributions']+u['privateContributions'] if parsed.metric=='total' else u[parsed.metric]
        ranked=sorted(users,key=lambda u:(-value(u),u['login'].lower()))
        if parsed.city: ranked=[u for u in ranked if parsed.city in u['cities']]
        assert parsed.profiles==[u['login'] for u in ranked[parsed.start:parsed.start+25]],file
    graph=json.loads(parsed.structured)['@graph']
    document=next(item for item in graph if item['@type'] in ('CollectionPage','WebPage'))
    assert document['url']==expected and document['inLanguage']=='es-PE'
    breadcrumbs=next(item for item in graph if item['@type']=='BreadcrumbList')['itemListElement']
    assert breadcrumbs[-1]['item']==expected
    assert [item['position'] for item in breadcrumbs]==list(range(1,len(breadcrumbs)+1))
    if parsed.metric:
        listing=document['mainEntity']
        assert listing['numberOfItems']==len(parsed.profiles)
        assert [item['item']['url'].split('/')[-1] for item in listing['itemListElement']]==parsed.profiles
        assert [item['position'] for item in listing['itemListElement']]==list(range(parsed.start+1, parsed.start+1+len(parsed.profiles)))
    assert 'aggregateRating' not in parsed.structured
    for ref in parsed.links+parsed.assets:
        resolved=urljoin(urljoin(expected,parsed.base),ref)
        if resolved.startswith(PUBLIC):
            local=DOCS/unquote(resolved[len(PUBLIC):].split('?')[0].split('#')[0])
            if local.is_dir(): local=local/'index.html'
            assert local.is_file(),(file,ref,local)
            if ref.startswith(('./css/', './javascript/')):
                assert ref.endswith('?v='+hashlib.sha256(local.read_bytes()).hexdigest()[:12]),(file,ref)
assert not (DOCS/'robots.txt').exists(), 'Do not create a robots.txt scoped to the project'

if '--static-only' in sys.argv:
    print(f'PASS: {len(urls)} static pages, sitemap, canonical URLs, profile ordering and local resources; no browser dependency')
    raise SystemExit(0)

from playwright.sync_api import sync_playwright

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT.parent)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}/{ROOT.name}/docs/'
try:
    # Every sitemap URL must really open as a direct static request.
    for url in urls:
        with urlopen(base+url[len(PUBLIC):]) as response: assert response.status==200
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'))
        context=browser.new_context(java_script_enabled=False)
        page=context.new_page(); page.route('https://avatars.githubusercontent.com/**',lambda r:r.abort())
        page.goto(base)
        assert page.locator('#rows tr').count()==25
        assert page.locator('#stat-users').inner_text().replace(',','')==str(len(users))
        assert not page.locator('#export').is_visible()
        assert not page.locator('.toolbar').is_visible()
        page.locator('#static-pagination a[rel=next]').click()
        assert page.url==base+'publicas/pagina/2/'
        assert page.locator('#rows tr').count()==25
        assert page.locator('#rows .position').first.inner_text()=='26'
        page.locator('.ranking-links a').filter(has_text='Seguidores').click()
        assert page.url==base+'seguidores/'
        assert page.locator('#rows .handle').first.inner_text()=='@'+max(users,key=lambda u:u['followers'])['login']
        page.locator('.ranking-links a').filter(has_text='Metodología').click()
        assert page.locator('h1').inner_text().startswith('Cómo se construye')
        assert page.locator('link[rel=canonical]').get_attribute('href')==PUBLIC+'metodologia/'
        context.close()
        context=browser.new_context(viewport={'width':1440,'height':1000})
        page=context.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('https://avatars.githubusercontent.com/**',lambda r:r.abort())
        page.goto(base+'seguidores/pagina/2/',wait_until='networkidle')
        expected=sorted(users,key=lambda u:(-u['followers'],u['login'].lower()))
        assert page.locator('#rows .handle').all_inner_texts()==['@'+u['login'] for u in expected[25:50]]
        page.locator('#feed-sentinel').scroll_into_view_if_needed()
        page.wait_for_function("document.querySelectorAll('#rows tr').length >= 50")
        assert page.locator('#rows .handle').all_inner_texts()==['@'+u['login'] for u in expected[25:75]]
        page.locator('#search').fill('sergiodxa')
        assert page.locator('#rows .handle').all_inner_texts()==['@sergiodxa']
        assert page.locator('#static-pagination').is_hidden()
        page.set_viewport_size({'width':320,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        for city in ('lima','arequipa'):
            page.goto(base+f'ciudades/{city}/',wait_until='networkidle')
            scoped=[u for u in sorted(users,key=lambda u:(-u['publicContributions'],u['login'].lower())) if city in u['cities']]
            assert page.locator('#city').input_value()==city
            assert page.locator('#city').is_disabled()
            assert int(page.locator('#stat-users').inner_text().replace(',',''))==len(scoped)
            assert page.locator('#rows .handle').all_inner_texts()==['@'+u['login'] for u in scoped[:25]]
            assert not page.locator('#static-pagination').is_hidden()
            page.locator('#search').fill('no-such-profile-xyz')
            assert page.locator('#rows tr').count()==0
            page.locator('#search').fill('')
            assert page.locator('#rows .handle').first.inner_text()=='@'+scoped[0]['login']
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.goto(base+f'ciudades/{city}/pagina/2/',wait_until='networkidle')
            assert page.locator('#rows .handle').all_inner_texts()==['@'+u['login'] for u in scoped[25:50]]
            page.locator('[data-metric="followers"]').click()
            by_followers=sorted(scoped,key=lambda u:(-u['followers'],u['login'].lower()))
            assert page.locator('#rows .handle').all_inner_texts()==['@'+u['login'] for u in by_followers[:25]]
            with page.expect_download() as info:
                page.locator('#export').click()
            import csv, io
            exported=list(csv.reader(io.StringIO(Path(info.value.path()).read_text(encoding='utf-8-sig'))))
            assert len(exported)==len(scoped)+1
            assert exported[1][0]==by_followers[0]['login']
        # Initial HTML and interactive hydration must use the same date to avoid shifting the hero.
        plain=browser.new_context(java_script_enabled=False)
        static=plain.new_page(); static.goto(base)
        page.goto(base,wait_until='networkidle')
        assert static.locator('#updated').inner_text()==page.locator('#updated').inner_text()
        plain.close()
        assert not errors,errors
        browser.close()
    print(f'PASS: {len(urls)} scoped sitemap URLs, matching structured data, city lists, unique titles, self-canonicals, static profile ordering, all local links/assets, HTTP 200, no-JS navigation, nested JS feed/search, mobile; blog robots unchanged.')
finally:
    server.shutdown(); server.server_close()

# Refreshing after the cache shrinks must remove only registered generated pages.
import runpy
import shutil
import tempfile
with tempfile.TemporaryDirectory() as temp:
    sandbox=Path(temp)
    shutil.copytree(ROOT/'web',sandbox/'web')
    (sandbox/'docs').mkdir()
    shutil.copytree(DOCS/'css', sandbox/'docs/css')
    shutil.copytree(DOCS/'javascript', sandbox/'docs/javascript')
    note=sandbox/'docs/owner-file.html'; note.write_text('preserve me')
    module=runpy.run_path(str(ROOT/'scripts/build-site.py'))
    generate=module['build_pages']; generate.__globals__['ROOT']=sandbox
    data=json.loads((DOCS/'data/peru.json').read_text())
    data['users']=users[:60]; generate(data)
    stale=sandbox/'docs/publicas/pagina/3/index.html'; assert stale.exists()
    data['users']=users[:3]; generate(data)
    assert not stale.exists()
    assert note.read_text()=='preserve me'
    malicious=users[0]|{'name':'<script>alert(1)</script>', 'location':'" onmouseover="alert(1)'}
    html=module['row_html'](malicious,1,'publicContributions')
    assert '<script>' not in html and '&lt;script&gt;' in html
    assert '&quot; onmouseover=&quot;' in html
    schema=module['structured_data']('', 'Example', [malicious],0,[('Ranking de Perú','')])
    assert schema.count('</script>')==1
    assert json.loads(schema.removeprefix('<script type="application/ld+json">').removesuffix('</script>'))['@graph'][1]['mainEntity']['itemListElement'][0]['item']['name']==malicious['name']
print('PASS: stale generated pages removed safely; owner files preserved; server-rendered profile text escaped')
