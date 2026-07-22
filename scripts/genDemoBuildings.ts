/**
 * Codegen: derive the demo-building seed set from the L.Immo online extract
 * (`scripts/data/L.Immo-online-Objektdaten-Auszug Nürnberg_2025-07-01.xlsx` —
 * 37 real logistics buildings around Nürnberg), emitting
 * `src/services/rdf/building/demoBuildings.generated.ts`.
 *
 * The extract carries master data only (occupant, WZ code, construction-year
 * range, floor area, address, WGS84 coordinates). Everything energy-related is
 * SYNTHETIC, computed here at generation time — deterministically (FNV-1a hash
 * of ID+metric+year, no randomness), so re-running the generator is idempotent
 * and the seed does no number-crunching at runtime:
 *   - annual electricity/heat/water 2022–2024 for every building, scaled by
 *     floor area with WZ-code intensities and an age factor;
 *   - a 15-minute load-profile series on two buildings (the Annual | Time
 *     series toggle), a planned (Soll) 2024 dataset on one (the Soll-Ist
 *     pair), PV + generation figures on one (the generation map lens), and
 *     `selfOperated`/`selfOwned` on a few (the Betreiber benchmark needs ≥2
 *     buildings sharing an operator) — see {@link FEATURES}.
 *
 * Run via `deno task gen:demo-buildings`; the freshness test
 * (`genDemoBuildings.test.ts`) regenerates in memory and asserts equality
 * against the committed module, so data and generator can't drift.
 */

import * as XLSX from "xlsx";
import type { DemoSpec } from "../src/services/rdf/building/demoSpec.ts";

export const XLSX_PATH =
  "scripts/data/L.Immo-online-Objektdaten-Auszug Nürnberg_2025-07-01.xlsx";
const OUT_PATH = "src/services/rdf/building/demoBuildings.generated.ts";

/** One data row of the extract (header names as in the sheet). */
export interface LImmoRow {
  id: number;
  nutzer: string;
  wz: number;
  baujahr: string;
  flaeche: number;
  strasse: string;
  hausNr: string;
  plz: string;
  ort: string;
  bundesland: string;
  long: number;
  lat: number;
}

/** Read + validate the extract's single sheet into typed rows. */
export function readRows(bytes: Uint8Array): LImmoRow[] {
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
  });
  const rows = raw.map((r): LImmoRow => ({
    id: Number(r["ID"]),
    nutzer: String(r["Nutzer"]).trim(),
    wz: Number(r["WZ-Code"]),
    baujahr: String(r["Baujahr"]).trim(),
    flaeche: Number(r["Gebäudefläche"]),
    strasse: String(r["Straße"]).trim(),
    hausNr: String(r["Haus-Nr."]).trim(),
    plz: String(r["PLZ"]).padStart(5, "0"),
    ort: String(r["Ort"]).trim(),
    bundesland: String(r["Bundesland"]).trim(),
    long: Number(r["Längengrad"]),
    lat: Number(r["Breitengrad"]),
  }));
  if (rows.length !== 37) {
    throw new Error(`expected 37 data rows, got ${rows.length}`);
  }
  const ids = new Set(rows.map((r) => r.id));
  if (ids.size !== rows.length) throw new Error("duplicate IDs in extract");
  for (const r of rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.long)) {
      throw new Error(`row ${r.id}: missing coordinates`);
    }
    if (!Number.isFinite(r.flaeche) || r.flaeche <= 0) {
      throw new Error(`row ${r.id}: missing floor area`);
    }
  }
  return rows;
}

// ── Deterministic synthesis ──────────────────────────────────────────────────

/** FNV-1a 32-bit — the deterministic stand-in for randomness. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Multiplier in [1-amp, 1+amp], derived from the hash. */
const jitter = (h: number, amp: number): number =>
  1 + ((h % 10_000) / 10_000 - 0.5) * 2 * amp;

const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

/** Electricity intensity (kWh/m²a) by WZ division. */
const ELEC_BY_WZ: Record<number, number> = { 49: 28, 52: 32, 53: 45, 64: 30 };
const HEAT_BASE = 60; // kWh/m²a before the age factor
const WATER_INTENSITY = 0.09; // m³/m²a
const YEARS = [2022, 2023, 2024] as const;
const TREND: Record<number, number> = { 2022: 1.05, 2023: 1.0, 2024: 0.95 };

/** Older stock heats worse; recent builds better. Missing year → oldest. */
const ageFactor = (yoc: number | null): number =>
  yoc === null ? 1.2 : yoc < 1996 ? 1.2 : yoc < 2006 ? 1.1 : yoc < 2016 ? 1.0 : 0.8;

/** NORDFROST (ID 4212): frozen-food logistics — electricity-heavy, low heat. */
const NORDFROST_ID = 4212;

interface Synth {
  annual: Record<string, string>;
  /** Raw (unrounded-key) 2024 actuals — the planned dataset derives from them. */
  actual2024: { elec: number; heat: number; water: number };
}

