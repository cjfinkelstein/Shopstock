"""Second Maurice Electrical Supply batch, from Apex_Maurice_Invoices_WithPricing.xlsx
(36 invoices; one is a duplicate of S130868397.001 already imported, one is
a pure AR service charge, one is the sheet's own TOTAL row -- all three
excluded).

Reads the Line Items sheet directly (rather than hand-transcribing 163 rows)
to avoid transcription errors. Each unique material description (with
"[TAGGED]" stripped -- that's just Maurice's job-tag annotation, not a
different product) is mapped to a ShopStock item: either an existing item
(only where brand+spec genuinely match -- verified by hand, not fuzzy text
matching) or a new one with a generated SKU/category/unit.

EMT/PVC conduit sold in 10' lengths is converted from linear feet to
"sticks" (unit each, qty/10) to match the existing COND-EMT34 convention.
Continuous coils/reels/spools stay in feet.

Same "doesn't stock it" model as the first batch: RECEIVE to shop, then
either SIGN_OUT to the job the invoice's PO/Job field resolves to, or (for
POs that don't match a known job) a generic ADJUST, exactly like the
1407 Shoemaker case before it got its own job.

Run from the api/ directory:  python scripts/import_maurice_batch2_20260728.py
"""

import re
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Item, Job, Location, User, Vendor
from app.services.ledger import apply_transaction

XLSX = r"C:\Users\CJFinkelstein\Downloads\Apex_Maurice_Invoices_WithPricing.xlsx"

EXCLUDE_INVOICES = {
    "S130868397.001",  # duplicate of the first batch
    "S130716417.001",  # AR: Service Charge, not material
}

# normalized (TAGGED-stripped) description -> existing SKU (verified match)
EXISTING_MATCHES = {
    "SEPCO 143S 3/4\" Steel EMT 1 Hole Straps": "STRAP-EMT34",
    "EMT 3/4\" X 10'": "COND-EMT34",
    "SEPCO S1114 3/4\" STL SS EMT Coup": "FITT-EMTCOUP34",
    "SEPCO S1111 3/4\" STL SS EMT Conn": "FITT-EMTCONN34-EA",
    "LEV GFTR2-W 20A 125V Slim TR GFCI": "DEV-GFCI20",
    "LUT DVCL-153PH-WH SP 3WY DMR": "DEV-DIMMER-3WY",
    "SEPCO C270A 3/8\" Die Cast Duplex BX 1 Screw Clamp TypeConnector": "FITT-BXDUPLEX38",
    "SEPCO SC1 3/4\" Die Cast Service Entrance Connector": "FITT-SC1SEC",
    "STLCTY 52171-1/2-3/4-E 4SQ 2-1/8 Deep Box": "BOX-4SQ-DEEP",
}

# 10' stick conduit -- convert ft -> each (/10)
STICK_ITEMS = {
    "EMT 2-1/2\" X 10'": ("COND-EMT212", '2-1/2" EMT 10\' Stick', "Conduit"),
    "EMT 1\" X 10'": ("COND-EMT1", '1" EMT 10\' Stick', "Conduit"),
    "EMT 1-1/2\" X 10'": ("COND-EMT112", '1-1/2" EMT 10\' Stick', "Conduit"),
    "PVC SCH 40 3/4\" X 10' Pipe": ("COND-PVC34", '3/4" PVC SCH40 10\' Stick', "Conduit"),
}

