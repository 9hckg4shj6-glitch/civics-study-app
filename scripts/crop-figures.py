#!/usr/bin/env python3
"""問題冊子PDFから図を切り出して WebP にする。

使い方:
    python3 scripts/crop-figures.py spec.json
    （収録済みの年度の spec は scripts/figure-specs/ にある）

spec.json の形:
{
  "pdf": "/path/to/booklet.pdf",
  "outDir": "public/images/chemistry",
  "renderDpi": 300,          # ページを描き出す解像度
  "bandDpi": 100,            # band の座標をどの解像度で指定したか
  "pad": 26,                 # 余白（renderDpi の画素）
  "maxWidth": 1100,          # 幅の上限（renderDpi の画素）
  "minComponent": 60,        # これ未満の連結成分（画素数）は点として白く消す
                             # （スキャン冊子向け。ベクターPDFでは短い結合の線が消えるので 0 にする）
  "figures": [
    {"name": "2025-4-2-c1", "page": 25, "band": [x0, y0, x1, y1]}
  ]
}

手順は docs/化学科目_実装計画.md 5.1 のとおり:
  1. ページを renderDpi で描き出す
  2. band の中でインク（輝度190未満）のある範囲まで自動で詰める
  3. 余白を pad 画素足す
  4. 幅が maxWidth を超えたら縮める
  5. minComponent 未満の連結成分を白く消す（スキャンの点を落とす）
  6. WebP（quality 82）で outDir に書く
"""
import json
import sys
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
from PIL import Image
from scipy import ndimage

INK = 190


def crop_one(page_img, band, scale, pad, max_width, min_component):
    x0, y0, x1, y1 = [int(round(v * scale)) for v in band]
    arr = np.asarray(page_img.convert("L"))
    region = arr[y0:y1, x0:x1]
    ink = region < INK
    # 点を落とす（連結成分の面積が小さいものを白く塗る）
    labels, count = ndimage.label(ink)
    if count:
        sizes = ndimage.sum(ink, labels, range(1, count + 1))
        small = np.isin(labels, [i + 1 for i, s in enumerate(sizes) if s < min_component])
        region = region.copy()
        region[small] = 255
        ink = region < INK
    ys, xs = np.where(ink)
    if len(xs) == 0:
        raise SystemExit(f"インクが見つからない: band={band}")
    left, right = xs.min(), xs.max() + 1
    top, bottom = ys.min(), ys.max() + 1
    cropped = Image.fromarray(region[top:bottom, left:right])
    w, h = cropped.size
    canvas = Image.new("L", (w + pad * 2, h + pad * 2), 255)
    canvas.paste(cropped, (pad, pad))
    if canvas.width > max_width:
        ratio = max_width / canvas.width
        canvas = canvas.resize((max_width, int(round(canvas.height * ratio))), Image.LANCZOS)
    return canvas


def main(spec_path):
    spec = json.loads(Path(spec_path).read_text(encoding="utf-8"))
    doc = fitz.open(spec["pdf"])
    render_dpi = spec.get("renderDpi", 300)
    band_dpi = spec.get("bandDpi", 100)
    scale = render_dpi / band_dpi
    pad = spec.get("pad", 26)
    max_width = spec.get("maxWidth", 1100)
    min_component = spec.get("minComponent", 60)
    out_dir = Path(spec["outDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = {}
    total = 0
    for fig in spec["figures"]:
        page_no = fig["page"]
        if page_no not in cache:
            pix = doc[page_no - 1].get_pixmap(dpi=render_dpi)
            cache[page_no] = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        img = crop_one(cache[page_no], fig["band"], scale, pad, max_width, min_component)
        out = out_dir / f"{fig['name']}.webp"
        img.save(out, "WEBP", quality=82, method=5)
        size = out.stat().st_size
        total += size
        print(f"{out}  {img.width}x{img.height}  {size/1024:.1f}KB")
    print(f"{len(spec['figures'])} 点, 計 {total/1024:.0f}KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
