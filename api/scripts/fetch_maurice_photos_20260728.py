"""Fetch real product photos from mauriceelectric.com's public catalog API
for our items, matched by manufacturer part number extracted from the
original invoice line (stored in each item's `description`). Downloads,
resizes to a small thumbnail (same treatment as the manual upload feature),
and saves into Item.image_data.

Matching is conservative: a product is only accepted if ALL required tokens
appear (after normalizing hyphens/slashes/spaces to plain spaces, since the
site's search index formats "3/4" as "3 4"). Where multiple brands sell an
equivalent part (e.g. Leviton vs Cooper vs Hubbell wallplates), a preferred
brand keyword breaks the tie so the photo matches what was actually bought.

Run from the api/ directory:  python scripts/fetch_maurice_photos_20260728.py
"""

import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image

from app.database import SessionLocal
from app.models import Item

HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
}
THUMB_MAX = 160

# (search query, [required tokens -- ALL must appear, normalized], preferred brand token or None)
JOBS = {
    "BOX-4SQ-DEEP": ("52171", ["52171"], None),
    "BOX-4SQ-GB": ("52151", ["52151"], None),
    "COND-EMT34": ("3/4 EMT conduit 10 ft", ["emt", "3 4"], None),
    "COND-LQT34": ("3/4 liquidtight flexible conduit", ["liquidtight", "3 4"], None),
    "COND-PVC1": ("1 inch PVC conduit schedule 40 10 ft", ["pvc", "1 inch"], None),
    "CTRL-PIRCEIL": ("CM9 sensor occupancy", ["cm 9", "occupancy"], None),
    "CTRL-PP20": ("PP-20 power pack", ["pp 20", "power pack"], None),
    "DEV-DIMMER-3WY": ("DVCL-153PH white", ["dvcl 153ph"], "white"),
    "DEV-GFCI20": ("GFTR2-W GFCI", ["gftr2"], None),
    "DEV-REC20": ("16352-1PW receptacle", ["16352"], None),
    "DEV-REC20-DECO": ("T5825-W receptacle", ["t5825"], None),
    "DEV-WPCOVER": ("XD110C weatherproof cover", ["xd110c"], None),
    "DISC-DPU222R": ("DPU222R pullout disconnect", ["dpu222"], None),
    "FITT-BXCOMBO38": ("C23C connector", ["c23c"], None),
    "FITT-BXDUPLEX38": ("C270A connector", ["c270a"], None),
    "FITT-CADHANGER": ("Caddy KX hanger", ["kx"], "caddy"),
    "FITT-EMTCONN34-EA": ("S1111 EMT connector", ["s1111"], None),
    "FITT-EMTCOUP34": ("S1114 EMT coupling", ["s1114"], None),
    "FITT-LQTCONN-90": ("SLT36T liquidtight connector", ["slt36t"], None),
    "FITT-LQTCONN-STR": ("SLT28T liquidtight connector", ["slt28t"], None),
    "FITT-PVCCAP1": ("E958F PVC end cap", ["e958f"], None),
    "FITT-SC1SEC": ("SC1 service entrance connector", ["sc1"], None),
    "LABEL-PCMB3": ("Panduit PCMB wire marker book", ["marker book"], "panduit"),
    "PLATE-1G-DECO": ("PJ26-W wallplate", ["pj26"], "leviton"),
    "PLATE-1G-DUP": ("PJ8-W wallplate", ["pj8"], "leviton"),
    "PLATE-2G-DECO": ("PJ262-W wallplate", ["pj262"], "leviton"),
    "STRAP-EMT34": ("143S EMT strap 1 hole", ["143s"], None),
    "WIRE-12THHN-BK": ("THHN 12 AWG black solid", ["12 awg", "black"], None),
    "WIRE-12THHN-BLSTR": ("THHN 12 AWG blue stranded", ["12 awg", "blue"], None),
    "WIRE-12THHN-GRN": ("THHN 12 AWG green solid", ["12 awg", "green"], None),
    "WIRE-12THHN-RD": ("THHN 12 AWG red solid", ["12 awg", "red"], None),
    "WIRE-12THHN-WH": ("THHN 12 AWG white solid", ["12 awg", "white"], None),
    "WIRE-18-4C-PLEN": ("West Penn 25244B plenum cable", ["25244b"], None),
    "WIRE-SEU666": ("SEU 6-6-6 service entrance cable", ["seu", "6 6 6"], None),
}


def norm(s: str) -> str:
    return re.sub(r"[-/.\s]+", " ", s.lower()).strip()


def http_get(url: str, tries: int = 5, binary: bool = False):
    last_err = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
                return data if binary else json.loads(data.decode())
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise last_err


def search(q):
    url = "https://www.mauriceelectric.com/api/catalog_system/pub/products/search?ft=" + urllib.parse.quote(q)
    return http_get(url)


def best_match(results, required, brand):
    candidates = []
    for p in results[:12]:
        name_n = norm(p["productName"])
        if all(norm(req) in name_n for req in required):
            candidates.append(p)
    if not candidates:
        return None
    if brand:
        for p in candidates:
            if brand in norm(p["productName"]):
                return p
    return candidates[0]


def first_image_url(product):
    for item in product.get("items", []):
        for img in item.get("images", []):
            url = img.get("imageUrl")
            if url:
                return url
    return None


def to_thumbnail(image_bytes: bytes) -> str:
    im = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    scale = min(1, THUMB_MAX / max(im.width, im.height))
    w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    im = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    import base64
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    db = SessionLocal()
    matched, skipped = [], []
    try:
        for sku, (q, required, brand) in JOBS.items():
            item = db.query(Item).filter(Item.sku == sku).first()
            if not item:
                print(f"{sku}: item not found, skipping")
                continue
            try:
                results = search(q)
            except Exception as e:
                print(f"{sku}: SEARCH FAILED ({e})")
                skipped.append(sku)
                time.sleep(1)
                continue

            product = best_match(results, required, brand)
            if not product:
                cands = [p["productName"][:60] for p in results[:3]]
                print(f"{sku}: no confident match -- candidates: {cands}")
                skipped.append(sku)
                time.sleep(1)
                continue

            img_url = first_image_url(product)
            if not img_url:
                print(f"{sku}: matched {product['productName'][:60]!r} but no image")
                skipped.append(sku)
                time.sleep(1)
                continue

            try:
                image_bytes = http_get(img_url, binary=True)
                thumb = to_thumbnail(image_bytes)
            except Exception as e:
                print(f"{sku}: download/resize failed ({e})")
                skipped.append(sku)
                time.sleep(1)
                continue

            item.image_data = thumb
            db.commit()
            print(f"{sku}: OK <- {product['productName'][:65]!r}")
            matched.append(sku)
            time.sleep(1.2)

        print(f"\nMatched {len(matched)}/{len(JOBS)}: {matched}")
        print(f"Skipped {len(skipped)}: {skipped}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
