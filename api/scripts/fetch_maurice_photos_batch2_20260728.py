"""Fetch real product photos for the 109 items added in the second Maurice
batch (no photo yet). Same pipeline as fetch_maurice_photos_20260728.py, but
matching now uses word-boundary checks for single-token requirements (e.g.
"s1112") so it can't false-match a longer code that merely starts with it
(e.g. "s1112d") -- a real risk in this batch since SEPCO reuses short
numeric codes with letter suffixes for closely related parts (S1112/S1112D,
S1115/S1115B). Multi-word requirements are still checked as plain
substrings, which don't have that problem.

Run from the api/ directory:  python scripts/fetch_maurice_photos_batch2_20260728.py
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

# sku -> (query, [required -- word-boundary if no space, substring if it has one], brand or None)
JOBS = {
    "BOX-3G-NONMETALLIC": ("B344AB outlet box non-metallic", ["b344ab"], None),
    "BOX-4SQ-1GRING": ("52C14 square box ring", ["52c14"], None),
    "BOX-4SQ-2-1-8-34KO": ("52171 square box 2-1/8 deep", ["52171"], None),
    "BOX-4SQ-2-1-8-BX": ("52171X square box bracket", ["52171x"], None),
    "BOX-4SQ-2GRING": ("52C18 square box ring", ["52c18"], None),
    "BOX-4SQ-BX": ("52151 square box bracket", ["52151"], None),
    "BOX-FLOORBOX-WM880MP": ("880MP nonmetallic floor box", ["880mp"], None),
    "BRKR-BR120": ("BR120 breaker Eaton", ["br120"], None),
    "BRKR-BR220": ("BR220 breaker Eaton", ["br220"], None),
    "BRKR-BR240": ("BR240 breaker Eaton", ["br240"], None),
    "BRKR-BR260": ("BR260 breaker Eaton", ["br260"], None),
    "BRKR-CHF260": ("CHF260 breaker", ["chf260"], None),
    "BRKR-THQD32175": ("THQD32175 breaker", ["thqd32175"], None),
    "BRKR-TQDHW": ("ASPTQD3P TQD kit breaker", ["asptqd3p"], None),
    "COND-EMT1": ("EMT 1 inch conduit 10 ft", ["emt", "1 inch"], None),
    "COND-EMT112": ("EMT 1-1/2 inch conduit 10 ft", ["emt", "1 1 2"], None),
    "COND-EMT212": ("EMT 2-1/2 inch conduit 10 ft", ["emt", "2 1 2"], None),
    "COND-FLEX12STL": ("1/2 inch flexible steel conduit", ["flexible", "1 2"], None),
    "COND-FLEX34ALU": ("3/4 inch flexible aluminum conduit", ["flexible", "3 4"], None),
    "COND-PVC34": ("3/4 inch PVC conduit schedule 40", ["pvc", "3 4"], None),
    "CONSUM-CABLETIE15": ("CT15BK50 cable tie 15 inch black", ["ct15bk50"], None),
    "CONSUM-DUCTSEAL": ("31-601 duct seal", ["31 601"], None),
    "CONSUM-NOALOX": ("30-026 noalox anti-oxidant compound", ["noalox"], None),
    "CONSUM-PVCCEMENT": ("078884 PVC solvent cement", ["078884"], None),
    "CONSUM-SPLICETAPE": ("2155 splicing tape", ["2155"], None),
    "CONSUM-WIRENUT-OB": ("performance plus wire connector orange blue", ["orange", "blue"], None),
    "CONSUM-WIRENUT-TR": ("performance plus wire connector tan red", ["tan", "red"], None),
    "DEV-GFCI15": ("GFTR1-W GFCI 15A", ["gftr1"], None),
    "DEV-GFCICOVER-MULB": ("11433 GFCI cover 4 square", ["11433"], None),
    "DEV-REC15-DECO": ("T5325-W decora receptacle", ["t5325"], None),
    "DEV-SW15-DECO": ("5601-2W decora switch", ["5601"], None),
    "DISC-DG221UGB": ("DG221UGB disconnect switch", ["dg221ugb"], None),
    "FITT-BARHANGER16": ("BHA-16 adjustable bar hanger", ["bha 16"], None),
    "FITT-BEAMCLAMP": ("beam clamp malleable iron 1/4-20", ["beam clamp"], None),
    "FITT-BOXBRACKET-C23": ("Caddy C23 box mounting bracket", ["c23"], "caddy"),
    "FITT-CABLESUPPORT": ("CS-CJ6 cable support stud mount", ["cs cj6"], None),
    "FITT-CLOSUREPLATE8": ("F88GCPNKGV closure plate", ["f88gcpnkgv"], None),
    "FITT-ELBOW1-90": ("EMT 1 inch 90 degree elbow", ["1 90 degree"], None),
    "FITT-ELBOW112-90": ("EMT 1-1/2 inch 90 degree elbow", ["1 1 2 90 degree"], None),
    "FITT-ELBOW2-45": ("EMT 2 inch 45 degree elbow", ["2 45 degree"], None),
    "FITT-EMTCONN1": ("S1112 EMT connector 1 inch", ["s1112"], None),
    "FITT-EMTCONN212": ("S1112D EMT connector 2-1/2", ["s1112d"], None),
    "FITT-EMTCOUP1": ("S1115 EMT coupling 1 inch", ["s1115"], None),
    "FITT-EMTCOUP112": ("S1115B EMT coupling 1-1/2", ["s1115b"], None),
    "FITT-FLEXCOMBO34": ("172C flex combination connector", ["172c"], None),
    "FITT-FLEXCONN12-STR": ("C27Z flex connector 1/2 inch", ["c27z"], None),
    "FITT-FLEXCONN34-STR": ("C28Z flex connector 3/4 inch", ["c28z"], None),
    "FITT-GNDBUSH212": ("26BIOL grounding bushing", ["26biol"], None),
    "FITT-HAMMERCLIP": ("4H24 hammer on flange clip", ["4h24"], None),
    "FITT-HANGER1": ("12CS conduit hanger 1 inch", ["12cs"], None),
    "FITT-HANGER112": ("14CS conduit hanger 1-1/2 inch", ["14cs"], None),
    "FITT-INSBUSH2": ("ST15 plastic insulating bushing 2 inch", ["st15"], None),
    "FITT-INSBUSH212": ("ST16 plastic insulating bushing 2-1/2", ["st16"], None),
    "FITT-KOSEAL12": ("SS50 KO seal flat 1/2 inch", ["ss50"], None),
    "FITT-LBBODY1ALU": ("LB3A aluminum LB conduit body 1 inch", ["lb3a"], None),
    "FITT-LBCOVER1": ("steel LB type cover 1 inch", ["lb type cover"], None),
    "FITT-LBGASKET1": ("neoprene LB type gasket 1 inch", ["neoprene", "lb"], None),
    "FITT-LOCKNUT34": ("707 steel locknut 3/4 inch", ["707"], None),
    "FITT-MECHSPLICE2": ("AMS2 mechanical splice", ["ams2"], None),
    "FITT-MIDGETSTRAP": ("10590-S midget strap", ["10590"], None),
    "FITT-PULLBOXCOVER884": ("ASG8X8X4NK pull box screw cover", ["asg8x8x4nk"], None),
    "FITT-PVCADAPTER34": ("E943E PVC male terminal adapter", ["e943e"], None),
    "FITT-PVCLB34": ("E986E PVC type LB conduit body", ["e986e"], None),
    "FITT-REDWASHER212-2": ("CW76 steel reducing washer", ["cw76"], None),
    "FITT-ROMEXCONN38": ("Sepco C23 romex connector 3/8", ["c23"], "sepco"),
    "FITT-SC50S1": ("C50S service entrance connector", ["c50s"], None),
    "FITT-SECSTRAP": ("ARL 301 service entrance cable strap", ["301", "strap"], None),
    "FITT-UNITAP25010": ("BIBD2504 unitap connector", ["bibd2504"], None),
    "GRND-BUSBAR14412": ("EGBA14412CC ground busbar", ["egba14412cc"], None),
    "GRND-GBKP1420": ("GBKP1420 ground bar kit", ["gbkp1420"], None),
    "GRND-GBKP2120": ("GBKP2120 ground bar kit 2/0", ["gbkp2120"], None),
    "GRND-GC50": ("GC50 grounding connector", ["gc50"], None),
    "GRND-NL20": ("NL20 neutral ground lug", ["nl20"], None),
    "GRND-ROD58-8FT": ("615880 copper ground rod 5/8 8ft", ["615880"], None),
    "GRND-RODCLAMP58": ("CP58 ground rod clamp", ["cp58"], None),
    "HW-JN163": ("JN163 hex fin nut", ["jn163"], None),
    "HW-JRM103": ("JRM103 machine screw", ["jrm103"], None),
    "LABEL-CODETAPE-BLU": ("35 coding tape blue 3/4x66ft", ["coding tape", "blue"], None),
    "LABEL-CODETAPE-RED": ("35 coding tape red 3/4x66ft", ["coding tape", "red"], None),
    "LABEL-CODETAPE-WHT": ("35 coding tape white 3/4x66ft", ["coding tape", "white"], None),
    "LIGHT-BAFFLE-RA56LS9": ("RA56LS9 halo led baffle", ["ra56ls9"], None),
    "LIGHT-MOUNTFRAME-HL4RSMF": ("HL4RSMF halo mounting frame", ["hl4rsmf"], None),
    "LIGHT-RECESSED-RL56069": ("RL56069 halo recessed led retrofit", ["rl56069"], None),
    "PLATE-3G-DECO": ("PJ263-W wallplate 3 gang decora", ["pj263"], None),
    "STRAP-EMT1": ("144S EMT strap 1 inch", ["144s"], None),
    "TOOL-HOLECUTTER": ("49-56-0320 adjustable hole cutter", ["49 56 0320"], None),
    "WIRE-BARE6": ("6 AWG bare copper solid ground wire", ["bare copper", "6 awg"], None),
    "WIRE-MC122": ("12/2 MC cable aluminum jacket AFC glide", ["12 2", "mc"], None),
    "WIRE-MC123": ("12/3 MC cable aluminum jacket AFC glide", ["12 3", "mc"], None),
    "WIRE-MC124": ("12/4 MC cable aluminum jacket", ["12 4", "mc"], None),
    "WIRE-SER2224": ("2-2-2-4 SER aluminum service cable", ["2 2 2 4"], None),
    "WIRE-SER4444-2": ("4/0-4/0-4/0-4/0-2/0 SER aluminum 3 phase", ["4 0 4 0 4 0 4 0 2 0"], None),
    "WIRE-THHN30-BLK-STR": ("THHN 3/0 AWG copper stranded black", ["3 0", "black", "stranded"], None),
    "WIRE-THHN6-BLK-STR": ("THHN 6 AWG copper stranded black", ["6 awg", "black", "stranded"], None),
    "WIRE-THHN6-RED-STR": ("THHN 6 AWG copper stranded red", ["6 awg", "red", "stranded"], None),
    "WIRE-THHN8-BLK-STR": ("THHN 8 AWG copper stranded black", ["8 awg", "black", "stranded"], None),
    "WIRE-THHN8-GRN-STR": ("THHN 8 AWG copper stranded green", ["8 awg", "green", "stranded"], None),
    "WIRE-THHN8-RED-STR": ("THHN 8 AWG copper stranded red", ["8 awg", "red", "stranded"], None),
    "WIRE-XHHW1-GRN": ("XHHW 1 AWG aluminum stranded green", ["xhhw 1 alum", "green"], None),
    "WIRE-XHHW10-BLK": ("XHHW 1/0 AWG aluminum stranded black", ["xhhw 1 0 alum", "black"], None),
    "WIRE-XHHW2-GRN": ("XHHW 2 AWG aluminum stranded green", ["xhhw 2 alum", "green"], None),
    "WIRE-XHHW30-BLK": ("XHHW 3/0 AWG aluminum stranded black", ["xhhw 3 0 alum", "black"], None),
    "WIRE-XHHW30-BLU": ("XHHW 3/0 AWG aluminum stranded blue", ["xhhw 3 0 alum", "blue"], None),
    "WIRE-XHHW30-RED": ("XHHW 3/0 AWG aluminum stranded red", ["xhhw 3 0 alum", "red"], None),
    "WIRE-XHHW30-WHT": ("XHHW 3/0 AWG aluminum stranded white", ["xhhw 3 0 alum", "white"], None),
    "WIRE-XHHW40-BLK": ("XHHW 4/0 AWG aluminum stranded black", ["xhhw 4 0 alum", "black"], None),
    "WIRE-XHHW40-BLU": ("XHHW 4/0 AWG aluminum stranded blue", ["xhhw 4 0 alum", "blue"], None),
    "WIRE-XHHW40-RED": ("XHHW 4/0 AWG aluminum stranded red", ["xhhw 4 0 alum", "red"], None),
    "WIRE-XHHW40-WHT": ("XHHW 4/0 AWG aluminum stranded white", ["xhhw 4 0 alum", "white"], None),
}


def norm(s: str) -> str:
    return re.sub(r"[-/.\s]+", " ", s.lower()).strip()


def token_matches(name_norm: str, req: str) -> bool:
    if " " in req:
        return req in name_norm
    return re.search(rf"\b{re.escape(req)}\b", name_norm) is not None


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
        if all(token_matches(name_n, req) for req in required):
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
            if item.image_data:
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
            time.sleep(1.1)

        print(f"\nMatched {len(matched)}/{len(JOBS)}")
        print(f"Skipped {len(skipped)}: {skipped}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
