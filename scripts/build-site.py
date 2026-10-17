#!/usr/bin/env python3
"""Rebuild the static Pages entry point and its data from the repository cache."""
import json
from pathlib import Path
import re
from html import escape
from datetime import datetime
from zoneinfo import ZoneInfo
import math
import subprocess
import unicodedata

ROOT = Path(__file__).resolve().parents[1]

def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.lower()) if not unicodedata.combining(c))

BASE_URL = 'https://yamilayma.github.io/top-github-users-peru/'
PAGE_SIZE = 25
METRICS = {
    'publicContributions': ('publicas', 'Contribuciones públicas'),
    'total': ('totales', 'Contribuciones totales'),
    'followers': ('seguidores', 'Seguidores'),
}


def number(value):
    return f'{value:,}'


def clean(value):
    return '' if value is None or value == 'undefined value' else str(value)


def metric_value(user, metric):
    return user['publicContributions'] + user['privateContributions'] if metric == 'total' else user[metric]


def page_path(metric, page):
    slug = METRICS[metric][0]
    if page == 1:
        return '' if metric == 'publicContributions' else slug + '/'
    return f'{slug}/pagina/{page}/'


def row_html(user, rank, metric):
    login = escape(user['login'], quote=True)
    name = escape(clean(user['name']) or user['login'], quote=True)
    location = escape(clean(user['location']) or 'Sin ubicación', quote=True)
    url = f'https://github.com/{login}'
    if user['avatarUrl']:
        avatar = f'<img class="avatar" src="{escape(user["avatarUrl"], quote=True)}" alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer">'
    else:
        avatar = f'<span class="avatar avatar-fallback" aria-hidden="true">{login[:2].upper()}</span>'
    cells = []
    for key in METRICS:
        value = number(metric_value(user, key))
        if key == metric:
            value = f'<span class="metric-pill">{value}</span>'
        cells.append(f'<td class="numeric">{value}</td>')
    return (f'<tr><td><span class="position{ " top" if rank <= 3 else "" }">{rank}</span></td>'
            f'<td><a class="profile" href="{url}" target="_blank" rel="noopener noreferrer">{avatar}'
            f'<span class="profile-info"><span class="profile-name" title="{name}">{name}</span>'
            f'<span class="handle">@{login}</span></span></a></td>'
            f'<td class="location" title="{location}">{location}</td>' + ''.join(cells) +
            f'<td><a class="profile-link" href="{url}" aria-label="Ver perfil de {login} en GitHub" target="_blank" rel="noopener noreferrer">'
            '<img class="external-icon" src="./assets/arrow-up-right.svg" alt=""></a></td></tr>')


def head_html(path, title, description):
    base = '../' * len(path.strip('/').split('/')) if path else './'
    canonical = BASE_URL + path
    return (f'<base href="{base}">'
            f'<link rel="canonical" href="{canonical}">'
            f'<meta property="og:type" content="website"><meta property="og:locale" content="es_PE">'
            f'<meta property="og:title" content="{escape(title, quote=True)}">'
            f'<meta property="og:description" content="{escape(description, quote=True)}">'
            f'<meta property="og:url" content="{canonical}">'
            f'<meta property="og:image" content="{BASE_URL}assets/peru-collage.webp">'
            '<meta property="og:image:alt" content="Collage ilustrativo del Perú generado con IA">'
            '<meta name="twitter:card" content="summary_large_image">')


