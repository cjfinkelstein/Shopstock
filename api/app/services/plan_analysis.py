"""Reads an uploaded plan sheet PDF with Claude's vision and drafts a scope
of work matching the estimate wizard's checklist sections -- so the wizard
can be pre-checked for review instead of walked by hand.

Deliberately honest about what a plan sheet can and can't tell you: an
architectural floor plan has no outlet/switch/light symbols on it, so a
"scope" drafted from one alone is a guess by room type, not a real count.
The model is asked to say so via `sheet_type`/`confidence_note` rather than
silently presenting a guess as a reading."""

import base64
import json

from app.services.anthropic_client import get_anthropic_client

SECTIONS = [
    "Rough-In Electrical Work",
    "Supply and Install",
    "Install Customer-Supplied Fixtures",
    "Panels and Meters",
    "Permits, Inspection & Finalization",
]

# Mirrors web/src/pages/admin/EstimateWizard.tsx WIZARD_STEPS -- kept in sync
# by hand. Only used to steer the model toward reusing exact existing labels
# (so the frontend can pre-check a real checkbox instead of always falling
# back to a custom item); it is not the source of truth for the wizard UI.
KNOWN_ITEMS_BY_SECTION = {
    "Rough-In Electrical Work": [
        "Recessed Lights", "Chandeliers", "Pendant Lights", "Exterior Light", "Exterior Floodlights",
        "Basement Lights", "Crawl Space Lights", "Vanity Lights", "Exhaust Fans", "Reading Lights",
        "Tub Pendant", "Ceiling Fans", "Closet Lights", "Combination CO/Smoke Detectors",
        "Smoke Detectors", "Under Cabinet Lights", "Baseboard Heaters", "Wall Sconces",
        "Emergency Lights", "EXIT Lights", "Combo EXIT/Emergency Lights", "2x2 Lights", "2x4 Lights",
        "Single-Pole Toggle Switches", "Three-Way Toggle Switches", "Four-Way Toggle Switches",
        "Dimmer Switches", "Occupancy Sensor Switches", "Duplex Outlets", "Quad Outlets", "GFCI Outlet",
        "Waterproof GFCI Outlet", "Dishwasher Outlet", "Disposal Outlet", "Microwave Outlet",
        "Oven/Range Outlet", "Refrigerator Outlet", "Washer Outlet", "Dryer Outlet",
        "Garage Door Opener Outlet", "TV Outlet", "Data Outlet (CAT5e)", "Thermostat",
        "New HVAC Indoor & Outdoor Unit", "New Kitchen Hood", "New Water Heater", "Sump Pump",
    ],
    "Supply and Install": [
        'New 6" Recessed Lights', "Single-Pole Toggle Switches", "Three-Way Toggle Switches",
        "Four-Way Toggle Switches", "Dimmer Switches", "Duplex Outlets", "Quad Outlets", "GFCI Outlets",
        "Waterproof GFCI Outlets", "Unbreakable Nylon Cover Plates", "Combination CO/Smoke Detectors",
        "Smoke Detectors", "Wall Sconces", "Emergency Lights", "EXIT Lights",
    ],
    "Install Customer-Supplied Fixtures": [
        "Chandeliers", "Pendant Lights", "Linear Closet Lights", "Basement Lights", "Exterior Lights",
        "Ceiling Fans", "Vanity Lights", "Reading Lights", "Pantry Lights", "Under Cabinet Lights",
        "Baseboard Heaters", "Wall Sconces",
    ],
    "Panels and Meters": [
        "Mount and wire new exterior 200A main disconnect",
        "Install 200A SER cable from the exterior disconnect to the new panel in the basement",
        "Install new 200A main panel and breakers",
        "Relocate existing panel", "Install new meter cabinet or meter stack", "Install new breakers",
        "Ground Rods", "Ground Clamps", "Acorns", "Bare Ground Wire",
        "Relocate existing circuits from old panel to new",
    ],
    "Permits, Inspection & Finalization": [
        "Pull required electrical permits", "Coordinate all inspections",
        "Clean up and clearly label all new equipment",
    ],
}

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "sheet_type": {
            "type": "string",
            "enum": ["electrical", "architectural_only", "mixed"],
        },
        "confidence_note": {
            "type": "string",
            "description": (
                "One or two plain-language sentences for a non-technical contractor: what was "
                "and wasn't visible on the sheet, and how much to trust these quantities."
            ),
        },
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "section": {"type": "string", "enum": SECTIONS},
                    "label": {"type": "string"},
                    "qty": {"type": "number"},
                },
                "required": ["section", "label", "qty"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sheet_type", "confidence_note", "items"],
    "additionalProperties": False,
}