function synthAnnual(row: LImmoRow, yoc: number | null): Synth {
  const elecBase = (ELEC_BY_WZ[row.wz] ?? 30) *
    (row.id === NORDFROST_ID ? 2.2 : 1);
  const heatBase = HEAT_BASE * ageFactor(yoc) *
    (row.id === NORDFROST_ID ? 0.4 : 1);
  const intensity = {
    elec: elecBase * jitter(fnv1a(`${row.id}:elec`), 0.2),
    heat: heatBase * jitter(fnv1a(`${row.id}:heat`), 0.2),
    water: WATER_INTENSITY * jitter(fnv1a(`${row.id}:water`), 0.2),
  };
  const annual: Record<string, string> = {};
  const actual2024 = { elec: 0, heat: 0, water: 0 };
  for (const year of YEARS) {
    for (const metric of ["elec", "heat", "water"] as const) {
      const v = row.flaeche * intensity[metric] * TREND[year] *
        jitter(fnv1a(`${row.id}:${metric}:${year}`), 0.03);
      const rounded = roundTo(v, metric === "water" ? 10 : 100);
      annual[`_inv_${metric}_${year}`] = String(rounded);
      if (year === 2024) actual2024[metric] = rounded;
    }
  }
  return { annual, actual2024 };
}

// ── Feature-coverage overrides ───────────────────────────────────────────────

/**
 * Per-building overrides preserving the feature coverage the old 4-building
 * demo set had. Concrete picks (by extract ID):
 *  - 16074 Dachser, Thomas-Dachser-Str. 4, Nürnberg — the flagship: planned
 *    (Soll) 2024 dataset → Soll-Ist pair, selfOperated, plus a SYNTHETIC
 *    investor block (lease/certification/operating costs/heat systems) so the
 *    fully-populated detail panel showcase survives — those fields are NOT in
 *    the extract.
 *  - 14235 Loxxess, Steinauer Weg 7, Aurach — synthetic rooftop PV +
 *    `_inv_gen_*` yield → the generation map lens has data to colour.
 *  - 4095 DHL, Am Tower 10, Nürnberg — `both` shapes (14 series days) →
 *    Annual | Time series toggle; selfOperated + selfOwned.
 *  - 3951 Raben, Koperstr. 3, Nürnberg — `both` (7 days), selfOperated +
 *    selfOwned.
 *  - 3632 Faber Castell, Erlangen — selfOperated + selfOwned (owner-occupier).
 *  - 4212 NORDFROST, Fürth — cold store usedAs + intensity overrides (above).
 * The Betreiber benchmark group (≥2 selfOperated with annual data) is
 * {16074, 4095, 3951, 3632}.
 */
interface FeatureOverride {
  extraFields?: Record<string, string>;
  energy?: DemoSpec["energy"];
  seriesDays?: number;
  selfOperated?: boolean;
  selfOwned?: boolean;
  /** Add a planned (Soll) 2024 dataset at ~95 % of the synthetic actuals. */
  planned?: boolean;
  /** Synthetic PV: nameplate kWp → `_pv_*` fields + `_inv_gen_*` yield. */
  pvKWp?: number;
  usedAs?: string;
}

const FEATURES: Record<number, FeatureOverride> = {
  16074: {
    selfOperated: true,
    planned: true,
    extraFields: {
      leaseType: "Triple net",
      tenancyType: "SingleTenant",
      shiftRegime: "TwoShift",
      indoorTemperatureClass: "MaxEighteenDegrees",
      numberOfLoadingDocks: "30",
      _cert_0_type: "DGNB",
      _cert_0_level: "Gold",
      _cert_0_scope: "Existing building",
      _opcost_propertyManagement: "Medium",
      _opcost_operationInspectionAndMaintenance: "High",
      _gasboiler_present: "true",
      _gasboiler_thermalCapacityKW: "900",
      _gasboiler_commissioningYear: "2006",
      _heatpump_present: "true",
      _heatpump_thermalCapacityKW: "250",
      _heatpump_commissioningYear: "2019",
    },
  },
  14235: { pvKWp: 1200 },
  4095: { energy: "both", seriesDays: 14, selfOperated: true, selfOwned: true },
  3951: { energy: "both", seriesDays: 7, selfOperated: true, selfOwned: true },
  3632: { selfOperated: true, selfOwned: true },
  4212: { usedAs: "Cold storage" },
};

/** PV yield assumption per year (kWh/kWp, southern Germany rooftop). */
const PV_YIELD: Record<number, number> = { 2022: 950, 2023: 970, 2024: 940 };

/**
 * The curated subset seeded in the browser test lanes (`VITE_DEMO_SEED=core`):
 * every energy shape the e2e specs assert on, at a seed cost close to the old
 * 4-building set. See the module comment in the generated file.
 */
const CORE_IDS = [16074, 14235, 4095, 3951, 4212, 16167];

// ── Row → DemoSpec mapping ───────────────────────────────────────────────────

