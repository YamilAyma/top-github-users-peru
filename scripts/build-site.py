#!/usr/bin/env python3
"""Rebuild the static Pages entry point and its data from the repository cache."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import unicodedata

ROOT = Path(__file__).resolve().parents[1]

def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.lower()) if not unicodedata.combining(c))

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
    data = {'updatedAt': updated_at, 'cities': cities, 'users': output}
    (ROOT / 'docs/data').mkdir(parents=True, exist_ok=True)
    (ROOT / 'docs/data/peru.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    shutil.copyfile(ROOT / 'web/index.html', ROOT / 'docs/index.html')
    print(f'Built GitHub Pages site: {len(output)} profiles; data commit {updated_at}')

if __name__ == '__main__':
    build()
