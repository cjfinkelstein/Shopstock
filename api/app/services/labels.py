"""Avery 5160 label sheet generator: 3 x 10 labels per letter sheet,
each label 2.625in x 1in. QR codes rendered server-side as inline SVG paths
(no JS, no external assets) so the page prints from any browser."""

import html

import qrcode
import qrcode.image.svg

from app.models import Item

# Avery 5160 geometry (inches)
TOP_MARGIN = 0.5
SIDE_MARGIN = 0.1875
LABEL_W = 2.625
LABEL_H = 1.0
H_PITCH = 2.75
COLS = 3
ROWS = 10
PER_SHEET = COLS * ROWS


def _qr_svg(data: str) -> str:
    img = qrcode.make(
        data,
        image_factory=qrcode.image.svg.SvgPathImage,
        box_size=10,
        border=0,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
    )
    return img.to_string().decode()


def render_label_sheet(items: list[Item], copies_per_item: int = 1, app_name: str = "APEX Electrical Stock") -> str:
    labels = []
    for item in items:
        for _ in range(copies_per_item):
            labels.append(item)

    cells = []
    for i, item in enumerate(labels):
        qr = _qr_svg(item.barcode)
        cells.append(
            f"""<div class="label">
  <div class="qr">{qr}</div>
  <div class="txt">
    <div class="sku">{html.escape(item.sku)}</div>
    <div class="name">{html.escape(item.name)}</div>
  </div>
</div>"""
        )
    # pad the final sheet to a full 30-label grid
    while len(cells) % PER_SHEET != 0:
        cells.append('<div class="label"></div>')

    sheets = []
    for s in range(0, len(cells), PER_SHEET):
        sheets.append('<div class="sheet">' + "\n".join(cells[s : s + PER_SHEET]) + "</div>")

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{html.escape(app_name)} — Labels (Avery 5160)</title>
<style>
  @page {{ size: letter; margin: 0; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #eee; }}
  .toolbar {{ padding: 12px; text-align: center; }}
  .toolbar button {{ font-size: 16px; padding: 10px 24px; border-radius: 8px; border: none;
    background: #1d4ed8; color: #fff; cursor: pointer; }}
  .sheet {{
    width: 8.5in; height: 11in; background: #fff; margin: 0 auto 16px;
    padding: {TOP_MARGIN}in {SIDE_MARGIN}in;
    display: grid;
    grid-template-columns: repeat({COLS}, {H_PITCH}in);
    grid-auto-rows: {LABEL_H}in;
    page-break-after: always;
  }}
  .label {{
    width: {LABEL_W}in; height: {LABEL_H}in;
    display: flex; align-items: center; gap: 0.08in;
    padding: 0.06in 0.1in; overflow: hidden;
  }}
  .qr {{ width: 0.8in; height: 0.8in; flex: 0 0 auto; }}
  .qr svg {{ width: 100%; height: 100%; }}
  .txt {{ min-width: 0; }}
  .sku {{ font-size: 11pt; font-weight: 700; white-space: nowrap; }}
  .name {{ font-size: 8pt; line-height: 1.15; overflow: hidden; display: -webkit-box;
    -webkit-line-clamp: 3; -webkit-box-orient: vertical; }}
  @media print {{ body {{ background: #fff; }} .toolbar {{ display: none; }} .sheet {{ margin: 0; }} }}
</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Print</button></div>
{"".join(sheets)}
</body>
</html>"""