def _build_prompt() -> str:
    catalog = "\n".join(
        f"- {section}: " + ", ".join(items)
        for section, items in KNOWN_ITEMS_BY_SECTION.items()
    )
    return f"""You are helping an electrical contractor turn a plan sheet into a draft scope of work.

First, decide what kind of sheet this is:
- "electrical": it has outlet/switch/light/panel symbols and (usually) a legend -- you can count actual specified fixtures.
- "architectural_only": it's a floor plan (room layout, dimensions, doors, windows) with NO electrical symbols or legend visible.
- "mixed": some pages have electrical symbols, some don't.

Then draft a list of scope-of-work line items with quantities.

- If the sheet is "electrical" or "mixed": count the actual symbols against the legend. Report real quantities you can point to on the page.
- If the sheet is "architectural_only": do NOT invent fixture counts from room type alone -- that isn't a reading, it's a guess, and presenting it as a real count would be misleading. Instead return an empty (or near-empty) items list, and use confidence_note to say plainly that no electrical symbols were visible and the sheet is architectural only.

For every item, use the EXACT label text below when it matches one of these known checklist items (so it can be pre-checked automatically instead of added as a new custom item). If nothing matches, write a short, clear label of your own instead of forcing a bad fit.

Known checklist items by section:
{catalog}

Only use these five section names: {", ".join(SECTIONS)}.

confidence_note should be plain, non-technical language a contractor (not an engineer) can act on -- what you could and couldn't see, and how much to double-check before quoting a customer from this."""


def analyze_plan_sheet(pdf_base64: str) -> dict:
    client = get_anthropic_client()
    response = client.messages.create(
        model="claude-opus-5",
        max_tokens=8000,
        output_config={"format": {"type": "json_schema", "schema": _RESPONSE_SCHEMA}},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_base64,
                        },
                    },
                    {"type": "text", "text": _build_prompt()},
                ],
            }
        ],
    )

    if response.stop_reason == "refusal":
        raise RuntimeError("The AI declined to read this file")

    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        raise RuntimeError("No response from the AI")
    return json.loads(text)


def decode_pdf_data_url(data_url: str) -> bytes:
    """Strips the `data:application/pdf;base64,` prefix and decodes."""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    return base64.b64decode(data_url)


_MARKER_TYPES = ["duplex", "gfci", "light", "fan", "exfan", "switch", "smoke", "co_smoke", "panel"]

_MARKER_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "confidence_note": {
            "type": "string",
            "description": (
                "One or two plain-language sentences for a non-technical contractor: that "
                "this is a code-minimum SUGGESTED layout (not a real symbol count, since "
                "architectural plans don't show outlets/switches/lights), and to review "
                "placement before pricing a job from it."
            ),
        },
        "markers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "page": {"type": "integer", "description": "1-indexed page number this marker belongs to"},
                    "type": {"type": "string", "enum": _MARKER_TYPES},
                    "label": {"type": "string", "description": "short description including the room"},
                    "qty": {"type": "number"},
                    "x": {"type": "number", "description": "percent (0-100) from the left edge of that page"},
                    "y": {"type": "number", "description": "percent (0-100) from the top edge of that page"},
                },
                "required": ["page", "type", "label", "qty", "x", "y"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["confidence_note", "markers"],
    "additionalProperties": False,
}

