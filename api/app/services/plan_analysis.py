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

import anthropic

from app.config import settings

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
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
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
