"""Shared location matching for current and historical views."""
import re
import unicodedata


def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '').lower()) if not unicodedata.combining(c))


def recognized_cities(location, cities):
    declared = normalize(location).replace('-', ' ')
    return [city for city in cities if re.search(r'(?<!\w)' + re.escape(normalize(city).replace('-', ' ')) + r'(?!\w)', declared)]