_MARKER_PROMPT = """You are helping an electrical contractor mark up a residential architectural \
plan with a code-minimum electrical layout -- this plan shows room layout and dimensions only, \
with no electrical symbols or legend, so you are proposing typical IRC/NEC residential rough-in \
coverage per room, not reading real fixture counts.

For every page that is a floor plan (skip cover sheets, schedules, sections, and detail pages -- \
return no markers for those), identify each room and propose, following these exact rules:

- Smoke detectors (type "smoke"): one plain smoke detector in each bedroom only -- not every room.
- Combo CO/smoke detectors (type "co_smoke"): one in each hallway outside the sleeping areas, kept \
as a SEPARATE marker type from plain smoke detectors -- never combine the two into one marker or \
count.
- Duplex outlets (type "duplex"): at least one outlet on every wall of the room long enough to \
reasonably hold one (skip a wall that's mostly a doorway/closet opening with no real wall space). \
Do NOT calculate exact spacing or add more than one per wall for an ordinary-sized wall -- this is \
wall coverage, not a spacing calculation, so a typical room ends up with roughly one outlet per \
wall, not a dense row along each one.
- GFCI outlets (type "gfci"), kept as a SEPARATE marker type from duplex outlets -- never combine \
the two: in wet areas (kitchen, bathroom, laundry, garage, exterior) use GFCI instead of duplex, \
same one-per-wall coverage as above.
- Lighting (type "light"): one switched light fixture for every room/hallway/stairway.
- Bedrooms: one ceiling fan (type "fan") AND one light (type "light") in every bedroom as separate \
markers, except the master bedroom, which gets 3 lights instead of one.
- Exhaust fans (type "exfan"), kept as a SEPARATE marker type from the ceiling fans used in \
bedrooms: in bathrooms without a window.
- Switches (type "switch"): one for each fixture placed (lights, fans, exhaust fans).
- Panels/equipment (type "panel"): any visible panel/meter/equipment (water heater, HVAC, sump \
pump, garage door opener).

This is a light, code-minimum STARTING POINT the admin edits by hand -- when in doubt, place fewer \
markers rather than more. Outlets are placed individually, one marker per wall (so each pin sits on \
the actual wall it covers), not grouped into a single qty -- group every OTHER repeated type in a \
room into a single marker with the right qty instead (e.g. one marker "1 light, living room" with \
qty 1) rather than one marker per physical unit.

Placement accuracy matters as much as the counts -- a pin in the wrong room is as wrong as a \
missing one. For every marker:
- Look at that page's actual image and find the real room boundaries (the wall lines) before \
picking x/y -- don't estimate from the room list or guess a generic layout.
- x/y must land INSIDE the room the marker is labeled for, never in an adjoining room, a hallway, \
on top of a wall line, or outside the building's outline.
- For an outlet or switch, place it just inside the room against a wall (not the room's center).
- For a ceiling item (light, fan, smoke/co_smoke detector), place it near the center of the room \
or hallway it covers.
- For a panel/equipment marker, place it at or next to the actual symbol/callout for that \
equipment if the plan shows one, otherwise at the room/location named for it (e.g. the garage, \
the utility room).
- Double check each page's x/y values before finishing: the markers for a room should visually \
cluster inside that room's drawn outline, not be smeared across the page.

Place x/y reading the room's position directly from that page's own image (0,0 is that page's \
top-left corner, 100,100 its bottom-right)."""


def propose_plan_markers(pdf_base64: str) -> dict:
    """Vision call that reads a full plan PDF and proposes a code-minimum
    electrical symbol layout per page -- see analyze_plan_sheet's module
    docstring for why this is framed as a suggestion, not a reading: an
    architectural plan has no electrical symbols to actually count."""
    client = get_anthropic_client()
    # Streaming (required by the SDK above a 10-minute estimated response
    # time, which a 32000-token max_tokens can trigger even when the actual
    # response is much shorter) -- .get_final_message() blocks and returns
    # the same Message shape messages.create() would have.
    with client.messages.stream(
        model="claude-opus-5",
        # A full multi-page house plan can need hundreds of markers under
        # the wall-coverage/spacing rules above -- 8000 was enough for a
        # handful of pages but silently truncated (no text block at all) on
        # a bigger one, like a 14-page set. 32000 gives real headroom.
        max_tokens=32000,
        output_config={"format": {"type": "json_schema", "schema": _MARKER_RESPONSE_SCHEMA}},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_base64},
                    },
                    {"type": "text", "text": _MARKER_PROMPT},
                ],
            }
        ],
    ) as stream:
        response = stream.get_final_message()

    if response.stop_reason == "refusal":
        raise RuntimeError("The AI declined to read this file")
    if response.stop_reason == "max_tokens":
        raise RuntimeError(
            "This plan needed more symbols than we could read in one pass -- try splitting it into "
            "smaller uploads (fewer pages at a time) and running this again on each."
        )

    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        raise RuntimeError(f"No response from the AI (stop reason: {response.stop_reason})")
    return json.loads(text)
