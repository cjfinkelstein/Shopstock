import { useEffect, useRef, useState } from "react";

import { api } from "../../api";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { ChecklistItem, Estimate, PlanAnalyzeResult } from "../../types";

/** Checklists lifted straight from "APEX Estimating Spreadsheet 2026" --
 * same section names, same intro sentences, same fixture lists, in the same
 * order, so this wizard walks through an estimate exactly the way the real
 * template does instead of asking for free-text scope of work. */
interface Group {
  intro: string | null;
  items: string[];
}
interface WizardStep {
  section: string;
  groups: Group[];
  defaultMaterial: string;
  defaultLabor: string;
}

const WIZARD_STEPS: WizardStep[] = [
  {
    section: "Rough-In Electrical Work",
    // Real completed jobs (Zakem Basement's actual invoice, not a draft)
    // priced rough-in material at $20-25/unit, not $15 -- bumped to match.
    defaultMaterial: "20",
    defaultLabor: "35",
    groups: [
      {
        intro: "Provide rough-in wiring for the following fixtures:",
        items: [
          "Recessed Lights", "Chandeliers", "Pendant Lights", "Exterior Light", "Exterior Floodlights",
          "Basement Lights", "Crawl Space Lights", "Vanity Lights", "Exhaust Fans", "Reading Lights",
          "Tub Pendant", "Ceiling Fans", "Closet Lights", "Combination CO/Smoke Detectors",
          "Smoke Detectors", "Under Cabinet Lights", "Baseboard Heaters", "Wall Sconces",
          "Emergency Lights", "EXIT Lights", "Combo EXIT/Emergency Lights", "2x2 Lights", "2x4 Lights",
        ],
      },
      {
        intro: "Provide rough-in wiring for the following switches and outlets:",
        items: [
          "Single-Pole Toggle Switches", "Three-Way Toggle Switches", "Four-Way Toggle Switches",
          "Dimmer Switches", "Occupancy Sensor Switches", "Duplex Outlets", "Quad Outlets", "GFCI Outlet",
          "Waterproof GFCI Outlet", "Dishwasher Outlet", "Disposal Outlet", "Microwave Outlet",
          "Oven/Range Outlet", "Refrigerator Outlet", "Washer Outlet", "Dryer Outlet",
          "Garage Door Opener Outlet", "TV Outlet", "Data Outlet (CAT5e)", "Thermostat",
        ],
      },
      {
        intro: "Provide rough-in wiring for:",
        items: ["New HVAC Indoor & Outdoor Unit", "New Kitchen Hood", "New Water Heater", "Sump Pump"],
      },
    ],
  },
  {
    section: "Supply and Install",
    // This is the phase where the actual device gets bought, so it should
    // carry the biggest material cost of anywhere in the estimate -- $25 is
    // a rough placeholder (real devices in past jobs ranged $6-$75) since a
    // generic checklist label like "Duplex Outlets" has no specific catalog
    // SKU behind it to pull a real cost from.
    defaultMaterial: "25",
    defaultLabor: "40",
    groups: [
      {
        intro: "Supply and install the following fixtures:",
        items: [
          'New 6" Recessed Lights', "Combination CO/Smoke Detectors", "Smoke Detectors", "Wall Sconces",
          "Emergency Lights", "EXIT Lights", "Chandeliers", "Pendant Lights", "Exterior Light",
          "Exterior Floodlights", "Basement Lights", "Crawl Space Lights", "Vanity Lights", "Exhaust Fans",
          "Reading Lights", "Tub Pendant", "Ceiling Fans", "Closet Lights", "Under Cabinet Lights",
          "Baseboard Heaters", "Combo EXIT/Emergency Lights", "2x2 Lights", "2x4 Lights",
          "Flush Mount Ceiling Lights", "Track Lighting", "Landscape Lighting", "Motion Sensor Lights",
          "Security Flood Lights", "Bathroom Fan/Light Combo", "Under-Stair Lights", "Strip/Rope Lighting",
          "Mirror Lights",
        ],
      },
      {
        intro: "Supply and install the following switches and outlets:",
        items: [
          "Single-Pole Toggle Switches", "Three-Way Toggle Switches", "Four-Way Toggle Switches",
          "Dimmer Switches", "Duplex Outlets", "Quad Outlets", "GFCI Outlets", "Waterproof GFCI Outlets",
          "Unbreakable Nylon Cover Plates", "Occupancy Sensor Switches", "Dishwasher Outlet",
          "Disposal Outlet", "Microwave Outlet", "Oven/Range Outlet", "Refrigerator Outlet",
          "Washer Outlet", "Dryer Outlet", "Garage Door Opener Outlet", "TV Outlet",
          "Data Outlet (CAT5e)", "Thermostat", "AFCI Outlets", "USB Outlets", "Smart Switches",
          "Smart Outlets", "Timer Switches", "Photocell (Dusk-to-Dawn) Switches", "220V/240V Outlets",
          "Floor Outlets", "Weatherproof In-Use Covers", "Combination Switch/Outlet",
        ],
      },
      {
        intro: "Supply and install the following wiring and materials:",
        items: [
          "Romex/NM Cable", "THHN Wire", "EMT Conduit", "PVC Conduit", "Flexible Conduit (Sealtite)",
          "Armored Cable (MC/BX)", "Wire Nuts", "Junction Boxes", "Device/Outlet Boxes", "Cable Staples",
          "Electrical Tape",
        ],
      },
      {
        intro: "Supply and install:",
        items: ["New HVAC Indoor & Outdoor Unit", "New Kitchen Hood", "New Water Heater", "Sump Pump"],
      },
    ],
  },
  {
    section: "Install Customer-Supplied Fixtures",
    // The customer buys the fixture itself, but hooking it up still takes
    // real labor and a bit of incidental material (wire nuts, mounting
    // hardware) -- Zakem Basement's real invoice priced this at $15/$40,
    // not $0/$0.
    defaultMaterial: "15",
    defaultLabor: "40",
    groups: [
      {
        intro: "Install the following customer-supplied fixtures:",
        items: [
          "Chandeliers", "Pendant Lights", "Linear Closet Lights", "Basement Lights", "Exterior Lights",
          "Ceiling Fans", "Vanity Lights", "Reading Lights", "Pantry Lights", "Under Cabinet Lights",
          "Baseboard Heaters", "Wall Sconces",
        ],
      },
    ],
  },
  {
    section: "Panels and Meters",
    // Real Zakem Basement invoice line items ranged from $2/$50 (bare ground
    // wire) to $500/$300 (relocating the panel) -- $0/$0 understated every
    // one of them. These are the average of that invoice's six panel-work
    // lines, still just a starting point to adjust per line.
    defaultMaterial: "50",
    defaultLabor: "75",
    groups: [
      {
        intro: null,
        items: [
          "Mount and wire new exterior 200A main disconnect",
          "Install 200A SER cable from the exterior disconnect to the new panel in the basement",
          "Install new 200A main panel and breakers",
          "Relocate existing panel",
          "Install new meter cabinet or meter stack",
          "Install new disconnect and label",
          "Install new breakers",
          "Install new AFCI breakers",
          "Ground Rods",
          "Ground Clamps",
          "Acorns",
          "Bare Ground Wire",
          "Relocate existing circuits from old panel to new",
          "Load Side Service Wire",
          "Surge Protector",
        ],
      },
    ],
  },
  {
    section: "Permits, Inspection & Finalization",
    // Flat $150 permit fee -- no separate labor component.
    defaultMaterial: "150",
    defaultLabor: "0",
    groups: [
      {
        intro: null,
        items: ["Pull required electrical permits", "Coordinate all inspections", "Clean up and clearly label all new equipment"],
      },
    ],
  },
];