# normalized description -> (sku, name, category, unit) for everything else new
NEW_CATALOG = {
    "AFC A004-42-00 MC Glide 12/2 BK WH GN Alum Jacket 250' Coil": ("WIRE-MC122", "12/2 MC Cable, Aluminum Jacket (AFC Glide)", "Wire", "foot"),
    "AFC A005-42-00 MC Glide 12/3 BK WE RD GN Alum Jacket 250' Coil": ("WIRE-MC123", "12/3 MC Cable, Aluminum Jacket (AFC Glide)", "Wire", "foot"),
    "SEPCO S1112D 2-1/2\" Steel Set Screw EMT Connector": ("FITT-EMTCONN212", '2-1/2" EMT Set-Screw Connector', "Fittings", "each"),
    "SEPCO 26BIOL 2-1/2\" Malleable Iron Insulated Threaded Grounding Bushing #14-2/0 Lug": ("FITT-GNDBUSH212", '2-1/2" Insulated Grounding Bushing #14-2/0 Lug', "Fittings", "each"),
    "SEPCO ST16 2-1/2\" Plastic Insulating Bushing": ("FITT-INSBUSH212", '2-1/2" Plastic Insulating Bushing', "Fittings", "each"),
    "HOFF F88GCPNKGV WW NEMA1 Closure Plate 8.00X8.00 Steel": ("FITT-CLOSUREPLATE8", "NEMA1 Closure Plate 8x8 Steel", "Fittings", "each"),
    "BUR BIBD2504 250-10 2-Side Unitap": ("FITT-UNITAP25010", "Unitap Connector 250-10, 2-Side", "Fittings", "each"),
    "WAL XHHW 4/0 Alum STR Blue Master Reel": ("WIRE-XHHW40-BLU", "4/0 AWG XHHW Aluminum Stranded, Blue", "Wire", "foot"),
    "WAL XHHW 4/0 Alum STR White Master Reel": ("WIRE-XHHW40-WHT", "4/0 AWG XHHW Aluminum Stranded, White", "Wire", "foot"),
    "WAL XHHW 1 Alum STR Green Master Reel": ("WIRE-XHHW1-GRN", "1 AWG XHHW Aluminum Stranded, Green", "Wire", "foot"),
    "WAL XHHW 4/0 Alum STR Black Master Reel": ("WIRE-XHHW40-BLK", "4/0 AWG XHHW Aluminum Stranded, Black", "Wire", "foot"),
    "WCU BARE 6 CU Solid Master Reel": ("WIRE-BARE6", "6 AWG Bare Copper Solid Ground Wire", "Wire", "foot"),
    "WCU BARE 6 CU Solid 1000' Reel": ("WIRE-BARE6", "6 AWG Bare Copper Solid Ground Wire", "Wire", "foot"),
    "WAL XHHW 4/0 Alum STR Red Master Reel": ("WIRE-XHHW40-RED", "4/0 AWG XHHW Aluminum Stranded, Red", "Wire", "foot"),
    "WAL XHHW 1/0 Alum STR Black Master Reel": ("WIRE-XHHW10-BLK", "1/0 AWG XHHW Aluminum Stranded, Black", "Wire", "foot"),
    "ARL GC50 Zinc Grounding Connector #8 to #2 STD OR SOL": ("GRND-GC50", "Grounding Connector #8-#2, Zinc", "Grounding", "each"),
    "MWK 49-56-0320 Adjustable Hole Cutter 2\"-7\"": ("TOOL-HOLECUTTER", 'Adjustable Hole Cutter 2"-7"', "Tools", "each"),
    "MMM 35-WHT-3/4X66FT Coding Tape USA": ("LABEL-CODETAPE-WHT", "Coding Tape 3/4x66ft, White", "Consumables", "each"),
    "MMM 35-RED-3/4X66FT Coding Tape USA": ("LABEL-CODETAPE-RED", "Coding Tape 3/4x66ft, Red", "Consumables", "each"),
    "MMM 35-BLUE-3/4X66FT Coding Tape USA": ("LABEL-CODETAPE-BLU", "Coding Tape 3/4x66ft, Blue", "Consumables", "each"),
    "WAL SER 2-2-2-4 Alum 1000' Reel": ("WIRE-SER2224", "2-2-2-4 SER Aluminum Service Entrance Cable", "Wire", "foot"),
    "SEPCO C50S 1\" Die Cast Short Body Round Service Entrance Connector": ("FITT-SC50S1", '1" Service Entrance Connector, Short Body', "Fittings", "each"),
    "CH BR120 20A 1P Plug-In 120/240V 10KIC Circuit Breaker": ("BRKR-BR120", "20A 1-Pole Breaker (Eaton BR120)", "Breakers", "each"),
    "CH GBKP1420 Ground Bar Kit PON": ("GRND-GBKP1420", "Ground Bar Kit, 14-Circuit", "Grounding", "each"),
    "IDE 31-601 1-LB Duct Seal": ("CONSUM-DUCTSEAL", "Duct Seal, 1lb", "Consumables", "each"),
    "IDE 30-026 4-OZ Squeeze Bottle Noalox Anti-Oxidant Compound": ("CONSUM-NOALOX", "Noalox Anti-Oxidant Compound, 4oz", "Consumables", "each"),
    "BKRBKR GED ASPTQD3P Hardware TQD (Breaker Broker)": ("BRKR-TQDHW", "TQD Conversion Hardware Kit, Used (Breaker Broker)", "Breakers", "each"),
    "BKRBKR THQD32175 175A Breaker, Used, Tested, 1yr Warranty (Breaker Broker)": ("BRKR-THQD32175", "175A 3-Pole Breaker, Used/Tested (Breaker Broker)", "Breakers", "each"),
    "MMM 2155-1-1/2X22FT Splicing Tape": ("CONSUM-SPLICETAPE", "Splicing Tape 1-1/2x22ft", "Consumables", "each"),
    "BUR AMS2 2 Mech Splice": ("FITT-MECHSPLICE2", "Mechanical Splice, 2 AWG", "Fittings", "each"),
    "SEPCO SS50 1/2\" Steel KO Seal Flat": ("FITT-KOSEAL12", '1/2" Steel KO Seal, Flat', "Fittings", "each"),
    "SEPCO CW76 2-1/2\"x2\" Steel Reducing Washer": ("FITT-REDWASHER212-2", '2-1/2"x2" Steel Reducing Washer', "Fittings", "each"),
    "SEPCO ST15 2 Plastic Insulating Bushing": ("FITT-INSBUSH2", '2" Plastic Insulating Bushing', "Fittings", "each"),
    "CH NL20 Add-On Neutral or Ground Lug Max-125A": ("GRND-NL20", "Add-On Neutral/Ground Lug, 125A Max", "Grounding", "each"),
    "WCU THHN 3/0 CU STR Black Master Reel": ("WIRE-THHN30-BLK-STR", "3/0 AWG THHN Copper Stranded, Black", "Wire", "foot"),
    "MMM O/B+JUG Orange/Blue Performance Plus Wire Connector 500/JUG": ("CONSUM-WIRENUT-OB", "Performance Plus Wire Connector, Orange/Blue", "Consumables", "each"),
    "ELB EMT 1\" 90 Degree Elbow": ("FITT-ELBOW1-90", '1" EMT 90-Degree Elbow', "Fittings", "each"),
    "SEPCO S1115 1\" Steel SS EMT Coup": ("FITT-EMTCOUP1", '1" EMT Set-Screw Coupling', "Fittings", "each"),
    "SEPCO S1112 1\" STL SS EMT Conn": ("FITT-EMTCONN1", '1" EMT Set-Screw Connector', "Fittings", "each"),
    "STLCTY 52171-3/4 4SQ 2-1/8D Box": ("BOX-4SQ-2-1-8-34KO", '4" Square Box 2-1/8" Deep, 3/4" KO', "Boxes", "each"),
    "FLEX 3/4\" Alum UL 100' Coil": ("COND-FLEX34ALU", '3/4" Flexible Aluminum Conduit', "Conduit", "foot"),
    "SEPCO C28Z 3/4\" Die Cast Straight Squeeze Type Flex Connector": ("FITT-FLEXCONN34-STR", '3/4" Flex Connector, Straight Squeeze', "Fittings", "each"),
    "SEPCO 172C Die Cast 3/4\" EMT to 3/4\" Flex Combination Connector": ("FITT-FLEXCOMBO34", '3/4" EMT-to-Flex Combination Connector', "Fittings", "each"),
    "SEPCO 144S 1\" Steel EMT 1 Hole Straps": ("STRAP-EMT1", '1" EMT 1-Hole Strap', "Fittings", "each"),
    "WCU THHN 6 CU STR Black Master Reel": ("WIRE-THHN6-BLK-STR", "6 AWG THHN Copper Stranded, Black", "Wire", "foot"),
    "WCU THHN 6 CU STR Red Master Reel": ("WIRE-THHN6-RED-STR", "6 AWG THHN Copper Stranded, Red", "Wire", "foot"),
    "WCU THHN 8 CU STR Black Master Reel": ("WIRE-THHN8-BLK-STR", "8 AWG THHN Copper Stranded, Black", "Wire", "foot"),
    "WCU THHN 8 CU STR Red Master Reel": ("WIRE-THHN8-RED-STR", "8 AWG THHN Copper Stranded, Red", "Wire", "foot"),
    "WCU THHN 8 CU STR Green Master Reel": ("WIRE-THHN8-GRN-STR", "8 AWG THHN Copper Stranded, Green", "Wire", "foot"),
    "MULB 11433 4\" SQ 2 GFCI Cover": ("DEV-GFCICOVER-MULB", '4" Square 2-GFCI Cover Plate', "Devices", "each"),
    "MMM T/R+JUG Tan/Red Performance Plus Wire Connector 750/JUG": ("CONSUM-WIRENUT-TR", "Performance Plus Wire Connector, Tan/Red", "Consumables", "each"),
    "WAL SER 4/0-4/0-4/0-4/0-2/0 Alum 3PH Master Reel": ("WIRE-SER4444-2", "4/0-4/0-4/0-4/0-2/0 SER Aluminum 3PH Service Cable", "Wire", "foot"),
    "FLEX 1/2\" Steel UL 100' Coil": ("COND-FLEX12STL", '1/2" Flexible Steel Conduit', "Conduit", "foot"),
    "SEPCO C27Z 1/2\" Die Cast Straight Squeeze Type Flex Connector": ("FITT-FLEXCONN12-STR", '1/2" Flex Connector, Straight Squeeze', "Fittings", "each"),
    "CH BR260 60A 2P Plug-In 120/240V 10KIC Circuit Breaker": ("BRKR-BR260", "60A 2-Pole Breaker (Eaton BR260)", "Breakers", "each"),
    "CH BR240 40A 2P Plug-In 120/240V 10KIC Circuit Breaker": ("BRKR-BR240", "40A 2-Pole Breaker (Eaton BR240)", "Breakers", "each"),
    "CH BR220 20A 2P Plug-In 120/240V 10KIC Circuit Breaker": ("BRKR-BR220", "20A 2-Pole Breaker (Eaton BR220)", "Breakers", "each"),
    "CH DG221UGB 30A 2P 2W 240V Non-Fused General Duty NEMA1 Safety Switch Disconnect": ("DISC-DG221UGB", "30A 2-Pole Non-Fused Safety Switch Disconnect", "Disconnects", "each"),
    "LEV 5601-2W SP WHT 15A Decora Switch Made In USA": ("DEV-SW15-DECO", "15A Decora Switch, White", "Devices", "each"),
    "CLN B344AB 3 Gang 44 CU. IN. Blue Non-Metallic Outlet Box With Captive Nails And Bracket Support": ("BOX-3G-NONMETALLIC", "3-Gang Non-Metallic Outlet Box, 44 cu.in.", "Boxes", "each"),
    "LEV PJ263-W White 3 Gang Deco Midway Nylon Wall Plate": ("PLATE-3G-DECO", "3-Gang Decora Wall Plate White", "Devices", "each"),
    "LEV GFTR1-W 15A 125V Slim TR GFCI White": ("DEV-GFCI15", "GFCI Receptacle 15A White (Slim)", "Devices", "each"),
    "LEV T5325-W WHT NEMA5-15R Decora RCPT Made In USA Device": ("DEV-REC15-DECO", "15A Decora Receptacle White", "Devices", "each"),
    "HALO RL56069FSD2W1EWH Round 5\"/6\" Recessed LED Retrofit 5CCT Selectable 600 Lumen 120V": ("LIGHT-RECESSED-RL56069", '5"/6" Recessed LED Retrofit, Selectable CCT', "Lighting", "each"),
    "HALO RA56LS9FSD2W1EWH 5\"/6\" LED Adj White Baffle90CRI Selectable CCT": ("LIGHT-BAFFLE-RA56LS9", '5"/6" LED Adjustable Baffle Trim, White', "Lighting", "each"),
    "HALO HL4RSMF 4' HLA Round Or Square Mounting Frame": ("LIGHT-MOUNTFRAME-HL4RSMF", "Round/Square Mounting Frame", "Lighting", "each"),
    "CLN E986E-CAR 3/4\" PVC Type LB Conduit Body": ("FITT-PVCLB34", '3/4" PVC Type LB Conduit Body', "Fittings", "each"),
    "CLN E943E 3/4\" PVC Male Terminal Adapter": ("FITT-PVCADAPTER34", '3/4" PVC Male Terminal Adapter', "Fittings", "each"),
    "SEPCO 707 3/4\" Steel Locknuts": ("FITT-LOCKNUT34", '3/4" Steel Locknut', "Fittings", "each"),
    "KRY 078884 CEMC10 Pint PVC Solvent Cement Low VOC": ("CONSUM-PVCCEMENT", "PVC Solvent Cement, 1 Pint, Low VOC", "Consumables", "each"),
    "STLCTY 52151-BX 4SQ BX Box W/BRKT": ("BOX-4SQ-BX", '4" Square Box w/ Mounting Bracket', "Boxes", "each"),
    "STLCTY 52C18-5/8-25 4SQ5/8D 2G RNG": ("BOX-4SQ-2GRING", '4" Square Box 5/8" Deep, 2-Gang Ring', "Boxes", "each"),
    "ORBIT CS-CJ6 Cable Support For Stud MTG": ("FITT-CABLESUPPORT", "Cable Support Bracket, Stud-Mount", "Fittings", "each"),
    "STLCTY 52171X 4SQ 2-1/8D BX Box": ("BOX-4SQ-2-1-8-BX", '4" Square Box 2-1/8" Deep w/ Bracket', "Boxes", "each"),
    "WCU MC CU 12/4 Alum Jacket 250' Coil": ("WIRE-MC124", "12/4 MC Cable, Aluminum Jacket", "Wire", "foot"),
    "SEPCO 14CS 1-1/2\" Steel EMT/RIGID/IMC/PVC Hangers W/ Bolts": ("FITT-HANGER112", '1-1/2" Conduit Hanger w/ Bolts', "Fittings", "each"),
    "SEPCO S1115B 1-1/2\" STL SS EMT Coup": ("FITT-EMTCOUP112", '1-1/2" EMT Set-Screw Coupling', "Fittings", "each"),
    "CAD 4H24 1/8\"-1/4\" Flange 1/4\" Hole Hammer On Clip": ("FITT-HAMMERCLIP", "Hammer-On Flange Clip, 1/4\" Hole", "Fittings", "each"),
    "STLCTY 52C14-5/8 4SQ5/8D 1G RNG Made In USA": ("BOX-4SQ-1GRING", '4" Square Box 5/8" Deep, 1-Gang Ring', "Boxes", "each"),
    "CH GBKP2120 Ground Bar Kit PON Accepts 2/0": ("GRND-GBKP2120", "Ground Bar Kit, Accepts 2/0", "Grounding", "each"),
    "MET JN163 1/4-20 Hex Fin Nut": ("HW-JN163", '1/4-20 Hex Fin Nut', "Hardware", "each"),
    "CAD C23 4\" & 4-11/16 SQ Box Mounting Bracket Stud Depth 2-1/2\" & 3-1/2\" Made In USA": ("FITT-BOXBRACKET-C23", "Square Box Mounting Bracket", "Fittings", "each"),
    "VIC 10590-S 3/16 1H Midget Strap": ("FITT-MIDGETSTRAP", '3/16" 1-Hole Midget Strap', "Fittings", "each"),
    "CH CHF260 Type CHF Breaker 60A / 2P 120/240V 10KA": ("BRKR-CHF260", "60A 2-Pole CHF Breaker", "Breakers", "each"),
    "ARL 301 8/3 3/3 1-HLE SEC STRP": ("FITT-SECSTRAP", "Service Entrance Cable Strap", "Fittings", "each"),
    "SEPCO C23 3/8\" Die Cast Romex Connector": ("FITT-ROMEXCONN38", '3/8" Romex Connector', "Fittings", "each"),
    "CAD EGBA14412CC 1/4\" X 4\" X 12\" Ground Busbar": ("GRND-BUSBAR14412", 'Ground Busbar 1/4"x4"x12"', "Grounding", "each"),
    "MMM CT15BK50-C 15 IN Black Standard Cable Tie": ("CONSUM-CABLETIE15", '15" Cable Tie, Black', "Consumables", "each"),
    "ORBIT BHA-16 11\" To 18\" Adjustable Bar Hanger": ("FITT-BARHANGER16", 'Adjustable Bar Hanger, 11"-18"', "Fittings", "each"),
    "SEPCO 620 1/4\" -20 Malleable Iron Beam Clamp": ("FITT-BEAMCLAMP", "Beam Clamp, 1/4-20", "Fittings", "each"),
    "MET JRM103 1/4-20X1-1/2 Mach Scr": ("HW-JRM103", "1/4-20x1-1/2 Machine Screw", "Hardware", "each"),
    "HOFF ASG8X8X4NK Pull Box Screw Cover 8.00X8.00X4.00 Steel": ("FITT-PULLBOXCOVER884", "Pull Box Screw Cover 8x8x4 Steel", "Fittings", "each"),
    "ELB EMT 1-1/2\" 90 Degree Elbow": ("FITT-ELBOW112-90", '1-1/2" EMT 90-Degree Elbow', "Fittings", "each"),
    "SEPCO 12CS 1\" Steel EMT/RIGID/IMC/PVC Hangers W/ Bolts": ("FITT-HANGER1", '1" Conduit Hanger w/ Bolts', "Fittings", "each"),
    "SEPCO LB3A 1\" Aluminum Threaded LB Conduit Body": ("FITT-LBBODY1ALU", '1" Aluminum Threaded LB Conduit Body', "Fittings", "each"),
    "SEPCO 03 1\" Steel LB Type Cover": ("FITT-LBCOVER1", '1" Steel LB Type Cover', "Fittings", "each"),
    "SEPCO 12 1\" Neoprene LB Type Gasket": ("FITT-LBGASKET1", '1" Neoprene LB Type Gasket', "Fittings", "each"),
    "WAL XHHW 2 Alum STR Green Master Reel": ("WIRE-XHHW2-GRN", "2 AWG XHHW Aluminum Stranded, Green", "Wire", "foot"),
    "WAL XHHW 3/0 Alum STR Black Master Reel": ("WIRE-XHHW30-BLK", "3/0 AWG XHHW Aluminum Stranded, Black", "Wire", "foot"),
    "WAL XHHW 3/0 Alum STR Red Master Reel": ("WIRE-XHHW30-RED", "3/0 AWG XHHW Aluminum Stranded, Red", "Wire", "foot"),
    "WAL XHHW 3/0 Alum STR Blue Master Reel": ("WIRE-XHHW30-BLU", "3/0 AWG XHHW Aluminum Stranded, Blue", "Wire", "foot"),
    "WAL XHHW 3/0 Alum STR White Master Reel": ("WIRE-XHHW30-WHT", "3/0 AWG XHHW Aluminum Stranded, White", "Wire", "foot"),
    "CAD 615880 5/8\" X 8FT CU Ground Rod": ("GRND-ROD58-8FT", "8' Copper Ground Rod, 5/8\"", "Grounding", "each"),
    "CAD CP58 5/8\" Ground Rod Clamp": ("GRND-RODCLAMP58", '5/8" Ground Rod Clamp', "Grounding", "each"),
    "WM 880MP Nonmetallic Rectangular Floor Box": ("BOX-FLOORBOX-WM880MP", "Nonmetallic Rectangular Floor Box", "Boxes", "each"),
    "ELB EMT 2\" 45 Degree Elbow": ("FITT-ELBOW2-45", '2" EMT 45-Degree Elbow', "Fittings", "each"),
}

