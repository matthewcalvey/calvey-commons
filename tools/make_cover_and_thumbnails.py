#!/usr/bin/env python3
"""make_cover_and_thumbnails.py — the book's cover mosaics and the small copies its galleries load.

Reads the figure blocks in text/ (book order), takes each placed photograph or scan (a jpg/png whose
block is not an original diagram and whose status is ready), and writes
  images/cover-mosaic.jpg      every reproduced image, cropped square and tiled small, 12 across (wide screens)
  images/cover-mosaic-8x6.jpg  the same tiles, 8 across (middling screens)
  images/cover-mosaic-6x8.jpg  the same tiles, 6 across (phones)
  images/thumbs/<name>.jpg     a copy of each at most 480 px on its long side (galleries and contents)
Re-run it whenever a photograph is added or removed, then re-pour. Needs Pillow.
Usage: python3 tools/make_cover_and_thumbnails.py [book folder]
"""
import os, re, glob, sys
from PIL import Image, ImageOps

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..'))
TILE = 160

def placed_images():
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'text', 'NATURE_ARCHITECTURE_0[0-9]_*.md'))):
        s = open(f, encoding='utf-8').read()
        parts = re.split(r'^## 04 · FIGURES\s*$', s, flags=re.M)
        if len(parts) < 2: continue
        fig = re.split(r'^## 05 · ', parts[1], flags=re.M)[0]
        for b in re.split(r'\n(?=FIG )', fig):
            if not b.startswith('FIG '): continue
            d = dict(re.findall(r'^([a-z]+):\s*(.*)$', b, re.M))
            if d.get('source', '').lower().startswith('original') or not d.get('status', '').startswith('ready'): continue
            slug = os.path.splitext(os.path.basename(d.get('file', '')))[0]
            for p in sorted(glob.glob(os.path.join(ROOT, 'images', '*', slug + '.*'))):
                if os.path.basename(os.path.dirname(p)) == 'thumbs': continue
                if p.lower().endswith(('.jpg', '.jpeg', '.png')): out.append(p); break
    return out

imgs = placed_images()
if not imgs: sys.exit('no placed images found')
tiles = []
for p in imgs:
    im = ImageOps.exif_transpose(Image.open(p)).convert('RGB')
    tiles.append(ImageOps.fit(im, (TILE, TILE), Image.LANCZOS, centering=(0.5, 0.45)))

for name, cols in (('cover-mosaic.jpg', 12), ('cover-mosaic-8x6.jpg', 8), ('cover-mosaic-6x8.jpg', 6)):
    rows = -(-len(tiles) // cols)
    cells = tiles + tiles[: rows * cols - len(tiles)]          # fill the last row by starting the sequence again
    sheet = Image.new('RGB', (cols * TILE, rows * TILE), (20, 21, 19))
    for i, t in enumerate(cells):
        sheet.paste(t, ((i % cols) * TILE, (i // cols) * TILE))
    out = os.path.join(ROOT, 'images', name)
    sheet.save(out, quality=80, optimize=True, progressive=True)
    print(f'{len(imgs)} images, {rows} x {cols} tiles of {TILE} px -> images/{name} ({os.path.getsize(out) // 1024} KB)')

thumbs = os.path.join(ROOT, 'images', 'thumbs'); os.makedirs(thumbs, exist_ok=True)
total = 0
for p in imgs:
    im = ImageOps.exif_transpose(Image.open(p)).convert('RGB')
    im.thumbnail((480, 480), Image.LANCZOS)
    t = os.path.join(thumbs, os.path.splitext(os.path.basename(p))[0] + '.jpg')
    im.save(t, quality=78, optimize=True, progressive=True)
    total += os.path.getsize(t)
print(f'{len(imgs)} thumbnails -> images/thumbs/ ({total // 1024} KB in all)')
