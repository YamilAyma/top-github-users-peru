#!/usr/bin/env python3
"""Rebuild the static Pages entry point and its data from the repository cache."""
import json
import hashlib
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


def page_path(metric, page, city=None):
    if city:
        return f"ciudades/{city}/" + (f"pagina/{page}/" if page > 1 else "")
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


def json_ld(value):
    # HTML script data must escape '<', including profile names containing '</script>'.
    return '<script type="application/ld+json">' + json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', r'\u003c').replace('>', r'\u003e').replace('&', r'\u0026') + '</script>'


def breadcrumbs_html(items):
    return '<nav class="breadcrumbs" aria-label="Ubicación">' + ' / '.join(
        f'<a href="./{path}">{escape(name)}</a>' if i < len(items) - 1 else f'<span aria-current="page">{escape(name)}</span>'
        for i, (name, path) in enumerate(items)) + '</nav>'


def structured_data(path, title, entries, start, breadcrumbs):
    canonical = BASE_URL + path
    page = {'@type': 'CollectionPage' if entries is not None else 'WebPage', '@id': canonical + '#page',
            'url': canonical, 'name': title, 'inLanguage': 'es-PE', 'isPartOf': {'@id': BASE_URL + '#website'},
            'breadcrumb': {'@id': canonical + '#breadcrumbs'}}
    if entries is not None:
        page['mainEntity'] = {'@type': 'ItemList', 'numberOfItems': len(entries),
            'itemListElement': [{'@type': 'ListItem', 'position': start + i + 1,
                'item': {'@type': 'Thing', 'name': clean(u['name']) or u['login'], 'url': 'https://github.com/' + u['login']}}
                for i, u in enumerate(entries)]}
    return json_ld({'@context': 'https://schema.org', '@graph': [
        {'@type': 'WebSite', '@id': BASE_URL + '#website', 'url': BASE_URL, 'name': 'GitHub Perú', 'inLanguage': 'es-PE'},
        page,
        {'@type': 'BreadcrumbList', '@id': canonical + '#breadcrumbs', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': name, 'item': BASE_URL + item_path}
            for i, (name, item_path) in enumerate(breadcrumbs)]}]})


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