// Commercial checklist -- built from two real completed commercial jobs
// (3509 Eastern Ave and Mainspring Harrisonburg), which turned out to agree
// with each other on almost everything they both cover (breakers, the 200A
// 3-phase panel, cover plates, GFCI/duplex outlet installs). Where they
// disagreed, Mainspring (the newer, more detailed, internally-consistent
// spreadsheet) was treated as first choice -- see ITEM_COST_OVERRIDES below
// for the specific per-item sourcing. Almost every item here has its own
// real price, so these steps carry no meaningful flat default ($0/$0) --
// everything real lives in the "Commercial ..." sections of
// ITEM_COST_OVERRIDES.
const COMMERCIAL_STEPS: WizardStep[] = [
  {
    section: "Commercial Rough-In",
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: "Rough-in wiring for the following switches:",
        items: ["Push Button Switch (Standard)", "Push Button Switch (Basic)", "Toggle Switch", "Occupancy Sensor Switch"],
      },
      {
        intro: "Rough-in wiring for the following outlets:",
        items: [
          "Duplex Outlet", "Duplex Outlet w/ Plug-Load Control", "Quad Outlet", "Quad Outlet w/ Plug-Load Control",
          "GFCI Outlet", "Weatherproof GFCI Outlet", "Specialty Outlet", "Sign Receptacle",
        ],
      },
      {
        intro: "Rough-in wiring for the following lighting:",
        items: [
          "Recessed Light (4\")", "Recessed Light w/ Battery Backup", "2x2 Light", "2x2 Light w/ Battery Backup",
          "LED Pendant Light", "LED Pendant Light w/ Battery Backup", "Exterior Wall Sconce w/ Battery Backup",
          "Exterior Recessed Light", "Exterior Recessed Light w/ Battery Backup", "EXIT Sign (Single-Sided)",
          "EXIT Sign (Double-Sided)",
        ],
      },
      {
        intro: "Rough-in wiring for the following equipment:",
        items: [
          "Air Handler", "Condenser", "Rooftop Unit", "Exhaust Fan", "Water Heater", "Motorized Damper",
          "Fire Alarm Control Panel", "Circulator Pump",
        ],
      },
      {
        intro: "Data rough-in (final termination by others):",
        items: ["Data Outlet"],
      },
    ],
  },
  {
    section: "Commercial Outlet Installation",
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: "Supply and install:",
        items: [
          "Duplex Outlet", "Duplex Outlet w/ Plug-Load Control", "Quad Outlet", "Quad Outlet w/ Plug-Load Control",
          "GFCI Outlet", "Weatherproof GFCI Outlet", "Specialty Outlet", "Sign Receptacle",
          "Unbreakable Nylon Cover Plate",
        ],
      },
    ],
  },
  {
    section: "Commercial Switch Installation",
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: "Supply and install:",
        items: [
          "Push Button Switch (Standard)", "Push Button Switch (Basic)", "Toggle Switch", "Occupancy Sensor Switch",
          "Unbreakable Nylon Cover Plate",
        ],
      },
    ],
  },
  {
    section: "Commercial Lighting Installation",
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: "Supply and install:",
        items: [
          "Recessed Light (4\")", "Recessed Light w/ Battery Backup", "2x2 Light", "2x2 Light w/ Battery Backup",
          "LED Pendant Light", "LED Pendant Light w/ Battery Backup", "Exterior Wall Sconce w/ Battery Backup",
          "Exterior Recessed Light", "Exterior Recessed Light w/ Battery Backup", "EXIT Sign (Single-Sided)",
          "EXIT Sign (Double-Sided)", "Exhaust Fan", "Emergency Light", "Combo EXIT/Emergency Light",
          "Ceiling Mounted Occupancy Sensor",
        ],
      },
    ],
  },
  {
    section: "Commercial Data Installation",
    // Final rack terminations by others.
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: "Supply and install:",
        items: ["Tombstone Jack", "Unbreakable Nylon Cover Plate"],
      },
    ],
  },
  {
    section: "Commercial Disconnects",
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: "Supply and install non-fused disconnects for:",
        items: ["Equipment Disconnect (Air Handler, Condenser, Water Heater, etc.)"],
      },
    ],
  },
  {
    section: "Commercial Panels and Meters",
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: "Supply and install:",
        items: [
          "New Enclosed Circuit Breaker", "New CT Cabinet", "New 800A 3-Phase Panel", "New 200A 3-Phase Panel",
          "New 125A 3-Phase Panel", "Ground Rods and Clamps", "SER Cable (4/0-4/0-4/0-4)",
        ],
      },
      {
        intro: "Conduit and wire:",
        items: [
          "EMT Conduit (3\")", "EMT Conduit (2\")", "EMT Conduit (1-1/2\")", "600 KCM Wire", "600 KCM Neutral Wire",
          "1/0 AWG Ground Wire", "3/0 AWG Wire", "3/0 AWG Neutral Wire", "#6 AWG Ground Wire", "#4 AWG THHN Wire",
          "#1 AWG Wire", "#1 AWG Neutral Wire",
        ],
      },
    ],
  },
  {
    section: "Commercial Circuit Breakers",
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: "Supply and install:",
        items: [
          "20A Single-Pole Breaker", "20A Single-Pole GFCI Breaker", "20A 2-Pole Breaker", "20A 3-Pole Breaker",
          "25A 2-Pole Breaker", "30A 2-Pole Breaker", "45A 2-Pole Breaker", "50A 2-Pole Breaker",
          "60A 2-Pole Breaker", "125A 3-Pole Breaker", "200A 3-Pole Breaker",
        ],
      },
    ],
  },
  {
    section: "Commercial Permits, Inspection & Finalization",
    defaultMaterial: "0",
    defaultLabor: "0",
    groups: [
      {
        intro: null,
        items: ["Pull required electrical permits", "Coordinate all inspections", "Clean up and clearly label all new equipment"],
      },
    ],
  },
];

// Sections the wizard doesn't ask about but which still get created empty,
// so a wizard-built estimate looks the same shape as every other estimate.
const SILENT_SECTIONS = ["Demolition", "Miscellaneous"];

type Selections = Record<string, { checked: boolean; qty: string }>;
type CustomItem = { id: number; name: string; qty: string };

// "saved" is a reserved group id for the dynamically-fetched "previously
// added" checklist group, kept distinct from the hardcoded groups' numeric
// indices so the two never collide.
const key = (stepIdx: number, groupId: number | "saved", item: string) => `${stepIdx}-${groupId}-${item}`;
let nextCustomId = 1;

const PANELS_STEP_IDX = WIZARD_STEPS.findIndex((s) => s.section === "Panels and Meters");
const BREAKER_ITEM = "Install new breakers";
// Checking a new panel or a service upgrade almost always means new breakers
// too -- prompt for the count right there instead of making it a separate
// item to remember to check further down the same list.
const BREAKER_PROMPT_TRIGGERS = [
  "Install new 200A main panel and breakers",
  "Mount and wire new exterior 200A main disconnect",
];

