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


def compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


# sku -> (query, [required compact substrings -- ALL must appear])
RETRY = {
    "WIRE-XHHW1-GRN": ("XHHW 1 AWG aluminum stranded green", ["xhhw1al", "green"]),
    "WIRE-XHHW10-BLK": ("XHHW 1/0 AWG aluminum stranded black", ["xhhw10al", "black"]),
    "WIRE-XHHW2-GRN": ("XHHW 2 AWG aluminum stranded green", ["xhhw2al", "green"]),
    "WIRE-XHHW30-BLK": ("XHHW 3/0 AWG aluminum stranded black", ["xhhw30al", "black"]),
    "WIRE-XHHW30-BLU": ("XHHW 3/0 AWG aluminum stranded blue", ["xhhw30al", "blue"]),
    "WIRE-XHHW30-RED": ("XHHW 3/0 AWG aluminum stranded red", ["xhhw30al", "red"]),
    "WIRE-XHHW30-WHT": ("XHHW 3/0 AWG aluminum stranded white", ["xhhw30al", "white"]),
    "WIRE-XHHW40-BLK": ("XHHW 4/0 AWG aluminum stranded black", ["xhhw40al", "black"]),
    "WIRE-XHHW40-BLU": ("XHHW 4/0 AWG aluminum stranded blue", ["xhhw40al", "blue"]),
    "WIRE-XHHW40-RED": ("XHHW 4/0 AWG aluminum stranded red", ["xhhw40al", "red"]),
    "WIRE-XHHW40-WHT": ("XHHW 4/0 AWG aluminum stranded white", ["xhhw40al", "white"]),
    "LABEL-CODETAPE-BLU": ("3M 35 blue 3/4x66ft electrical tape", ["35blue", "3466"]),
    "LABEL-CODETAPE-WHT": ("3M 35 white 3/4x66ft electrical tape", ["35white", "3466"]),
    "WIRE-BARE6": ("6 AWG bare copper solid wire", ["bare", "6awg"]),
    "WIRE-THHN6-RED-STR": ("WCU THHN 6 AWG copper stranded red", ["thhn6", "red"]),
    "WIRE-THHN8-RED-STR": ("WCU THHN 8 AWG copper stranded red", ["thhn8", "red"]),
    "BRKR-BR260": ("Eaton BR260 breaker", ["br260"]),
    "BRKR-CHF260": ("CHF260 breaker", ["chf260"]),
    "FITT-BARHANGER16": ("Orbit BHA-16 adjustable bar hanger", ["bha16"]),
    "GRND-RODCLAMP58": ("CP58 ground rod clamp", ["cp58"]),
    "BOX-4SQ-1GRING": ("Steel City 52C14 square box ring 1 gang", ["52c14"]),
    "BOX-4SQ-2GRING": ("Steel City 52C18 square box ring 2 gang", ["52c18"]),
    "DEV-GFCI15": ("Leviton GFTR1-W GFCI receptacle 15A", ["gftr1"]),
    "BRKR-THQD32175": ("GE THQD32175 breaker 175A", ["thqd32175"]),
    "LIGHT-BAFFLE-RA56LS9": ("Halo RA56LS9FSD2W1EWH LED baffle", ["ra56ls9"]),
    "LIGHT-RECESSED-RL56069": ("Halo RL56069FSD2W1EWH recessed LED", ["rl56069"]),
}


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
        for sku, (q, required) in RETRY.items():
            item = db.query(Item).filter(Item.sku == sku).first()
            if not item or item.image_data:
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

        print(f"\nMatched {len(matched)}/{len(RETRY)}")
        print(f"Still skipped {len(skipped)}: {skipped}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
