import { useEffect, useRef, useState } from "react";

import { api } from "../../api";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { ChecklistItem, Estimate, PlanAnalyzeResult, PlanMarker, PlanSymbolType } from "../../types";
import PlanMarkupSheet from "./PlanMarkupSheet";

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
    // Then raised 1/3 across the board (CJ's call) -- $20->$26.67, $35->$46.67.
    defaultMaterial: "26.67",
    defaultLabor: "46.67",
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
        // Every fixture Rough-In offers, plus this step's own extras (Linear
        // Closet Lights, Pantry Lights) -- so anything checked in Rough-In
        // has a same-named match here for the copy prompt, and everything
        // Rough-In can wire for is also pickable as a customer-supplied
        // fixture, not just this step's original narrower subset.
        intro: "Install the following customer-supplied fixtures:",
        items: [
          "Recessed Lights", "Chandeliers", "Pendant Lights", "Exterior Light", "Exterior Floodlights",
          "Basement Lights", "Crawl Space Lights", "Vanity Lights", "Exhaust Fans", "Reading Lights",
          "Tub Pendant", "Ceiling Fans", "Closet Lights", "Linear Closet Lights", "Pantry Lights",
          "Combination CO/Smoke Detectors", "Smoke Detectors", "Under Cabinet Lights", "Baseboard Heaters",
          "Wall Sconces", "Emergency Lights", "EXIT Lights", "Combo EXIT/Emergency Lights", "2x2 Lights",
          "2x4 Lights",
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
          "EXIT Sign (Double-Sided)", "EXIT Sign w/ Directional Arrow", "Emergency Light",
          "Combo EXIT/Emergency Light", "Combo EXIT/Emergency Light w/ Remote Exterior Head",
          "Ceiling Mounted Occupancy Sensor", "LED Bathroom Vanity Light", "LED Surface-Mounted Utility Light",
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
          "EXIT Sign (Double-Sided)", "EXIT Sign w/ Directional Arrow", "Exhaust Fan", "Emergency Light",
          "Combo EXIT/Emergency Light", "Combo EXIT/Emergency Light w/ Remote Exterior Head",
          "Ceiling Mounted Occupancy Sensor", "LED Bathroom Vanity Light", "LED Surface-Mounted Utility Light",
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

// A step whose items so often match its rough-in counterpart 1:1 (same
// fixture/outlet/switch/equipment names show up in both lists) that it's
// worth offering to copy those selections over instead of re-checking
// everything a second time. Target section -> source section to copy from.
const COPY_FROM_SECTION: Record<string, string> = {
  "Supply and Install": "Rough-In Electrical Work",
  "Install Customer-Supplied Fixtures": "Rough-In Electrical Work",
  "Commercial Outlet Installation": "Commercial Rough-In",
  "Commercial Switch Installation": "Commercial Rough-In",
  "Commercial Lighting Installation": "Commercial Rough-In",
};

// Unlike residential's single combined "Supply and Install" (which really
// does want every Rough-In item copied over, per an explicit ask: "every
// single item should be there not missing anything"), Commercial Rough-In
// is ONE checklist covering switches+outlets+lighting+equipment+data, but
// its three install steps are each narrow -- Switch Installation only
// prices switches, Outlet Installation only outlets, Lighting Installation
// only lighting. A blind full copy dumped every checked Rough-In item
// (lights, outlets, EXIT signs...) into whichever install step you copied
// into, as $0 custom clutter with nothing to do with that step. Restrict
// the copy to each target's matching Commercial Rough-In group index
// (0=switches, 1=outlets, 2=lighting -- see COMMERCIAL_STEPS above).
const COPY_GROUP_FILTER: Record<string, number[]> = {
  "Commercial Outlet Installation": [1],
  "Commercial Switch Installation": [0],
  "Commercial Lighting Installation": [2],
};

type Selections = Record<string, { checked: boolean; qty: string }>;
// material/labor: set only for a custom item priced from a real catalog
// match (a plan marker matched to a real item) -- overrides costFor()'s
// name-lookup/step-default pricing in buildSections() when present.
type CustomItem = { id: number; name: string; qty: string; material?: string; labor?: string };

// Where "Apply to estimate" on the plan markup screen lands each symbol
// type's total count -- usually TWO targets (the rough-in wiring step AND
// the supply/install step both get the same count checked off, since a
// plan's symbols represent work done in both phases), each either an exact
// checklist item or customOnly when nothing matches closely enough (the
// marker's own readable label becomes a free-text custom item instead).
type PlanChecklistTarget = { section: string; groupIdx: number; item: string } | { section: string; customOnly: true };

const PLAN_SYMBOL_LABEL: Record<PlanSymbolType, string> = {
  duplex: "Duplex Outlet", gfci: "GFCI Outlet", light: "Light Fixture", fan: "Ceiling Fan",
  exfan: "Exhaust Fan", switch: "Switch", smoke: "Smoke Detector", co_smoke: "Combo Smoke/CO Detector",
  panel: "Panel/Equipment",
};

// Only Rough-In gets checked off -- Supply and Install (and the commercial
// install steps) already have a "copy selections from Rough-In" button on
// their own screen, so pre-filling both here would just duplicate that.
const RESIDENTIAL_PLAN_MAP: Record<PlanSymbolType, PlanChecklistTarget[]> = {
  duplex: [{ section: "Rough-In Electrical Work", groupIdx: 1, item: "Duplex Outlets" }],
  gfci: [{ section: "Rough-In Electrical Work", groupIdx: 1, item: "GFCI Outlet" }],
  switch: [{ section: "Rough-In Electrical Work", groupIdx: 1, item: "Single-Pole Toggle Switches" }],
  light: [{ section: "Rough-In Electrical Work", groupIdx: 0, item: "Recessed Lights" }],
  fan: [{ section: "Rough-In Electrical Work", groupIdx: 0, item: "Ceiling Fans" }],
  exfan: [{ section: "Rough-In Electrical Work", groupIdx: 0, item: "Exhaust Fans" }],
  smoke: [{ section: "Rough-In Electrical Work", groupIdx: 0, item: "Smoke Detectors" }],
  co_smoke: [{ section: "Rough-In Electrical Work", groupIdx: 0, item: "Combination CO/Smoke Detectors" }],
  panel: [{ section: "Panels and Meters", customOnly: true }],
};

const COMMERCIAL_PLAN_MAP: Record<PlanSymbolType, PlanChecklistTarget[]> = {
  duplex: [{ section: "Commercial Rough-In", groupIdx: 1, item: "Duplex Outlet" }],
  gfci: [{ section: "Commercial Rough-In", groupIdx: 1, item: "GFCI Outlet" }],
  switch: [{ section: "Commercial Rough-In", groupIdx: 0, item: "Toggle Switch" }],
  light: [{ section: "Commercial Rough-In", groupIdx: 2, item: "2x2 Light" }],
  fan: [{ section: "Commercial Rough-In", customOnly: true }],
  exfan: [{ section: "Commercial Rough-In", groupIdx: 3, item: "Exhaust Fan" }],
  smoke: [{ section: "Commercial Rough-In", customOnly: true }],
  co_smoke: [{ section: "Commercial Rough-In", customOnly: true }],
  panel: [{ section: "Commercial Panels and Meters", customOnly: true }],
};

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
  // Only items that differ from the step default are listed here; the
  // switches/outlets that matched it exactly needed no entry. Every number
  // below (like the step default above) is the original Zakem price raised
  // 1/3 (CJ's call) -- $25->$33.33, $30->$40.00, $35->$46.67.
  "Rough-In Electrical Work": {
    "Recessed Lights": { material: "33.33", labor: "46.67" },
    "Baseboard Heaters": { material: "33.33", labor: "46.67" },
    "Thermostat": { material: "33.33", labor: "46.67" },
    "Vanity Lights": { material: "33.33", labor: "46.67" },
    "Exterior Light": { material: "33.33", labor: "46.67" },
    "Exhaust Fans": { material: "33.33", labor: "46.67" },
    "Smoke Detectors": { material: "33.33", labor: "46.67" },
    "Washer Outlet": { material: "33.33", labor: "46.67" },
    "Combination CO/Smoke Detectors": { material: "40.00", labor: "46.67" },
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
  "Exhaust Fans": { material: "200", labor: "50" }, // CJ's updated price -- was $40 (Gluck spreadsheet)
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
    "EXIT Sign w/ Directional Arrow": { material: "10", labor: "40" },
    "Emergency Light": { material: "10", labor: "40" },
    "Combo EXIT/Emergency Light": { material: "10", labor: "40" },
    "Combo EXIT/Emergency Light w/ Remote Exterior Head": { material: "10", labor: "40" },
    "Ceiling Mounted Occupancy Sensor": { material: "10", labor: "40" },
    "LED Bathroom Vanity Light": { material: "10", labor: "40" },
    "LED Surface-Mounted Utility Light": { material: "10", labor: "40" },
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
    "EXIT Sign w/ Directional Arrow": { material: "55", labor: "50" },
    // Eastern Ave only -- Mainspring's Lighting Installation doesn't cover these.
    "Exhaust Fan": { material: "120", labor: "50" },
    "Emergency Light": { material: "120", labor: "50" },
    "Combo EXIT/Emergency Light": { material: "120", labor: "50" },
    "Combo EXIT/Emergency Light w/ Remote Exterior Head": { material: "180", labor: "60" },
    "Ceiling Mounted Occupancy Sensor": { material: "120", labor: "50" },
    "LED Bathroom Vanity Light": { material: "80", labor: "50" },
    "LED Surface-Mounted Utility Light": { material: "60", labor: "50" },
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

// Reconstructs wizard state (job type, checked boxes, custom lines) from an
// already-created estimate, so "Edit" can reopen the checklist instead of
// starting over -- EstimateDetail builds this from the estimate it loaded
// and passes the pieces in as the initial* props below.
export function estimateToWizardState(estimate: Estimate): {
  jobType: "residential" | "commercial";
  selections: Selections;
  customItems: Record<number, CustomItem[]>;
} {
  const commercialSectionNames = new Set(COMMERCIAL_STEPS.map((s) => s.section));
  const jobType: "residential" | "commercial" = estimate.sections.some((s) => commercialSectionNames.has(s.name))
    ? "commercial"
    : "residential";
  const steps = jobType === "commercial" ? COMMERCIAL_STEPS : WIZARD_STEPS;

  const selections: Selections = {};
  const customItems: Record<number, CustomItem[]> = {};

  steps.forEach((step, stepIdx) => {
    const section = estimate.sections.find((s) => s.name === step.section);
    if (!section) return;
    const itemGroup = new Map<string, number>();
    step.groups.forEach((g, gi) => g.items.forEach((it) => itemGroup.set(it.toLowerCase(), gi)));

    for (const line of section.lines) {
      let desc = line.description;
      // The wizard appends a customer-facing caveat to some items' descriptions
      // (ITEM_SCOPE_NOTES) -- strip it back off so the item still matches.
      for (const [item, note] of Object.entries(ITEM_SCOPE_NOTES)) {
        if (desc === `${item} -- ${note}`) {
          desc = item;
          break;
        }
      }
      // Auto-drafter-only companion lines (from the scope-of-work CLI/redraft,
      // never from this wizard) aren't a checklist item at all -- skip them
      // rather than adding them as a stray custom line.
      if (desc.startsWith("Rough-in wiring for: ")) continue;

      const gi = itemGroup.get(desc.toLowerCase());
      if (gi !== undefined) {
        const canonical = step.groups[gi].items.find((it) => it.toLowerCase() === desc.toLowerCase())!;
        selections[key(stepIdx, gi, canonical)] = { checked: true, qty: line.qty };
      } else {
        customItems[stepIdx] = [...(customItems[stepIdx] ?? []), { id: nextCustomId++, name: desc, qty: line.qty }];
      }
    }
  });

  return { jobType, selections, customItems };
}

export default function EstimateWizard({
  onClose,
  onCreated,
  jobId,
  estimateId,
  initialCustomer,
  initialAddress,
  initialCustomerEmail,
  initialProfitPct,
  initialDiscountPct,
  initialJobType,
  initialSelections,
  initialCustomItems,
}: {
  onClose: () => void;
  onCreated: (e: Estimate) => void;
  /** When opened from a job's page, links the new estimate to that job and
   * pre-fills customer/address from it (still editable on the intro step). */
  jobId?: number;
  /** When set, this is an existing estimate being re-walked through the
   * wizard ("Edit") rather than a new one -- finish() saves onto it instead
   * of creating a new estimate. */
  estimateId?: number;
  initialCustomer?: string;
  initialAddress?: string;
  initialCustomerEmail?: string;
  initialProfitPct?: string;
  initialDiscountPct?: string;
  initialJobType?: "residential" | "commercial";
  initialSelections?: Selections;
  initialCustomItems?: Record<number, CustomItem[]>;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<"intro" | number>("intro"); // "intro" = customer/address screen, else step index
  const [jobType, setJobType] = useState<"residential" | "commercial">(initialJobType ?? "residential");
  const [hasPlans, setHasPlans] = useState<boolean | null>(null);
  const activeSteps = jobType === "commercial" ? COMMERCIAL_STEPS : WIZARD_STEPS;
  const [customer, setCustomer] = useState(initialCustomer ?? "");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [customerEmail, setCustomerEmail] = useState(initialCustomerEmail ?? "");
  const [profitPct, setProfitPct] = useState(initialProfitPct ?? "20");
  const [discountPct, setDiscountPct] = useState(initialDiscountPct ?? "0");
  const [selections, setSelections] = useState<Selections>(initialSelections ?? {});
  // Tracks, per target step index, whether the "copy from rough-in" prompt
  // has already been answered (accepted or dismissed) so it doesn't nag
  // again every time the step re-renders.
  const [copyPromptHandled, setCopyPromptHandled] = useState<Record<number, boolean>>({});
  const [customItems, setCustomItems] = useState<Record<number, CustomItem[]>>(initialCustomItems ?? {});
  const [customName, setCustomName] = useState("");
  const [customQty, setCustomQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [savedItems, setSavedItems] = useState<ChecklistItem[]>([]);
  const [analyzingPlan, setAnalyzingPlan] = useState(false);
  const [planResult, setPlanResult] = useState<PlanAnalyzeResult | null>(null);
  const planFileInput = useRef<HTMLInputElement>(null);
  // Plan markup ("mark up a plan" button) creates its own draft estimate as
  // soon as it's opened, since pins need a real estimate_id to attach to --
  // finish() then PATCHes that same draft instead of creating a new one,
  // same as editing an existing estimate (estimateId prop) does.
  const [draftEstimateId, setDraftEstimateId] = useState<number | null>(null);
  const [planMarkupOpen, setPlanMarkupOpen] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const effectiveEstimateId = estimateId ?? draftEstimateId ?? undefined;

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

  // Residential and commercial steps live at different indices, so a
  // leftover "already handled" flag from one job type could wrongly
  // suppress (or wrongly show) the copy prompt after switching -- clear it
  // whenever jobType changes.
  useEffect(() => {
    setCopyPromptHandled({});
  }, [jobType]);

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

  // Checks off everything in targetStepIdx that's checked in sourceStepIdx
  // and shares an item name (case-insensitive) -- carries the same qty
  // over. Nothing is ever silently dropped: a checked item, a checked
  // "previously added" saved item, or a custom item that has no same-named
  // counterpart on the target step (a different pluralization like "GFCI
  // Outlet" vs "GFCI Outlets", or a genuinely one-off item) is instead
  // added to the target as its own custom item, so every checked thing on
  // the source step ends up represented on the target one way or another.
  const copySelectionsFromStep = (targetStepIdx: number, sourceStepIdx: number) => {
    const sourceStep = activeSteps[sourceStepIdx];
    const targetStep = activeSteps[targetStepIdx];
    const groupFilter = COPY_GROUP_FILTER[targetStep.section];
    const targetItemByName = new Map<string, { groupIdx: number; item: string }>();
    targetStep.groups.forEach((g, gi) => g.items.forEach((it) => targetItemByName.set(it.toLowerCase(), { groupIdx: gi, item: it })));
    const targetSavedNames = new Set(savedForStep(targetStepIdx).map((s) => s.label.toLowerCase()));
    const existingCustomNames = new Set((customItems[targetStepIdx] ?? []).map((c) => c.name.toLowerCase()));
    const toAddAsCustom: { name: string; qty: string }[] = [];

    setSelections((s) => {
      const next = { ...s };
      sourceStep.groups.forEach((g, gi) => {
        if (groupFilter && !groupFilter.includes(gi)) return;
        g.items.forEach((item) => {
          const sel = s[key(sourceStepIdx, gi, item)];
          if (!sel?.checked) return;
          const target = targetItemByName.get(item.toLowerCase());
          if (target) next[key(targetStepIdx, target.groupIdx, target.item)] = { checked: true, qty: sel.qty };
          else toAddAsCustom.push({ name: item, qty: sel.qty });
        });
      });
      for (const saved of savedForStep(sourceStepIdx)) {
        const sel = s[key(sourceStepIdx, "saved", saved.label)];
        if (!sel?.checked) continue;
        if (targetSavedNames.has(saved.label.toLowerCase())) {
          next[key(targetStepIdx, "saved", saved.label)] = { checked: true, qty: sel.qty };
        } else if (!groupFilter) {
          // Only dump an unmatched item as $0 custom clutter on a section
          // that wants the full copy (residential) -- a category-filtered
          // commercial target (switches/outlets/lighting only) has no group
          // to check a saved/custom item against, so skip it rather than
          // guess wrong.
          toAddAsCustom.push({ name: saved.label, qty: sel.qty });
        }
      }
      return next;
    });

    if (!groupFilter) {
      for (const custom of customItems[sourceStepIdx] ?? []) toAddAsCustom.push({ name: custom.name, qty: custom.qty });
    }

    const fresh = toAddAsCustom.filter((c) => !existingCustomNames.has(c.name.toLowerCase()));
    if (fresh.length > 0) {
      setCustomItems((c) => ({
        ...c,
        [targetStepIdx]: [...(c[targetStepIdx] ?? []), ...fresh.map((f) => ({ id: nextCustomId++, name: f.name, qty: f.qty }))],
      }));
    }
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

  // "Mark up a plan" places real catalog-matched line items by clicking
  // directly on the plan, so it needs a real estimate to attach pins to --
  // unlike the checklist/import-from-plan-sheet paths, which only build up
  // in-memory state until finish(). Reuses the same draft across repeat
  // clicks instead of creating a new one every time.
  const openPlanMarkup = async () => {
    if (draftEstimateId) {
      setPlanMarkupOpen(true);
      return;
    }
    setCreatingDraft(true);
    try {
      const est = await api<Estimate>("/estimates", {
        method: "POST",
        body: { job_id: jobId, customer, address, customer_email: customerEmail || undefined, scope_of_work: "", profit_pct: profitPct, discount_pct: discountPct },
      });
      setDraftEstimateId(est.id);
      setPlanMarkupOpen(true);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not start the plan markup");
    } finally {
      setCreatingDraft(false);
    }
  };

  // "Apply to estimate" on the plan markup screen hands back every marker
  // instead of writing lines itself -- totals per symbol type get checked
  // off (or, where nothing in the checklist matches, added as a custom
  // item) in the normal checklist steps, which the admin then reviews, can
  // still add to, and finishes exactly like any other estimate. This is
  // the one and only path that writes real lines for this draft, so there's
  // no risk of finish()'s full-section PATCH wiping anything the plan wrote
  // directly -- nothing was ever written directly.
  const applyPlanMarkersToChecklist = (markers: PlanMarker[]) => {
    const map = jobType === "commercial" ? COMMERCIAL_PLAN_MAP : RESIDENTIAL_PLAN_MAP;
    const steps = jobType === "commercial" ? COMMERCIAL_STEPS : WIZARD_STEPS;
    const roughInSection = jobType === "commercial" ? "Commercial Rough-In" : "Rough-In Electrical Work";
    const roughInStepIdx = steps.findIndex((s) => s.section === roughInSection);
    // A marker placed from the plan screen's full Rough-In item palette
    // carries that item's exact name as its label (e.g. "Recessed Lights"),
    // so look for a direct match in Rough-In before falling back to the
    // symbol type's generic bucket -- an AI-auto-layout marker's label
    // won't exactly match one of these and correctly falls through.
    const exactItemByLabel = new Map<string, { groupIdx: number; item: string }>();
    if (roughInStepIdx !== -1) {
      steps[roughInStepIdx].groups.forEach((g, gi) => g.items.forEach((it) => exactItemByLabel.set(it.toLowerCase(), { groupIdx: gi, item: it })));
    }

    const newSelections: Selections = {};
    const newCustom: Record<number, CustomItem[]> = {};
    let placed = 0;

    // A marker matched to a real catalog item (the admin linked it to one
    // while marking up the plan) carries that item's real cost -- route it
    // as its own priced custom item instead of a plain checklist checkbox,
    // which has no way to carry a per-pin price. Grouped by item so two
    // pins matched to the same item combine into one line.
    const matchedTotals = new Map<number, { name: string; material: string; qty: number }>();
    const unmatched: PlanMarker[] = [];
    for (const m of markers) {
      if (m.item_id && m.item_name) {
        const cur = matchedTotals.get(m.item_id);
        matchedTotals.set(m.item_id, {
          name: m.item_name,
          material: m.item_material_cost ?? "0",
          qty: (cur?.qty ?? 0) + (parseFloat(m.qty) || 0),
        });
      } else {
        unmatched.push(m);
      }
    }
    if (roughInStepIdx !== -1) {
      for (const { name, material, qty } of matchedTotals.values()) {
        if (qty <= 0) continue;
        newCustom[roughInStepIdx] = [
          ...(newCustom[roughInStepIdx] ?? []),
          { id: nextCustomId++, name, qty: String(qty), material },
        ];
        placed += 1;
      }
    }

    // Group the rest by label (not just symbol type) so differently-labeled
    // markers of the same type (e.g. "Recessed Lights" vs "Chandeliers",
    // both type "light") are counted and matched separately instead of
    // lumped.
    const totals = new Map<string, { symbolType: PlanSymbolType; qty: number }>();
    for (const m of unmatched) {
      const qty = parseFloat(m.qty) || 0;
      const cur = totals.get(m.label);
      totals.set(m.label, { symbolType: m.symbol_type, qty: (cur?.qty ?? 0) + qty });
    }

    // Adds to an existing selection's qty instead of overwriting it -- two
    // different-labeled plan markers (e.g. "Outlet, basement north wall"
    // and "Outlet, basement west wall", both type "duplex") land on the
    // SAME checklist item ("Duplex Outlets"), so without this the second
    // one silently replaced the first's count instead of combining with it.
    const addSelection = (k: string, qty: number) => {
      const cur = newSelections[k];
      newSelections[k] = { checked: true, qty: String((cur ? parseFloat(cur.qty) || 0 : 0) + qty) };
    };

    for (const [label, { symbolType, qty }] of totals) {
      if (qty <= 0) continue;
      const exact = roughInStepIdx !== -1 ? exactItemByLabel.get(label.toLowerCase()) : undefined;
      if (exact) {
        addSelection(key(roughInStepIdx, exact.groupIdx, exact.item), qty);
        placed += 1;
        continue;
      }
      for (const target of map[symbolType]) {
        const stepIdx = steps.findIndex((s) => s.section === target.section);
        if (stepIdx === -1) continue;
        if ("item" in target) {
          addSelection(key(stepIdx, target.groupIdx, target.item), qty);
        } else {
          newCustom[stepIdx] = [
            ...(newCustom[stepIdx] ?? []),
            { id: nextCustomId++, name: `${PLAN_SYMBOL_LABEL[symbolType]} (from plan)`, qty: String(qty) },
          ];
        }
      }
      placed += 1;
    }

    setSelections((s) => ({ ...s, ...newSelections }));
    if (Object.keys(newCustom).length) {
      setCustomItems((c) => {
        const next = { ...c };
        for (const [stepIdx, items] of Object.entries(newCustom)) next[Number(stepIdx)] = [...(next[Number(stepIdx)] ?? []), ...items];
        return next;
      });
    }
    setPlanMarkupOpen(false);
    setPhase(0);
    toast("success", `Checked off ${placed} item type${placed === 1 ? "" : "s"} from the plan -- review before finishing.`);
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
          ...(custom.material !== undefined
            ? { material_unit_cost: custom.material, labor_unit_cost: custom.labor ?? step.defaultLabor }
            : costFor(custom.name, step)),
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
      // effectiveEstimateId also covers a draft created by "Mark up a plan"
      // that was then cancelled before anything was applied to it -- safe to
      // PATCH since no plan-markup lines exist on it yet (applying always
      // closes the wizard immediately, so finish() can't run after that).
      if (effectiveEstimateId) {
        const full = await api<Estimate>(`/estimates/${effectiveEstimateId}`, {
          method: "PATCH",
          body: {
            customer, address, customer_email: customerEmail || null,
            scope_of_work: buildScopeOfWork(), profit_pct: profitPct, discount_pct: discountPct,
            sections: buildSections(),
          },
        });
        onCreated(full);
        return;
      }
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
      toast("error", e instanceof Error ? e.message : `Could not ${effectiveEstimateId ? "save" : "create"} estimate`);
      setSaving(false);
    }
  };

  const stepIdx = typeof phase === "number" ? phase : -1;
  const totalSteps = activeSteps.length;
  const copySourceSection = stepIdx !== -1 ? COPY_FROM_SECTION[activeSteps[stepIdx]?.section] : undefined;
  const copySourceIdx = copySourceSection ? activeSteps.findIndex((s) => s.section === copySourceSection) : -1;
  const showCopyPrompt =
    stepIdx !== -1 && copySourceIdx !== -1 && selectedCount(copySourceIdx) > 0 && !copyPromptHandled[stepIdx];

  return (
    <Sheet
      title={phase === "intro" ? (estimateId ? "Edit estimate" : "New estimate") : `${stepIdx + 1}. ${activeSteps[stepIdx].section}`}
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
            <div>
              <button
                type="button"
                className="btn-secondary w-full"
                disabled={creatingDraft}
                onClick={openPlanMarkup}
              >
                {creatingDraft ? <Spinner /> : <Icon name="pencil" size={16} />}
                {creatingDraft ? "Starting…" : "Mark up a plan"}
              </button>
              <p className="mt-1.5 text-[12px] text-slate-400 dark:text-slate-500">
                Upload a plan PDF, click symbols directly onto it, match them to real catalog items, and create
                the estimate from exactly what you placed -- skips the checklist below.
              </p>
            </div>
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

            {showCopyPrompt && (
              <div className="card flex items-center justify-between gap-3 border-brand-500/40 bg-brand-500/5 p-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium">
                    Use the same items you picked for {activeSteps[copySourceIdx].section}?
                  </p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">
                    Checks off everything here that matches, with the same quantities.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary !px-3 !py-1.5 text-[13px]"
                    onClick={() => setCopyPromptHandled((h) => ({ ...h, [phase]: true }))}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    className="btn-primary !px-3 !py-1.5 text-[13px]"
                    onClick={() => {
                      copySelectionsFromStep(phase, copySourceIdx);
                      setCopyPromptHandled((h) => ({ ...h, [phase]: true }));
                    }}
                  >
                    Yes
                  </button>
                </div>
              </div>
            )}

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
              {effectiveEstimateId ? "Save changes" : "Create estimate"}
            </button>
          ) : (
            <button className="btn-primary flex-1" onClick={() => setPhase(stepIdx + 1)}>
              Next{selectedCount(stepIdx) > 0 ? ` (${selectedCount(stepIdx)} selected)` : ""}
              <Icon name="arrow-right" size={16} />
            </button>
          )}
        </div>
      </div>

      {planMarkupOpen && draftEstimateId && (
        <PlanMarkupSheet
          estimateId={draftEstimateId}
          jobType={jobType}
          // Applying hands the markers to applyPlanMarkersToChecklist
          // instead of writing lines itself (see onApplyToChecklist below),
          // which closes this sheet and jumps into the checklist steps on
          // its own -- so closing here (X / Done, with nothing applied
          // yet) just returns to the intro screen, nothing special to do.
          onClose={() => setPlanMarkupOpen(false)}
          onApplyToChecklist={applyPlanMarkersToChecklist}
        />
      )}
    </Sheet>
  );
}