// Per-item cost overrides for items whose real price doesn't match the
// step's default -- checked at estimate-build time. Keyed by step section
// first, then item label: several labels (switches, outlets) appear
// verbatim in BOTH Rough-In and Supply and Install, and those two steps
// price the exact same label very differently (rough-in labor vs. the
// actual retail device) -- a flat item-label map would leak one step's
// price into the other, which is exactly the bug this structure prevents.
const ITEM_COST_OVERRIDES: Record<string, Record<string, { material: string; labor: string }>> = {
  "Panels and Meters": {
    // Real price: $900 materials, $1,500 charged (mat + labor here) -- CJ's
    // numbers, for panel+breakers as ONE combined line. UNRESOLVED: the
    // 2707 Maurleen Ct (Gluck) spreadsheet prices the panel alone at $750,
    // with breakers separate -- not an apples-to-apples comparison with this
    // combined number, so left as-is until CJ says otherwise.
    "Install new 200A main panel and breakers": { material: "900", labor: "600" },
    // Regular breakers -- originally $50/$40 from CJ directly, but the Gluck
    // (2707 Maurleen Ct) AND Leshnoff Townhomes spreadsheets both
    // independently show $100 material/$25 labor -- two real jobs agreeing
    // over one recalled number, so updated to match.
    "Install new breakers": { material: "100", labor: "25" },
    "Install new AFCI breakers": { material: "100", labor: "40" },
    // No flat price makes sense here -- BGE decides what the service upgrade
    // actually requires, so this is $0/$0 by default and needs a real number
    // filled in per job instead of silently under-pricing at $50/$75.
    "Mount and wire new exterior 200A main disconnect": { material: "0", labor: "0" },
    // Real prices from the Zakem Basement spreadsheet (CJ's own real job
    // costing document) -- first-choice source, applied directly.
    "Relocate existing panel": { material: "500", labor: "300" },
    "Ground Clamps": { material: "10", labor: "25" },
    "Acorns": { material: "5", labor: "25" },
    // The spreadsheet's "Bare #6" row had qty x unit cost not matching the
    // total shown -- CJ confirmed the unit price cells are the real number.
    "Bare Ground Wire": { material: "2", labor: "50" },
    // The spreadsheet's totals didn't match its own qty x unit cost either --
    // CJ confirmed the totals are correct here, so unit price = total / qty
    // (30 units): $750/30 material, $400/30 labor.
    "Relocate existing circuits from old panel to new": { material: "25.00", labor: "13.33" },
    // From the Gluck (2707 Maurleen Ct) spreadsheet -- CJ confirmed to use it.
    "Ground Rods": { material: "30", labor: "50" },
    // New item, not in the checklist before -- Gluck's unit price (qty 30 @
    // $7 material matches the $210 total; the $50 labor unit is the real
    // number even though that row's own labor TOTAL didn't multiply out,
    // same pattern as the Bare Ground Wire row above).
    "Load Side Service Wire": { material: "7", labor: "50" },
    // New item, not in the checklist before -- Gluck listed this twice, once
    // with labor left blank (an unfinished entry) and once complete at $100
    // material/$50 labor; using the complete row.
    "Surge Protector": { material: "100", labor: "50" },
    // Real price -- had no override before (step default $50/$75 was used).
    "Install new meter cabinet or meter stack": { material: "100", labor: "100" },
    // New item -- Gluck AND Leshnoff both price this at $250/$250, but it's
    // unclear whether this is the same thing as the BGE-variable exterior
    // disconnect above or a distinct interior one -- added as its own line
    // rather than merged into that one, since CJ hasn't confirmed either way.
    "Install new disconnect and label": { material: "250", labor: "250" },
  },
  // The Zakem Basement spreadsheet -- CJ's own real job-costing document --
  // priced rough-in per item, not flat like the app's default assumed.
  // Only items that differ from the $20/$35 default are listed here; the
  // switches/outlets that matched it exactly ($20/$35) needed no entry.
  "Rough-In Electrical Work": {
    "Recessed Lights": { material: "25", labor: "35" },
    "Baseboard Heaters": { material: "25", labor: "35" },
    "Thermostat": { material: "25", labor: "35" },
    "Vanity Lights": { material: "25", labor: "35" },
    "Exterior Light": { material: "25", labor: "35" },
    "Exhaust Fans": { material: "25", labor: "35" },
    "Smoke Detectors": { material: "25", labor: "35" },
    "Washer Outlet": { material: "25", labor: "35" },
    "Combination CO/Smoke Detectors": { material: "30", labor: "35" },
  },
  "Supply and Install": {
  // Real per-device material cost from the parts inventory (labor stays the
  // $40 flat rate the real Zakem invoice used for every Supply and Install
  // line, regardless of device). Only devices this business actually stocks
  // a SKU for get a real number here -- everything else in Supply and
  // Install has no real cost behind it yet and stays at the step default.
  // NOTE: several of these (marked below) were superseded by the Zakem
  // Basement spreadsheet, CJ's first-choice real source -- the spreadsheet
  // numbers win where the two disagree.
  "Single-Pole Toggle Switches": { material: "7.00", labor: "40" }, // was $2.00 (inventory) -- spreadsheet wins
  "Three-Way Toggle Switches": { material: "10.00", labor: "40" }, // was $3.25 (inventory) -- spreadsheet wins
  "Duplex Outlets": { material: "5.00", labor: "40" }, // was $2.48 (inventory) -- spreadsheet wins
  "GFCI Outlets": { material: "35.00", labor: "40" }, // was $20.04 (inventory) -- spreadsheet wins
  "Dimmer Switches": { material: "32.00", labor: "40" },
  'New 6" Recessed Lights': { material: "30.00", labor: "40" }, // was $25.74 (real invoice) -- spreadsheet wins
  "Smoke Detectors": { material: "50.00", labor: "40" }, // was $32.74 (Home Depot) -- spreadsheet wins
  "Combination CO/Smoke Detectors": { material: "75.00", labor: "40" }, // was $80.47 (Home Depot) -- spreadsheet wins
  "Exhaust Fans": { material: "40", labor: "50" }, // Gluck (2707 Maurleen Ct) spreadsheet -- was $150/$40 (Zakem)
  // GFCI Receptacle ($20.04) + Weatherproof In-Use Cover ($8.91) -- the two
  // real inventory SKUs that together make a complete waterproof GFCI.
  "Waterproof GFCI Outlets": { material: "28.95", labor: "40" },
  // Ceiling PIR Occupancy Sensor ($69.00) + its Power Pack ($42.00) -- both
  // are required together for a real occupancy-sensor switch install.
  "Occupancy Sensor Switches": { material: "111.00", labor: "40" },
  // Wire Nuts (below, in the wiring group) uses the same real per-unit
  // inventory cost as the Performance Plus wire connector actually stocked.
  "Wire Nuts": { material: "0.16", labor: "40" },

  // Everything below: no real invoice or inventory cost existed, so these
  // are real homedepot.com prices (checked on the date this was written)
  // plus a flat 15% markup, then rounded UP to the nearest $5 -- CJ's
  // numbers, applied uniformly. Labor stays at Supply and Install's own $40
  // default throughout -- this pass only touches material.
  "Wall Sconces": { material: "25", labor: "40" }, // $21.82 rounded up
  "Emergency Lights": { material: "45", labor: "40" }, // $40.22 rounded up
  "EXIT Lights": { material: "45", labor: "40" }, // $40.22 rounded up
  "Chandeliers": { material: "90", labor: "40" }, // $89.70 rounded up
  "Pendant Lights": { material: "20", labor: "40" }, // $16.15 rounded up
  "Exterior Light": { material: "40", labor: "40" }, // $36.79 rounded up
  "Exterior Floodlights": { material: "60", labor: "40" }, // $55.17 rounded up
  "Basement Lights": { material: "10", labor: "40" }, // $9.17 rounded up
  "Crawl Space Lights": { material: "10", labor: "40" }, // $7.57 rounded up
  "Vanity Lights": { material: "70", labor: "40" }, // $68.97 rounded up
  "Reading Lights": { material: "30", labor: "40" }, // $27.23 rounded up
  "Tub Pendant": { material: "60", labor: "40" }, // $57.32 rounded up
  "Ceiling Fans": { material: "145", labor: "40" }, // $140.19 rounded up
  "Closet Lights": { material: "30", labor: "40" }, // $28.72 rounded up
  "Under Cabinet Lights": { material: "60", labor: "50" }, // Gluck spreadsheet -- was $68.97 (Home Depot)
  "Baseboard Heaters": { material: "85", labor: "40" }, // $82.78 rounded up
  "Combo EXIT/Emergency Lights": { material: "85", labor: "40" }, // $82.77 rounded up
  "2x2 Lights": { material: "75", labor: "40" }, // $74.72 rounded up
  "2x4 Lights": { material: "70", labor: "40" }, // $68.97 rounded up
  "Flush Mount Ceiling Lights": { material: "25", labor: "40" }, // $20.67 rounded up
  "Track Lighting": { material: "65", labor: "40" }, // $63.22 rounded up
  "Landscape Lighting": { material: "30", labor: "40" }, // $26.77 rounded up
  "Motion Sensor Lights": { material: "35", labor: "40" }, // $34.47 rounded up
  "Security Flood Lights": { material: "25", labor: "40" }, // $22.97 rounded up
  "Bathroom Fan/Light Combo": { material: "95", labor: "40" }, // $94.30 rounded up
  "Under-Stair Lights": { material: "25", labor: "40" }, // $20.13 rounded up
  "Strip/Rope Lighting": { material: "25", labor: "40" }, // $22.98 rounded up
  "Mirror Lights": { material: "90", labor: "40" }, // $85.28 rounded up

  "Four-Way Toggle Switches": { material: "15", labor: "40" }, // $14.93 rounded up
  "Quad Outlets": { material: "45", labor: "40" }, // $42.81 rounded up
  "Unbreakable Nylon Cover Plates": { material: "5", labor: "40" }, // $1.13 rounded up
  "Dishwasher Outlet": { material: "10", labor: "40" }, // $7.80 rounded up
  "Disposal Outlet": { material: "10", labor: "50" }, // Gluck spreadsheet -- was $7.80/$40 (Home Depot)
  "Microwave Outlet": { material: "10", labor: "50" }, // Gluck spreadsheet -- was $10.33/$40 (Home Depot)
  "Oven/Range Outlet": { material: "75", labor: "50" }, // Gluck spreadsheet -- was $11.04/$40 (Home Depot)
  "Refrigerator Outlet": { material: "10", labor: "50" }, // Gluck spreadsheet -- was $10.33/$40 (Home Depot)
  "Washer Outlet": { material: "75", labor: "50" }, // Leshnoff Townhomes spreadsheet -- was $22.14/$40 (Home Depot)
  "Dryer Outlet": { material: "75", labor: "50" }, // Leshnoff Townhomes spreadsheet -- was $11.48/$40 (Home Depot)
  "Garage Door Opener Outlet": { material: "25", labor: "50" }, // Leshnoff Townhomes spreadsheet -- was $1.13/$40 (Home Depot)
  "TV Outlet": { material: "50", labor: "40" }, // $45.98 rounded up
  "Data Outlet (CAT5e)": { material: "10", labor: "40" }, // $6.38 rounded up
  "Thermostat": { material: "45", labor: "40" }, // $42.16 rounded up
  "AFCI Outlets": { material: "25", labor: "40" }, // $20.91 rounded up
  "USB Outlets": { material: "60", labor: "40" }, // $57.48 rounded up
  "Smart Switches": { material: "35", labor: "40" }, // $34.48 rounded up
  "Smart Outlets": { material: "15", labor: "40" }, // $11.47 rounded up
  "Timer Switches": { material: "20", labor: "40" }, // $15.53 rounded up
  "Photocell (Dusk-to-Dawn) Switches": { material: "15", labor: "40" }, // $11.48 rounded up
  "220V/240V Outlets": { material: "10", labor: "40" }, // $9.78 rounded up
  "Floor Outlets": { material: "55", labor: "40" }, // $53.82 rounded up
  "Weatherproof In-Use Covers": { material: "15", labor: "40" }, // $13.75 rounded up
  "Combination Switch/Outlet": { material: "10", labor: "40" }, // $9.37 rounded up

  // Wire/conduit/small hardware -- NOT rounded, per CJ: rounding these to
  // the nearest $5 would massively inflate per-foot/small-unit prices
  // (e.g. Romex at $0.86/ft would become $5/ft). Priced per the unit the
  // real Home Depot SKU is sold in -- per foot for wire/cable, per 10'
  // stick for conduit, per box for staples.
  "Romex/NM Cable": { material: "0.86", labor: "40" },
  "THHN Wire": { material: "0.24", labor: "40" },
  "EMT Conduit": { material: "14.18", labor: "40" },
  "PVC Conduit": { material: "6.81", labor: "40" },
  "Flexible Conduit (Sealtite)": { material: "57.49", labor: "40" },
  "Armored Cable (MC/BX)": { material: "1.24", labor: "40" },
  "Junction Boxes": { material: "3.07", labor: "40" },
  "Device/Outlet Boxes": { material: "0.98", labor: "40" },
  "Cable Staples": { material: "5.45", labor: "40" },
  "Electrical Tape": { material: "3.43", labor: "40" },

  // These four vary enormously by size/brand in real life (e.g. Kitchen
  // Hood alone ranges roughly $130-$2,000) -- representative mid-range
  // unit + 15%, rounded up to the nearest $5 like the rest above, but
  // treat them as a starting point to adjust per job more than any other
  // line here.
  "New HVAC Indoor & Outdoor Unit": { material: "4025", labor: "40" }, // $4,025.00 already a multiple of $5
  "New Kitchen Hood": { material: "715", labor: "40" }, // $710.70 rounded up
  "New Water Heater": { material: "645", labor: "40" }, // $642.85 rounded up
  "Sump Pump": { material: "115", labor: "40" }, // $114.99 rounded up
  },
  // Every other item in this step matched the $15/$40 flat default exactly
  // (confirmed by the Zakem spreadsheet) -- this one's the sole exception,
  // per the Leshnoff Townhomes spreadsheet (labor differs, material doesn't).
  "Install Customer-Supplied Fixtures": {
    "Under Cabinet Lights": { material: "15", labor: "50" },
  },

  // ---- Commercial (from 3509 Eastern Ave and Mainspring Harrisonburg,
  // two real completed commercial jobs). Where the two disagreed, Mainspring
  // (newer, more detailed, and internally consistent -- its own qty x unit
  // math always matched its totals, unlike several Eastern Ave rows) was
  // treated as first choice. Rough-in labor is $40/unit almost everywhere in
  // both jobs; only material and a few labor exceptions vary by item. ----
  "Commercial Rough-In": {
    "Push Button Switch (Standard)": { material: "10", labor: "40" },
    "Push Button Switch (Basic)": { material: "10", labor: "40" },
    "Toggle Switch": { material: "20", labor: "40" }, // Eastern Ave -- Mainspring doesn't have this item
    "Occupancy Sensor Switch": { material: "20", labor: "40" }, // Eastern Ave
    "Duplex Outlet": { material: "10", labor: "40" },
    "Duplex Outlet w/ Plug-Load Control": { material: "10", labor: "40" },
    "Quad Outlet": { material: "10", labor: "50" },
    "Quad Outlet w/ Plug-Load Control": { material: "10", labor: "50" },
    "GFCI Outlet": { material: "10", labor: "40" },
    "Weatherproof GFCI Outlet": { material: "10", labor: "40" },
    "Specialty Outlet": { material: "10", labor: "40" },
    "Sign Receptacle": { material: "20", labor: "40" }, // Eastern Ave only
    'Recessed Light (4")': { material: "10", labor: "40" },
    "Recessed Light w/ Battery Backup": { material: "10", labor: "40" },
    "2x2 Light": { material: "10", labor: "40" },
    "2x2 Light w/ Battery Backup": { material: "10", labor: "40" },
    "LED Pendant Light": { material: "10", labor: "40" },
    "LED Pendant Light w/ Battery Backup": { material: "10", labor: "40" },
    "Exterior Wall Sconce w/ Battery Backup": { material: "10", labor: "40" },
    "Exterior Recessed Light": { material: "10", labor: "40" },
    "Exterior Recessed Light w/ Battery Backup": { material: "10", labor: "40" },
    "EXIT Sign (Single-Sided)": { material: "10", labor: "40" },
    "EXIT Sign (Double-Sided)": { material: "10", labor: "40" },
    "Air Handler": { material: "100", labor: "40" },
    "Condenser": { material: "300", labor: "75" },
    "Rooftop Unit": { material: "300", labor: "75" }, // Eastern Ave only -- Mainspring has no rooftop units
    "Exhaust Fan": { material: "10", labor: "40" },
    "Water Heater": { material: "100", labor: "40" },
    "Motorized Damper": { material: "20", labor: "40" },
    "Fire Alarm Control Panel": { material: "10", labor: "40" },
    // Eastern Ave only, and that row's own qty x unit didn't match its total --
    // using the unit-price cells, same rule as every other inconsistent row.
    "Circulator Pump": { material: "20", labor: "40" },
    "Data Outlet": { material: "15", labor: "40" },
  },
  "Commercial Outlet Installation": {
    "Duplex Outlet": { material: "7", labor: "50" },
    "Duplex Outlet w/ Plug-Load Control": { material: "15", labor: "50" },
    "Quad Outlet": { material: "7", labor: "50" },
    "Quad Outlet w/ Plug-Load Control": { material: "15", labor: "50" },
    "GFCI Outlet": { material: "30", labor: "50" },
    "Weatherproof GFCI Outlet": { material: "30", labor: "50" },
    "Specialty Outlet": { material: "20", labor: "50" }, // Eastern Ave showed $15 -- Mainspring wins
    "Sign Receptacle": { material: "15", labor: "50" }, // Eastern Ave only
    "Unbreakable Nylon Cover Plate": { material: "3", labor: "5" },
  },
  "Commercial Switch Installation": {
    "Push Button Switch (Standard)": { material: "80", labor: "40" },
    "Push Button Switch (Basic)": { material: "35", labor: "40" },
    "Toggle Switch": { material: "5", labor: "40" }, // Eastern Ave only
    "Occupancy Sensor Switch": { material: "50", labor: "40" }, // Eastern Ave only
    "Unbreakable Nylon Cover Plate": { material: "3", labor: "5" },
  },
  "Commercial Lighting Installation": {
    'Recessed Light (4")': { material: "25", labor: "50" },
    "Recessed Light w/ Battery Backup": { material: "35", labor: "50" },
    "2x2 Light": { material: "150", labor: "50" },
    "2x2 Light w/ Battery Backup": { material: "200", labor: "50" },
    "LED Pendant Light": { material: "150", labor: "50" },
    "LED Pendant Light w/ Battery Backup": { material: "200", labor: "50" },
    "Exterior Wall Sconce w/ Battery Backup": { material: "250", labor: "50" },
    "Exterior Recessed Light": { material: "25", labor: "50" },
    "Exterior Recessed Light w/ Battery Backup": { material: "35", labor: "50" },
    "EXIT Sign (Single-Sided)": { material: "50", labor: "50" },
    "EXIT Sign (Double-Sided)": { material: "50", labor: "50" },
    // Eastern Ave only -- Mainspring's Lighting Installation doesn't cover these.
    "Exhaust Fan": { material: "120", labor: "50" },
    "Emergency Light": { material: "120", labor: "50" },
    "Combo EXIT/Emergency Light": { material: "120", labor: "50" },
    "Ceiling Mounted Occupancy Sensor": { material: "120", labor: "50" },
  },
  "Commercial Data Installation": {
    "Tombstone Jack": { material: "7", labor: "50" },
    "Unbreakable Nylon Cover Plate": { material: "3", labor: "5" },
  },
  "Commercial Disconnects": {
    // Both jobs agree exactly: Eastern Ave ($200/$400 total for qty 4) and
    // Mainspring ($850/$1,700 total for qty 17) both work out to $50/$100 per unit.
    "Equipment Disconnect (Air Handler, Condenser, Water Heater, etc.)": { material: "50", labor: "100" },
  },
  "Commercial Panels and Meters": {
    "New Enclosed Circuit Breaker": { material: "1000", labor: "1000" }, // Mainspring only
    "New CT Cabinet": { material: "1000", labor: "1000" }, // Mainspring only
    "New 800A 3-Phase Panel": { material: "7500", labor: "2500" }, // Mainspring only
    "New 200A 3-Phase Panel": { material: "800", labor: "1000" }, // both jobs agree exactly
    "New 125A 3-Phase Panel": { material: "800", labor: "1000" }, // Mainspring -- same rate as the 200A, worth double-checking
    // Eastern Ave -- that row's own qty x unit labor didn't match its total;
    // using the unit-price cells (material matched fine).
    "Ground Rods and Clamps": { material: "100", labor: "40" },
    "SER Cable (4/0-4/0-4/0-4)": { material: "10", labor: "5" }, // Eastern Ave, per foot
    'EMT Conduit (3")': { material: "95", labor: "5" }, // Mainspring, per foot
    'EMT Conduit (2")': { material: "50", labor: "5" }, // Mainspring, per foot
    'EMT Conduit (1-1/2")': { material: "60", labor: "5" }, // Mainspring, per foot
    "600 KCM Wire": { material: "30", labor: "5" }, // Mainspring, per foot
    "600 KCM Neutral Wire": { material: "30", labor: "5" }, // Mainspring, per foot
    "1/0 AWG Ground Wire": { material: "2.5", labor: "5" }, // Mainspring, per foot
    "3/0 AWG Wire": { material: "15", labor: "5" }, // Mainspring, per foot
    "3/0 AWG Neutral Wire": { material: "15", labor: "5" }, // Mainspring, per foot
    "#6 AWG Ground Wire": { material: "3", labor: "5" }, // Mainspring, per foot
    // Eastern Ave -- that row's labor cell read $20/ft but only $2/ft actually
    // matches its own total ($400 over 200ft); using $2, per the same
    // trust-the-math-that-works rule as the rows above.
    "#4 AWG THHN Wire": { material: "3", labor: "2" },
    "#1 AWG Wire": { material: "4", labor: "5" }, // Mainspring, per foot
    "#1 AWG Neutral Wire": { material: "4", labor: "5" }, // Mainspring, per foot
  },
  "Commercial Circuit Breakers": {
    "20A Single-Pole Breaker": { material: "20", labor: "15" }, // both jobs agree exactly
    "20A Single-Pole GFCI Breaker": { material: "100", labor: "15" }, // Mainspring only
    "20A 2-Pole Breaker": { material: "50", labor: "15" }, // Eastern Ave only
    "20A 3-Pole Breaker": { material: "50", labor: "15" }, // Mainspring only
    "25A 2-Pole Breaker": { material: "50", labor: "15" }, // Mainspring only
    "30A 2-Pole Breaker": { material: "50", labor: "15" }, // both jobs agree exactly
    "45A 2-Pole Breaker": { material: "50", labor: "15" }, // both jobs agree exactly
    "50A 2-Pole Breaker": { material: "50", labor: "15" }, // Mainspring only
    "60A 2-Pole Breaker": { material: "50", labor: "15" }, // both jobs agree exactly
    "125A 3-Pole Breaker": { material: "600", labor: "15" }, // Mainspring only
    "200A 3-Pole Breaker": { material: "600", labor: "15" }, // Mainspring only
  },
  "Commercial Permits, Inspection & Finalization": {
    // Mainspring: $1,250/$1,250. Eastern Ave: $1,250/$1,000 -- close but not
    // identical (labor differs); Mainspring used as first choice.
    "Pull required electrical permits": { material: "1250", labor: "1250" },
  },
};