const ORT_NORMALIZE: Record<string, string> = {
  "Nuernberg I": "Nürnberg",
  "Nuernberg": "Nürnberg",
};

const USED_AS_BY_WZ: Record<number, string> = {
  49: "Freight transport depot",
  52: "Logistics warehouse",
  53: "Parcel and courier hub",
  64: "Logistics park",
};

/** "2001-2005" → 2001; "<1990" (no lower bound) → null (field omitted). */
export function yearFromRange(baujahr: string): number | null {
  if (baujahr.startsWith("<")) return null;
  const m = baujahr.match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

export function buildSpecs(rows: LImmoRow[]): DemoSpec[] {
  return [...rows].sort((a, b) => a.id - b.id).map((row): DemoSpec => {
    const feat = FEATURES[row.id] ?? {};
    const yoc = yearFromRange(row.baujahr);
    const fields: Record<string, string> = {
      streetAddress: `${row.strasse} ${row.hausNr}`.trim(),
      postalCode: row.plz,
      locality: ORT_NORMALIZE[row.ort] ?? row.ort,
      region: row.bundesland,
      customer: row.nutzer,
      usedAs: feat.usedAs ?? USED_AS_BY_WZ[row.wz] ?? "Logistics",
      naceCode: String(row.wz),
      buildingArea: String(row.flaeche),
      buildingCode: `LI-${row.id}`,
      ...(yoc !== null ? { yearOfConstruction: String(yoc) } : {}),
      // Coordinates come from the extract — the seed adopts them instead of
      // geocoding the address (the region AGS is still resolved from them).
      lat: String(row.lat),
      long: String(row.long),
      geocodePrecision: "Address",
      ...(feat.pvKWp
        ? {
          _pv_capacityKW: String(feat.pvKWp),
          _pv_commissioningYear: "2021",
        }
        : {}),
      ...(feat.extraFields ?? {}),
    };
    const { annual, actual2024 } = synthAnnual(row, yoc);
    if (feat.pvKWp) {
      for (const year of YEARS) {
        annual[`_inv_gen_${year}`] = String(roundTo(
          feat.pvKWp * PV_YIELD[year] * jitter(fnv1a(`${row.id}:gen:${year}`), 0.03),
          100,
        ));
      }
    }
    return {
      fields,
      energy: feat.energy ?? "annual",
      annual,
      ...(feat.seriesDays ? { seriesDays: feat.seriesDays } : {}),
      ...(feat.selfOperated ? { selfOperated: true } : {}),
      ...(feat.selfOwned ? { selfOwned: true } : {}),
      ...(feat.planned
        ? {
          planned: {
            year: 2024,
            metrics: {
              electricityConsumption: roundTo(actual2024.elec * 0.95, 100),
              heatConsumption: roundTo(actual2024.heat * 0.95, 100),
              waterConsumption: roundTo(actual2024.water * 0.95, 10),
            },
          },
        }
        : {}),
    };
  });
}

// ── Module rendering ─────────────────────────────────────────────────────────

export function renderModule(specs: DemoSpec[], sourceSha256: string): string {
  const sourceName = XLSX_PATH.split("/").pop();
  return `// AUTO-GENERATED by \`deno task gen:demo-buildings\` (scripts/genDemoBuildings.ts)
// from \`${sourceName}\` — do not edit by hand.
// Source SHA-256: ${sourceSha256}
//
// 37 real logistics buildings (L.Immo online extract, Nürnberg region) with
// coordinates from the extract and DETERMINISTIC SYNTHETIC energy data — see
// the generator for the synthesis model and the feature-coverage picks
// (series/planned/PV/selfOperated buildings).
import type { DemoSpec } from "./demoSpec.ts";

export const DEMO_BUILDINGS: readonly DemoSpec[] = ${
    JSON.stringify(specs, null, 2)
  };

/**
 * Curated subset for the browser test lanes (\`VITE_DEMO_SEED=core\`): the
 * flagship (planned/Soll pair), the PV/generation building, both series
 * buildings, the cold store (locality spread: Fürth) and one plain-annual
 * building — every shape the e2e specs assert on, at a seed cost close to the
 * old 4-building set. The full set stays covered by the unit seed tests and
 * the headless \`seed-demos\` task.
 */
const CORE_CODES = new Set(${JSON.stringify(CORE_IDS.map((id) => `LI-${id}`))});
export const DEMO_BUILDINGS_CORE: readonly DemoSpec[] = DEMO_BUILDINGS.filter(
  (b) => CORE_CODES.has(b.fields.buildingCode),
);
`;
}

async function main(): Promise<void> {
  const bytes = await Deno.readFile(XLSX_PATH);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const specs = buildSpecs(readRows(bytes));
  await Deno.writeTextFile(OUT_PATH, renderModule(specs, sha));
  console.log(`wrote ${OUT_PATH} (${specs.length} buildings, source ${sha.slice(0, 12)}…)`);
}

if (import.meta.main) main();