def build_pages(data):
    docs = ROOT / 'docs'
    template = (ROOT / 'web/index.html').read_text()
    users = data['users']
    updated = ('Datos al ' + datetime.fromisoformat(data['updatedAt']).astimezone(ZoneInfo('America/Lima')).strftime('%d/%m/%Y %H:%M') + ' · hora de Perú') if data['updatedAt'] else 'Fuente: caché del repositorio'
    common = {'UPDATED': escape(updated), 'USERS': number(len(users)),
              'CONTRIBUTIONS': number(sum(u['publicContributions'] for u in users)),
              'FOLLOWERS': number(sum(u['followers'] for u in users)), 'METRIC_LINKS': ''}
    generated = []
    urls = []
    links = '<nav class="ranking-links" aria-label="Rankings por métrica"><a href="./">Públicas</a><a href="./totales/">Totales</a><a href="./seguidores/">Seguidores</a><a href="./metodologia/">Metodología</a></nav>'
    for metric, (_, label) in METRICS.items():
        ranked = sorted(users, key=lambda u: (-metric_value(u, metric), u['login'].lower()))
        ranks = {}
        previous = None
        for i, user in enumerate(ranked):
            value = metric_value(user, metric)
            if value != previous:
                rank = i + 1
            ranks[user['login']] = rank
            previous = value
        count = max(1, math.ceil(len(ranked) / PAGE_SIZE))
        for page in range(1, count + 1):
            start = (page - 1) * PAGE_SIZE
            path = page_path(metric, page)
            suffix = f' | Página {page}' if page > 1 else ''
            title = f'Ranking de GitHub en Perú: {label.lower()}{suffix}'
            description = f'Explora perfiles de GitHub vinculados a Perú, ordenados por {label.lower()}. Consulta la fuente, los criterios y la fecha de los datos.'
            if page > 1:
                description += f' Página {page}.'
            nav = f'<nav id="static-pagination" class="static-pagination" aria-label="Páginas del ranking"><span>Página {page} de {count}</span>'
            if page > 1:
                nav += f'<a rel="prev" href="./{page_path(metric, page - 1)}">Página anterior</a>'
            if page < count:
                nav += f'<a rel="next" href="./{page_path(metric, page + 1)}">Página siguiente</a>'
            nav += '</nav>' + links
            values = common | {'SEO_HEAD': head_html(path, title, description), 'PAGE_TITLE': escape(title),
                'METRIC': metric, 'START': str(start), 'RANKING_TITLE': escape(label + (f' · Página {page}' if page > 1 else '')),
                'ROWS': ''.join(row_html(u, ranks[u['login']], metric) for u in ranked[start:start + PAGE_SIZE]),
                'RESULTS': f'Mostrando {start + 1 if ranked else 0}–{min(start + PAGE_SIZE, len(ranked))} de {number(len(ranked))} perfiles', 'PAGE_NAV': nav}
            html = template
            for key, value in values.items():
                html = html.replace('<!--' + key + '-->', value)
            html = re.sub(r'(name="description"\s+content=")[^"]*', lambda m: m.group(1) + escape(description, quote=True), html)
            html = re.sub(r'(id="metric-note"[^>]*>).*?(</p>)', lambda m: m.group(1) + escape(f'Ordenado por {label.lower()}, de mayor a menor. Puesto nacional; los empates comparten posición.') + m.group(2), html, flags=re.S)
            html = re.sub(r'(<th\b[^>]*data-sort="([^"]+)"[^>]*aria-sort=")[^"]+', lambda m: m.group(1) + ('descending' if m.group(2) == metric else 'none'), html)
            destination = docs / path / 'index.html'
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(html)
            generated.append(destination.relative_to(docs).as_posix())
            urls.append(BASE_URL + path)
    methodology = ROOT / 'web/metodologia.html'
    title = 'Metodología del ranking de GitHub en Perú'
    html = methodology.read_text().replace('<!--MIN_FOLLOWERS-->', str(data['minimumFollowers'])).replace('<!--SEO_HEAD-->', head_html('metodologia/', title, 'Fuentes, criterios, limitaciones y licencia de los datos del ranking de GitHub en Perú.'))
    destination = docs / 'metodologia/index.html'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html)
    generated.append('metodologia/index.html')
    urls.append(BASE_URL + 'metodologia/')
    # Only remove files previously registered by this generator, never whole directories.
    manifest = docs / '.generated-pages.json'
    valid = r'(?:index\.html|(?:totales|seguidores)/index\.html|(?:publicas|totales|seguidores)/pagina/[0-9]+/index\.html|metodologia/index\.html)'
    previous = json.loads(manifest.read_text()) if manifest.exists() else []
    for old in set(previous) - set(generated):
        if not re.fullmatch(valid, old):
            raise ValueError('Unexpected generated path: ' + old)
        target = docs / old
        if target.is_symlink() or not target.resolve().is_relative_to(docs.resolve()):
            raise ValueError('Unsafe generated path: ' + old)
        target.unlink(missing_ok=True)
    manifest.write_text(json.dumps(generated, indent=2) + '\n')
    # lastmod omitted: a build timestamp is not a trustworthy content-modified date.
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += ''.join(f'  <url><loc>{escape(url)}</loc></url>\n' for url in urls) + '</urlset>\n'
    (docs / 'sitemap.xml').write_text(sitemap)
    print(f'Generated {len(urls)} indexable pages and project-scoped sitemap')


def build():
    users = json.loads((ROOT / 'cache/peru.json').read_text())
    config = json.loads((ROOT / 'config.json').read_text())
    location = next(item for item in config['locations'] if item['country'] == 'peru')
    labels = {'huanuco': 'Huánuco', 'junin': 'Junín', 'puerto-maldonado': 'Puerto Maldonado', 'cerro-de-pasco': 'Cerro de Pasco'}
    cities = [{'id': city, 'label': labels.get(city, city.replace('-', ' ').title())} for city in location['cities']]
    output = []
    seen = set()
    for user in users:
        login = user['login']
        if not re.fullmatch(r'[A-Za-z0-9-]+', login) or login.lower() in seen:
            raise ValueError(f'Invalid or duplicate GitHub login: {login}')
        seen.add(login.lower())
        record = {key: user.get(key, '') for key in ('login', 'name', 'avatarUrl', 'location')}
        if record['avatarUrl'] and not record['avatarUrl'].startswith('https://avatars.githubusercontent.com/'):
            record['avatarUrl'] = ''
        for key in ('followers', 'publicContributions', 'privateContributions'):
            value = user[key]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f'Invalid {key} for {login}')
            record[key] = value
        declared = normalize(user.get('location') or '').replace('-', ' ')
        record['cities'] = [city['id'] for city in cities if re.search(r'(?<!\w)' + re.escape(normalize(city['id']).replace('-', ' ')) + r'(?!\w)', declared)]
        output.append(record)
    # Use the cache commit time, not the build time, to avoid claiming stale data is fresh.
    updated_at = subprocess.check_output(['git', 'log', '-1', '--format=%cI', '--', 'cache/peru.json'], cwd=ROOT, text=True).strip() or None
    data = {'updatedAt': updated_at, 'minimumFollowers': location['followers'], 'cities': cities, 'users': output}
    (ROOT / 'docs/data').mkdir(parents=True, exist_ok=True)
    (ROOT / 'docs/data/peru.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    build_pages(data)
    print(f'Built GitHub Pages site: {len(output)} profiles; data commit {updated_at}')

if __name__ == '__main__':
    build()