// Shown under an item whenever its price genuinely can't be a fixed default.
// This is CJ-facing only (a reminder to fill in a real cost) -- it never
// goes out in the scope of work, unlike ITEM_SCOPE_NOTES below.
const ITEM_NOTES: Record<string, string> = {
  "Mount and wire new exterior 200A main disconnect":
    "Price varies $2,000-$20,000 depending on BGE -- set the real cost on this line before sending the estimate.",
};

// Customer-facing caveat appended to the scope of work whenever this item is
// checked -- separate from ITEM_NOTES above since that one's an internal
// reminder to CJ, not wording meant to go out on the estimate.
const ITEM_SCOPE_NOTES: Record<string, string> = {
  "Mount and wire new exterior 200A main disconnect":
    "Price for the service upgrade will vary from $2,000 to $20,000, depending entirely on BGE's requirements.",
};

export default function EstimateWizard({
  onClose,
  onCreated,
  jobId,
  initialCustomer,
  initialAddress,
}: {
  onClose: () => void;
  onCreated: (e: Estimate) => void;
  /** When opened from a job's page, links the new estimate to that job and
   * pre-fills customer/address from it (still editable on the intro step). */
  jobId?: number;
  initialCustomer?: string;
  initialAddress?: string;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<"intro" | number>("intro"); // "intro" = customer/address screen, else step index
  const [jobType, setJobType] = useState<"residential" | "commercial">("residential");
  const [hasPlans, setHasPlans] = useState<boolean | null>(null);
  const activeSteps = jobType === "commercial" ? COMMERCIAL_STEPS : WIZARD_STEPS;
  const [customer, setCustomer] = useState(initialCustomer ?? "");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [customerEmail, setCustomerEmail] = useState("");
  const [profitPct, setProfitPct] = useState("20");
  const [discountPct, setDiscountPct] = useState("0");
  const [selections, setSelections] = useState<Selections>({});
  const [customItems, setCustomItems] = useState<Record<number, CustomItem[]>>({});
  const [customName, setCustomName] = useState("");
  const [customQty, setCustomQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [savedItems, setSavedItems] = useState<ChecklistItem[]>([]);
  const [analyzingPlan, setAnalyzingPlan] = useState(false);
  const [planResult, setPlanResult] = useState<PlanAnalyzeResult | null>(null);
  const planFileInput = useRef<HTMLInputElement>(null);

  // Anything typed into "Not on the list?" on a past estimate lands here,
  // so it shows up as a normal checkbox from then on instead of needing to
  // be retyped every time.
  useEffect(() => {
    api<ChecklistItem[]>("/estimates/checklist-items").then(setSavedItems).catch(() => {});
  }, []);

  const savedForStep = (stepIdx: number) =>
    savedItems.filter((s) => s.section === activeSteps[stepIdx]?.section);

  // Clear whatever's half-typed in the custom-item box when moving between
  // steps, so leftover text from one section doesn't carry into the next.
  useEffect(() => {
    setCustomName("");
    setCustomQty("1");
  }, [phase]);

  const toggle = (stepIdx: number, groupIdx: number | "saved", item: string) => {
    const k = key(stepIdx, groupIdx, item);
    setSelections((s) => {
      const cur = s[k];
      return { ...s, [k]: cur?.checked ? { ...cur, checked: false } : { checked: true, qty: cur?.qty ?? "1" } };
    });
  };

  const setQty = (stepIdx: number, groupIdx: number | "saved", item: string, qty: string) => {
    const k = key(stepIdx, groupIdx, item);
    setSelections((s) => ({ ...s, [k]: { checked: true, qty } }));
  };

  const setBreakerQty = (delta: number) => {
    const k = key(PANELS_STEP_IDX, 0, BREAKER_ITEM);
    setSelections((s) => {
      const next = Math.max(0, (parseFloat(s[k]?.qty ?? "0") || 0) + delta);
      return { ...s, [k]: { checked: next > 0, qty: String(next) } };
    });
  };

  // "keys for every item in this step" -- built-in checklist items plus any
  // previously-saved custom ones, so Select/Clear all covers everything a
  // single item's checkbox could.
  const allKeysForStep = (stepIdx: number) => [
    ...activeSteps[stepIdx].groups.flatMap((g, gi) => g.items.map((it) => key(stepIdx, gi, it))),
    ...savedForStep(stepIdx).map((s) => key(stepIdx, "saved", s.label)),
  ];

  const allCheckedForStep = (stepIdx: number) => {
    const keys = allKeysForStep(stepIdx);
    return keys.length > 0 && keys.every((k) => selections[k]?.checked);
  };

  // One button that checks every item in the step, or -- if everything's
  // already checked -- clears them all back out. Existing quantities are
  // kept as-is so re-clicking doesn't wipe out numbers someone already typed.
  const toggleAllForStep = (stepIdx: number) => {
    const turnOn = !allCheckedForStep(stepIdx);
    setSelections((s) => {
      const next = { ...s };
      for (const k of allKeysForStep(stepIdx)) {
        next[k] = { checked: turnOn, qty: s[k]?.qty ?? "1" };
      }
      return next;
    });
  };

  const selectedCount = (stepIdx: number) =>
    activeSteps[stepIdx].groups.reduce(
      (n, g, gi) => n + g.items.filter((it) => selections[key(stepIdx, gi, it)]?.checked).length,
      0,
    ) +
    savedForStep(stepIdx).filter((s) => selections[key(stepIdx, "saved", s.label)]?.checked).length +
    (customItems[stepIdx]?.length ?? 0);

  const addCustomItem = async (stepIdx: number) => {
    const name = customName.trim();
    if (!name || !(parseFloat(customQty) > 0)) return;
    setCustomItems((c) => ({
      ...c,
      [stepIdx]: [...(c[stepIdx] ?? []), { id: nextCustomId++, name, qty: customQty }],
    }));
    setCustomName("");
    setCustomQty("1");

    // Save it so it shows up as a normal checkbox on every future estimate --
    // skip if it's already one of the built-in options or already saved.
    const section = activeSteps[stepIdx].section;
    const alreadyKnown =
      activeSteps[stepIdx].groups.some((g) => g.items.some((it) => it.toLowerCase() === name.toLowerCase())) ||
      savedItems.some((s) => s.section === section && s.label.toLowerCase() === name.toLowerCase());
    if (alreadyKnown) return;
    try {
      const saved = await api<ChecklistItem>("/estimates/checklist-items", {
        method: "POST",
        body: { section, label: name },
      });
      setSavedItems((s) => [...s, saved]);
    } catch {
      // Non-critical -- the item is still on THIS estimate either way, it
      // just won't be remembered for next time.
    }
  };

  const removeSavedItem = async (id: number) => {
    setSavedItems((s) => s.filter((it) => it.id !== id));
    try {
      await api(`/estimates/checklist-items/${id}`, { method: "DELETE" });
    } catch {
      // ignore -- worst case it reappears next time the list is fetched
    }
  };

  const removeCustomItem = (stepIdx: number, id: number) => {
    setCustomItems((c) => ({ ...c, [stepIdx]: (c[stepIdx] ?? []).filter((it) => it.id !== id) }));
  };

  // Pre-checks boxes from an AI plan-sheet reading -- matches each returned
  // item against a real checklist item where possible (so it shows as a
  // normal checked box), and falls back to a custom item otherwise. Nothing
  // here creates the estimate -- it only fills in selections for review.
  const applyPlanResult = async (result: PlanAnalyzeResult) => {
    setPlanResult(result);
    const newSelections: Selections = {};
    const newCustomItems: Record<number, CustomItem[]> = {};
    const newlySaved: ChecklistItem[] = [];

    for (const found of result.items) {
      if (!(found.qty > 0)) continue;
      const stepIdx = WIZARD_STEPS.findIndex((s) => s.section === found.section);
      if (stepIdx === -1) continue;
      const step = WIZARD_STEPS[stepIdx];
      const qty = String(found.qty);

      let matchedItem: string | undefined;
      let matchedGroupIdx = -1;
      step.groups.forEach((g, gi) => {
        if (matchedGroupIdx === -1) {
          const hit = g.items.find((it) => it.toLowerCase() === found.label.toLowerCase());
          if (hit) {
            matchedItem = hit;
            matchedGroupIdx = gi;
          }
        }
      });
      if (matchedItem) {
        newSelections[key(stepIdx, matchedGroupIdx, matchedItem)] = { checked: true, qty };
        continue;
      }

      const savedMatch = savedItems.find(
        (s) => s.section === step.section && s.label.toLowerCase() === found.label.toLowerCase(),
      );
      if (savedMatch) {
        newSelections[key(stepIdx, "saved", savedMatch.label)] = { checked: true, qty };
        continue;
      }

      newCustomItems[stepIdx] = [...(newCustomItems[stepIdx] ?? []), { id: nextCustomId++, name: found.label, qty }];
      try {
        const saved = await api<ChecklistItem>("/estimates/checklist-items", {
          method: "POST",
          body: { section: step.section, label: found.label },
        });
        newlySaved.push(saved);
      } catch {
        // Non-critical -- the item still shows for this estimate as a custom item.
      }
    }

    setSelections((s) => ({ ...s, ...newSelections }));
    setCustomItems((c) => {
      const merged = { ...c };
      for (const [stepIdx, items] of Object.entries(newCustomItems)) {
        merged[Number(stepIdx)] = [...(merged[Number(stepIdx)] ?? []), ...items];
      }
      return merged;
    });
    if (newlySaved.length) setSavedItems((s) => [...s, ...newlySaved]);
  };

  const handlePlanFile = async (file: File) => {
    setAnalyzingPlan(true);
    setPlanResult(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const result = await api<PlanAnalyzeResult>("/estimates/analyze-plan", {
        method: "POST",
        body: { filename: file.name, data: dataUrl },
      });
      await applyPlanResult(result);
      setPhase(0);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not read that plan sheet");
    } finally {
      setAnalyzingPlan(false);
      if (planFileInput.current) planFileInput.current.value = "";
    }
  };

  const costFor = (item: string, step: WizardStep) => {
    const sectionOverrides = ITEM_COST_OVERRIDES[step.section];
    // Exact match first (cheap, common case), then case/whitespace-insensitive
    // -- catches a custom-typed or AI-plan-matched label that differs only in
    // capitalization ("ceiling fans" vs "Ceiling Fans") so it still gets the
    // real price instead of silently falling back to the step default.
    let override = sectionOverrides?.[item];
    if (!override && sectionOverrides) {
      const target = item.trim().toLowerCase();
      const hit = Object.keys(sectionOverrides).find((k) => k.toLowerCase() === target);
      if (hit) override = sectionOverrides[hit];
    }
    return {
      material_unit_cost: override?.material ?? step.defaultMaterial,
      labor_unit_cost: override?.labor ?? step.defaultLabor,
    };
  };

  // A $0/$0 line with no other context just looks blank/forgotten on the
  // estimate itself -- items with a real price-varies caveat (currently
  // just the BGE service upgrade) get that caveat folded right into the
  // line description, so it's visible wherever the line shows up, not only
  // in the wizard checklist or buried in the scope-of-work paragraph.
  const descriptionFor = (item: string) => (ITEM_SCOPE_NOTES[item] ? `${item} -- ${ITEM_SCOPE_NOTES[item]}` : item);

  const buildSections = () => {
    const bySection: Record<string, { item_id: null; description: string; qty: string; unit: string; material_unit_cost: string; labor_unit_cost: string }[]> = {};
    for (const s of SILENT_SECTIONS) bySection[s] = [];
    activeSteps.forEach((step, stepIdx) => {
      const lines: (typeof bySection)[string] = [];
      step.groups.forEach((group, groupIdx) => {
        group.items.forEach((item) => {
          const sel = selections[key(stepIdx, groupIdx, item)];
          if (sel?.checked && parseFloat(sel.qty) > 0) {
            lines.push({
              item_id: null, description: descriptionFor(item), qty: sel.qty, unit: "each",
              ...costFor(item, step),
            });
          }
        });
      });
      for (const saved of savedForStep(stepIdx)) {
        const sel = selections[key(stepIdx, "saved", saved.label)];
        if (sel?.checked && parseFloat(sel.qty) > 0) {
          lines.push({
            item_id: null, description: descriptionFor(saved.label), qty: sel.qty, unit: "each",
            ...costFor(saved.label, step),
          });
        }
      }
      for (const custom of customItems[stepIdx] ?? []) {
        lines.push({
          item_id: null, description: descriptionFor(custom.name), qty: custom.qty, unit: "each",
          ...costFor(custom.name, step),
        });
      }
      bySection[step.section] = lines;
    });
    // Order: Demolition, then the wizard sections in order, then Miscellaneous --
    // matches the order every other estimate in the app shows sections in.
    return ["Demolition", ...activeSteps.map((s) => s.section), "Miscellaneous"].map((name) => ({
      name,
      lines: bySection[name],
    }));
  };

  // Writes out what got clicked in plain paper-estimate language -- reuses
  // each group's own intro sentence ("Provide rough-in wiring for the
  // following fixtures:") so it reads the same way the real template does,
  // instead of leaving the scope-of-work field blank.
  const buildScopeOfWork = () => {
    const sections: string[] = [];
    activeSteps.forEach((step, stepIdx) => {
      const parts: string[] = [];
      step.groups.forEach((group, groupIdx) => {
        const picked = group.items
          .filter((it) => selections[key(stepIdx, groupIdx, it)]?.checked && parseFloat(selections[key(stepIdx, groupIdx, it)].qty) > 0)
          .map((it) => `${selections[key(stepIdx, groupIdx, it)].qty} ${it}`);
        if (picked.length === 0) return;
        parts.push(group.intro ? `${group.intro} ${picked.join(", ")}.` : `${picked.join(", ")}.`);
        // Items whose price genuinely can't be a fixed number (e.g. the BGE
        // service upgrade) carry a customer-facing caveat that needs to
        // follow the item into the actual scope of work, not just stay as
        // an in-wizard hint CJ sees while picking items.
        group.items
          .filter((it) => selections[key(stepIdx, groupIdx, it)]?.checked && ITEM_SCOPE_NOTES[it])
          .forEach((it) => parts.push(ITEM_SCOPE_NOTES[it]));
      });
      const extras = [
        ...savedForStep(stepIdx)
          .filter((s) => selections[key(stepIdx, "saved", s.label)]?.checked && parseFloat(selections[key(stepIdx, "saved", s.label)].qty) > 0)
          .map((s) => `${selections[key(stepIdx, "saved", s.label)].qty} ${s.label}`),
        ...(customItems[stepIdx] ?? []).map((c) => `${c.qty} ${c.name}`),
      ];
      if (extras.length > 0) parts.push(`Also: ${extras.join(", ")}.`);
      if (parts.length > 0) sections.push(`${stepIdx + 1}. ${step.section}\n${parts.join("\n")}`);
    });
    return sections.join("\n\n");
  };

  const finish = async () => {
    setSaving(true);
    try {
      const est = await api<Estimate>("/estimates", {
        method: "POST",
        body: {
          job_id: jobId, customer, address, customer_email: customerEmail || undefined,
          scope_of_work: buildScopeOfWork(), profit_pct: profitPct, discount_pct: discountPct,
        },
      });
      const full = await api<Estimate>(`/estimates/${est.id}`, {
        method: "PATCH",
        body: { sections: buildSections() },
      });
      onCreated(full);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not create estimate");
      setSaving(false);
    }
  };

  const stepIdx = typeof phase === "number" ? phase : -1;
  const totalSteps = activeSteps.length;

  return (
    <Sheet
      title={phase === "intro" ? "New estimate" : `${stepIdx + 1}. ${activeSteps[stepIdx].section}`}
      subtitle={phase === "intro" ? undefined : `Step ${stepIdx + 2} of ${totalSteps + 1}`}
      onClose={onClose}
    >
      <div className="space-y-4 pb-2">
        {planResult && (
          <div
            className={`rounded-xl border p-3 text-[13px] leading-snug ${
              planResult.sheet_type === "architectural_only"
                ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                : "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
            }`}
          >
            <span className="font-semibold">From the plan sheet: </span>
            {planResult.confidence_note}
          </div>
        )}

        {phase === "intro" && (
          <div className="space-y-3.5">
            <div>
              <span className="label">Job type</span>
              <div className="grid grid-cols-2 gap-2">
                {(["residential", "commercial"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`card-interactive p-2.5 text-[13.5px] font-medium capitalize ${
                      jobType === t ? "border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-500" : ""
                    }`}
                    onClick={() => setJobType(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {jobType === "residential" && (
              <div>
                <span className="label">Do you have plans for this job?</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={`card-interactive p-2.5 text-[13.5px] font-medium ${
                      hasPlans === true ? "border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-500" : ""
                    }`}
                    onClick={() => setHasPlans(true)}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`card-interactive p-2.5 text-[13.5px] font-medium ${
                      hasPlans === false ? "border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-500" : ""
                    }`}
                    onClick={() => setHasPlans(false)}
                  >
                    No
                  </button>
                </div>
              </div>
            )}
            {jobType === "residential" && hasPlans === true && (
              <div>
                <input
                  ref={planFileInput}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePlanFile(file);
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={analyzingPlan}
                  onClick={() => planFileInput.current?.click()}
                >
                  {analyzingPlan ? <Spinner /> : <Icon name="file-text" size={16} />}
                  {analyzingPlan ? "Reading plan sheet…" : "Import from plan sheet (PDF)"}
                </button>
                <p className="mt-1.5 text-[12px] text-slate-400 dark:text-slate-500">
                  Reads a plan PDF and checks off what it finds below, for you to review before saving.
                </p>
              </div>
            )}
            <label className="block">
              <span className="label">Customer</span>
              <input className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} autoFocus />
            </label>
            <label className="block">
              <span className="label">Address</span>
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Customer email (optional)</span>
              <input
                className="input"
                type="email"
                placeholder="Needed later to send the estimate"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Profit %</span>
                <input className="input" type="number" value={profitPct} onChange={(e) => setProfitPct(e.target.value)} />
              </label>
              <label className="block">
                <span className="label">Repeat customer discount %</span>
                <input className="input" type="number" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
              </label>
            </div>
            <p className="text-[12px] text-slate-400 dark:text-slate-500">
              Next, we'll walk through each section — {activeSteps.map((s) => s.section).join(", ")} — so
              you just pick what applies and set quantities.
            </p>
          </div>
        )}

        {typeof phase === "number" && (
          <div className="space-y-5">
            <button type="button" className="btn-secondary w-full" onClick={() => toggleAllForStep(phase)}>
              {allCheckedForStep(phase) ? "Clear all" : "Select all"}
            </button>
            {activeSteps[phase].groups.map((group, groupIdx) => (
              <div key={groupIdx} className="space-y-2.5">
                {group.intro && (
                  <p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">{group.intro}</p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group.items.map((item) => {
                    const k = key(phase, groupIdx, item);
                    const sel = selections[k];
                    return (
                      <div
                        key={item}
                        className={`card-interactive flex flex-col gap-1.5 p-2.5 ${
                          sel?.checked ? "border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-500" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <button
                            className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                            onClick={() => toggle(phase, groupIdx, item)}
                          >
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                                sel?.checked
                                  ? "border-brand-500 bg-brand-500 text-white"
                                  : "border-slate-300 dark:border-slate-600"
                              }`}
                            >
                              {sel?.checked && <Icon name="check" size={13} strokeWidth={3} />}
                            </span>
                            <span className="min-w-0 text-[13.5px] font-medium">{item}</span>
                          </button>
                          {sel?.checked && (
                            <input
                              className="input !min-h-[36px] w-16 shrink-0 py-1 text-center"
                              type="number"
                              min="0"
                              step="any"
                              value={sel.qty}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setQty(phase, groupIdx, item, e.target.value)}
                            />
                          )}
                        </div>
                        {sel?.checked && ITEM_NOTES[item] && (
                          <p className="text-[11.5px] leading-snug text-amber-600 dark:text-amber-400">
                            {ITEM_NOTES[item]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {jobType === "residential" && phase === PANELS_STEP_IDX &&
              BREAKER_PROMPT_TRIGGERS.some((t) => selections[key(phase, 0, t)]?.checked) && (
                <div className="card flex items-center justify-between gap-3 border-brand-500/40 bg-brand-500/5 p-3">
                  <div>
                    <p className="text-[13.5px] font-medium">Any new breakers for this?</p>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">
                      Sets the "{BREAKER_ITEM}" line below.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button className="icon-btn !h-8 !w-8" onClick={() => setBreakerQty(-1)} aria-label="Fewer breakers">
                      <Icon name="minus" size={14} />
                    </button>
                    <span className="w-6 text-center text-[14px] font-semibold tabular-nums">
                      {selections[key(phase, 0, BREAKER_ITEM)]?.qty ?? "0"}
                    </span>
                    <button className="icon-btn !h-8 !w-8" onClick={() => setBreakerQty(1)} aria-label="More breakers">
                      <Icon name="plus" size={14} />
                    </button>
                  </div>
                </div>
              )}

            {savedForStep(phase).length > 0 && (
              <div className="space-y-2.5">
                <p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                  Previously added:
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {savedForStep(phase).map((saved) => {
                    const k = key(phase, "saved", saved.label);
                    const sel = selections[k];
                    return (
                      <div
                        key={saved.id}
                        className={`card-interactive flex items-start gap-2 p-2.5 ${
                          sel?.checked ? "border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-500" : ""
                        }`}
                      >
                        <button
                          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                          onClick={() => toggle(phase, "saved", saved.label)}
                        >
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                              sel?.checked
                                ? "border-brand-500 bg-brand-500 text-white"
                                : "border-slate-300 dark:border-slate-600"
                            }`}
                          >
                            {sel?.checked && <Icon name="check" size={13} strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 text-[13.5px] font-medium">{saved.label}</span>
                        </button>
                        {sel?.checked && (
                          <input
                            className="input !min-h-[36px] w-16 shrink-0 py-1 text-center"
                            type="number"
                            min="0"
                            step="any"
                            value={sel.qty}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setQty(phase, "saved", saved.label, e.target.value)}
                          />
                        )}
                        <button
                          className="icon-btn !h-7 !w-7 shrink-0"
                          onClick={() => removeSavedItem(saved.id)}
                          aria-label={`Forget ${saved.label}`}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              <p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                Not on the list?
              </p>
              {(customItems[phase] ?? []).length > 0 && (
                <div className="space-y-1.5">
                  {(customItems[phase] ?? []).map((it) => (
                    <div key={it.id} className="card flex items-start gap-2.5 p-2.5">
                      <span className="min-w-0 flex-1 text-[13.5px] font-medium">{it.name}</span>
                      <span className="shrink-0 text-[13px] tabular-nums text-slate-400 dark:text-slate-500">
                        × {it.qty}
                      </span>
                      <button
                        className="icon-btn !h-7 !w-7 shrink-0"
                        onClick={() => removeCustomItem(phase, it.id)}
                        aria-label={`Remove ${it.name}`}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  className="input min-w-0 flex-1"
                  placeholder="Item name (e.g. Ceiling Medallion)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomItem(phase)}
                />
                <input
                  className="input w-16 shrink-0 text-center"
                  type="number"
                  min="0"
                  step="any"
                  value={customQty}
                  onChange={(e) => setCustomQty(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomItem(phase)}
                />
                <button className="btn-secondary shrink-0 px-3" onClick={() => addCustomItem(phase)}>
                  <Icon name="plus" size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2.5 pt-2">
          <button
            className="btn-secondary flex-1"
            onClick={() => (phase === "intro" ? onClose() : setPhase(stepIdx === 0 ? "intro" : stepIdx - 1))}
          >
            {phase === "intro" ? "Cancel" : "Back"}
          </button>
          {phase === "intro" ? (
            <button className="btn-primary flex-1" onClick={() => setPhase(0)}>
              Next
              <Icon name="arrow-right" size={16} />
            </button>
          ) : stepIdx === totalSteps - 1 ? (
            <button className="btn-primary flex-1" disabled={saving} onClick={finish}>
              {saving ? <Spinner /> : null}
              Create estimate
            </button>
          ) : (
            <button className="btn-primary flex-1" onClick={() => setPhase(stepIdx + 1)}>
              Next{selectedCount(stepIdx) > 0 ? ` (${selectedCount(stepIdx)} selected)` : ""}
              <Icon name="arrow-right" size={16} />
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
