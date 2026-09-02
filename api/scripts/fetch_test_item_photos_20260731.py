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

# sku -> (query, [required compact substrings -- ALL must appear])
TARGETS = {
    "WIRE-14THHN-BK": ("14 AWG THHN copper black", ["thhn14", "black"]),
    "WIRE-14THHN-WH": ("14 AWG THHN copper white", ["thhn14", "white"]),
    "WIRE-14THHN-GRN": ("14 AWG THHN copper green", ["thhn14", "green"]),
    "DEV-SW15-SP": ("Leviton 15A single pole switch white", ["15amp", "white"]),
    "DEV-SW15-3WY": ("Leviton 15A 3-way switch white", ["3way", "white"]),
}


def compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


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


def best_match(results, required):
    for p in results[:15]:
        name_c = compact(p["productName"])
        if all(req in name_c for req in required):
            return p
    return None


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
        for sku, (q, required) in TARGETS.items():
            item = db.query(Item).filter(Item.sku == sku).first()
            if not item:
                print(f"{sku}: not found in DB")
                continue
            try:
                results = search(q)
            except Exception as e:
                print(f"{sku}: SEARCH FAILED ({e})")
                skipped.append(sku)
                time.sleep(1)
                continue

            product = best_match(results, required)
            if not product:
                cands = [p["productName"][:60] for p in results[:3]]
                print(f"{sku}: no confident match -- candidates: {cands}")
                skipped.append(sku)
                time.sleep(1)
                continue

            img_url = first_image_url(product)
            if not img_url:
                print(f"{sku}: matched but no image")
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
            time.sleep(1.1)

        print(f"\nMatched {len(matched)}/{len(TARGETS)}")
        print(f"Still skipped {len(skipped)}: {skipped}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
