#!/usr/bin/env python3
"""Create delivery formats from the existing collage. Optional authoring tool: Pillow."""
from pathlib import Path
from PIL import Image, features

if not features.check('avif'):
    raise SystemExit('This optional tool requires Pillow with AVIF support; normal site builds use the committed images.')

assets = Path(__file__).resolve().parents[1] / 'docs/assets'
source = Image.open(assets / 'peru-collage.webp').convert('RGB')
for name, width, quality in [('desktop', source.width, 70), ('mobile', 960, 68)]:
    resized = source if width == source.width else source.resize((width, round(source.height * width / source.width)), Image.Resampling.LANCZOS)
    for extension, settings in [('webp', {'quality': quality, 'method': 6}), ('avif', {'quality': 48, 'speed': 6})]:
        destination = assets / f'peru-{name}.{extension}'
        resized.save(destination, **settings)
        print(f'{destination.name}: {destination.stat().st_size} bytes; {resized.width}x{resized.height}')