# invoice # -> job name (None = leave unattributed, generic ADJUST)
JOB_BY_PO = {
    "NORFOLK": "Solterra Norfolk",
    "SOLTERRA RICHMOND": "Solterra RVA",
    "SOLTERRA": "Solterra RVA",
    "SOLTERA": "Solterra RVA",
    "SOLTERRA / XXX": "Solterra RVA",
    "solterra / xxx": "Solterra RVA",
    "EITZ HEIM": "Etz Chaim",
    "LYNCHBURG": "Mainspring Lynchburg",
    "7 Church Lane": "7 Church Lane",
    "CHURCH": "7 Church Lane",
    "CHURCH LANE / XXX": "7 Church Lane",
    "7 CHURCH LN": "7 Church Lane",
    "7 CHURCH": "7 Church Lane",
    "church lane": "7 Church Lane",
    "church": "7 Church Lane",
    "ARBORWOOD": "3500 Arborwood Ct",
    "WALLIS": None,
    "WOOD CT": None,
    "WOOD COURT": None,
}


def normalize(desc: str) -> str:
    return re.sub(r"\s*\[TAGGED\]\s*", "", str(desc)).strip()


def dt(date_str: str) -> datetime:
    d = datetime.strptime(date_str, "%m/%d/%Y")
    return d.replace(hour=15)