def version_assets(html):
    # Browsers must not reuse older CSS/JS after generated HTML changes.
    def reference(match):
        asset = ROOT / 'docs' / match.group(2)
        version = hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
        return match.group(1) + match.group(2) + '?v=' + version + match.group(3)
    return re.sub(r'((?:href|src)="\./)(css/styles\.css|javascript/(?:ranking|footer-flag)\.js)(")', reference, html)


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
    city_copy = {
        'lima': ('Lima', 'Esta vista reúne perfiles cuya ubicación declarada menciona Lima como nombre completo. También puede incluir textos como “Lima, Perú” o “Perú/Lima”, e incluso menciones de varios lugares; no verifica que el perfil resida actualmente en la ciudad.'),
        'arequipa': ('Arequipa', 'Esta vista permite explorar perfiles que escribieron Arequipa en su ubicación de GitHub. Reconoce el nombre sin distinguir mayúsculas ni tildes, pero no deduce la ciudad desde coordenadas, empresas o menciones genéricas de Perú.'),
    }
    city_sets = {key: [u for u in users if key in u['cities']] for key in city_copy}
    city_sets = {key: group for key, group in city_sets.items() if len(group) >= 10}
    city_links = '<section class="city-discovery" aria-labelledby="city-heading"><h2 id="city-heading">Explora por ciudad</h2><p>Según la ubicación declarada en GitHub, sin verificación de residencia.</p><div>' + ''.join(
        f'<a href="./ciudades/{key}/"><strong>{city_copy[key][0]}</strong><span>{number(len(group))} perfiles</span></a>' for key, group in city_sets.items()) + '</div></section>' if city_sets else ''
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
        scopes = [(None, ranked)]
        if metric == 'publicContributions':
            scopes += [(key, [u for u in ranked if key in u['cities']]) for key in city_sets]
        for city, scoped in scopes:
            place = city_copy[city][0] if city else 'Perú'
            count = max(1, math.ceil(len(scoped) / PAGE_SIZE))
            for page in range(1, count + 1):
                start = (page - 1) * PAGE_SIZE
                path = page_path(metric, page, city)
                suffix = f' | Página {page}' if page > 1 else ''
                title = f'Ranking de GitHub en {place}: {label.lower()}{suffix}'
                description = f'Explora perfiles de GitHub vinculados a {place}, ordenados por {label.lower()}. Consulta la fuente, los criterios y la fecha de los datos.'
                if page > 1:
                    description += f' Página {page}.'
                nav = f'<nav id="static-pagination" class="static-pagination" aria-label="Páginas del ranking"><span>Página {page} de {count}</span>'
                if page > 1:
                    nav += f'<a rel="prev" href="./{page_path(metric, page - 1, city)}">Página anterior</a>'
                if page < count:
                    nav += f'<a rel="next" href="./{page_path(metric, page + 1, city)}">Página siguiente</a>'
                nav += '</nav>' + links
                crumbs = [('Ranking de Perú', '')]
                if city:
                    crumbs.append((place, page_path(metric, 1, city)))
                elif metric != 'publicContributions':
                    crumbs.append((label, page_path(metric, 1)))
                if page > 1:
                    crumbs.append((f'Página {page}', path))
                entries = scoped[start:start + PAGE_SIZE]
                context = ""
                if city:
                    context = (f'<section class="city-context"><h2>Perfiles que mencionan {place}</h2><p>{city_copy[city][1]}</p>'
                        f'<p>Se encontraron <strong>{number(len(scoped))} perfiles</strong> entre los {number(len(users))} incluidos en la caché. '
                        'Las tarjetas resumen esta selección. La tabla conserva el puesto nacional y puede incluir perfiles presentes en más de una ciudad.</p>'
                        '<nav class="city-actions" aria-label="Más información de la ciudad"><a href="./metodologia/">Ver metodología y criterios</a><a href="./">Ver todo Perú</a></nav></section>')
                values = common | {'SEO_HEAD': head_html(path, title, description) + structured_data(path, title, entries, start, crumbs), 'PAGE_TITLE': escape(title),
                    'METRIC': metric, 'CITY': city or '', 'START': str(start), 'RANKING_TITLE': escape(label + (f' · {place}' if city else '') + (f' · Página {page}' if page > 1 else '')),
                    'HERO_TITLE': f'Ranking de GitHub<br><em>en {place}.</em>', 'BREADCRUMBS': breadcrumbs_html(crumbs), 'CITY_CONTEXT': context, 'CITY_DISCOVERY': city_links if not city else '',
                    'STAT_SCOPE': f'Perfiles que mencionan {place}' if city else 'Personas y organizaciones de Perú',
                    'USERS': number(len(scoped)), 'CONTRIBUTIONS': number(sum(u['publicContributions'] for u in scoped)), 'FOLLOWERS': number(sum(u['followers'] for u in scoped)),
                    'ROWS': ''.join(row_html(u, ranks[u['login']], metric) for u in entries),
                    'RESULTS': f'Mostrando {start + 1 if scoped else 0}–{min(start + PAGE_SIZE, len(scoped))} de {number(len(scoped))} perfiles', 'PAGE_NAV': nav}
                html = template
                for key, value in values.items():
                    html = html.replace('<!--' + key + '-->', value)
                html = re.sub(r'(name="description"\s+content=")[^"]*', lambda m: m.group(1) + escape(description, quote=True), html)
                html = re.sub(r'(id="metric-note"[^>]*>).*?(</p>)', lambda m: m.group(1) + escape(f'Ordenado por {label.lower()}, de mayor a menor. Puesto nacional; los empates comparten posición.') + m.group(2), html, flags=re.S)
                html = re.sub(r'(<th\b[^>]*data-sort="([^"]+)"[^>]*aria-sort=")[^"]+', lambda m: m.group(1) + ('descending' if m.group(2) == metric else 'none'), html)
                html = re.sub(r'(?m)^[ \t]+$', '', html)
                destination = docs / path / 'index.html'
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(version_assets(html))
                generated.append(destination.relative_to(docs).as_posix())
                urls.append(BASE_URL + path)
    methodology = ROOT / 'web/metodologia.html'
    title = 'Metodología del ranking de GitHub en Perú'
    html = methodology.read_text().replace('<!--MIN_FOLLOWERS-->', str(data['minimumFollowers'])).replace('<!--SEO_HEAD-->', head_html('metodologia/', title, 'Fuentes, criterios, limitaciones y licencia de los datos del ranking de GitHub en Perú.') + structured_data('metodologia/', title, None, 0, [('Ranking de Perú', ''), ('Metodología', 'metodologia/')]))
    destination = docs / 'metodologia/index.html'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(version_assets(html))
    generated.append('metodologia/index.html')
    urls.append(BASE_URL + 'metodologia/')
    # Only remove files previously registered by this generator, never whole directories.
    manifest = docs / '.generated-pages.json'
    valid = r'(?:index\.html|(?:totales|seguidores)/index\.html|(?:publicas|totales|seguidores)/pagina/[0-9]+/index\.html|metodologia/index\.html|ciudades/(?:lima|arequipa)/(?:pagina/[0-9]+/)?index\.html)'
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