def main() -> None:
    df = pd.read_excel(XLSX, sheet_name="Line Items")
    df = df.dropna(subset=["Invoice #"])
    df = df[~df["Invoice #"].isin(EXCLUDE_INVOICES)]

    summary = pd.read_excel(XLSX, sheet_name="Summary")
    po_by_invoice = dict(zip(summary["Invoice #"], summary["PO / Job"]))

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        shop = db.query(Location).filter(Location.type == "shop").first()
        maurice = db.query(Vendor).filter(Vendor.name == "Maurice Electrical Supply").first()

        created_items = 0
        receive_count = 0
        signout_count = 0
        adjust_count = 0
        unresolved_pos = set()

        for _, row in df.iterrows():
            invoice = row["Invoice #"]
            desc_raw = row["Description"]
            key = normalize(desc_raw)
            qty_raw = Decimal(str(row["Qty"]))
            ext_price = Decimal(str(row["Ext Price"]))
            date_str = row["Invoice Date"]
            if hasattr(date_str, "strftime"):
                date_str = date_str.strftime("%m/%d/%Y")

            if key in EXISTING_MATCHES:
                sku = EXISTING_MATCHES[key]
                item = db.query(Item).filter(Item.sku == sku).first()
                final_qty = qty_raw
            elif key in STICK_ITEMS:
                sku, name, category = STICK_ITEMS[key]
                item = db.query(Item).filter(Item.sku == sku).first()
                if not item:
                    item = Item(sku=sku, barcode=sku, name=name, description=key,
                                category=category, unit="each", active=True)
                    db.add(item)
                    db.flush()
                    created_items += 1
                final_qty = (qty_raw / Decimal("10")).quantize(Decimal("1"))
            elif key in NEW_CATALOG:
                sku, name, category, unit = NEW_CATALOG[key]
                item = db.query(Item).filter(Item.sku == sku).first()
                if not item:
                    item = Item(sku=sku, barcode=sku, name=name, description=key,
                                category=category, unit=unit, active=True)
                    db.add(item)
                    db.flush()
                    created_items += 1
                final_qty = qty_raw
            else:
                raise SystemExit(f"UNMAPPED description: {key!r} (invoice {invoice})")

            unit_cost = (ext_price / final_qty).quantize(Decimal("0.0001")) if final_qty else Decimal("0")

            po = po_by_invoice.get(invoice)
            po_clean = str(po).strip() if pd.notna(po) else None

            txn = apply_transaction(
                db, type="RECEIVE", item_id=item.id, qty=final_qty, user=admin,
                vendor_id=maurice.id, unit_cost=unit_cost, to_location_id=shop.id,
                ref=invoice, note=f"PO: {po_clean}" if po_clean else "No PO on invoice",
            )
            when = dt(date_str)
            txn.created_at = when
            txn.updated_at = when
            receive_count += 1

            job_name = JOB_BY_PO.get(po_clean) if po_clean else None
            if job_name:
                job = db.query(Job).filter(Job.name == job_name).first()
                s_txn = apply_transaction(
                    db, type="SIGN_OUT", item_id=item.id, qty=final_qty, user=admin,
                    from_location_id=shop.id, job_id=job.id, ref=invoice, note=f"PO: {po_clean}",
                )
                s_txn.created_at = when
                s_txn.updated_at = when
                signout_count += 1
            else:
                if po_clean:
                    unresolved_pos.add(po_clean)
                a_txn = apply_transaction(
                    db, type="ADJUST", item_id=item.id, qty=final_qty, user=admin,
                    from_location_id=shop.id, reason="other",
                    note=f"Maurice doesn't sell in bulk -- not warehoused. PO on invoice: {po_clean or '(none)'}",
                )
                a_txn.created_at = when
                a_txn.updated_at = when
                adjust_count += 1

            db.commit()

        print(f"Created {created_items} new items")
        print(f"RECEIVE: {receive_count}, SIGN_OUT: {signout_count}, unresolved ADJUST: {adjust_count}")
        print(f"Unresolved PO values (no matching job): {sorted(unresolved_pos)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
