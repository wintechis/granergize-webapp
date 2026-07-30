/**
 * Codegen: emit the bundled example workbooks the app offers in the
 * Add-building "Autofill from file" sub-flow ("Try an example file"), so the
 * example data flows through the SAME import pipeline as real customer data —
 * there is no programmatic demo seed any more.
 *
 * The pipeline transforms the native L.Immo online extract
 * (`scripts/data/L.Immo-online-Objektdaten-Auszug Nürnberg_2025-07-01.xlsx` —
 * 37 real logistics buildings around Nürnberg; master data + WGS84 coordinates
 * only) into the importer's GENERIC flat layout, enriched with DETERMINISTIC
 * SYNTHETIC energy (FNV-1a hash of ID+metric+year, no randomness): annual
 * electricity/heat/water 2022–2024 for every building, scaled by floor area
 * with WZ-code intensities and an age factor, plus PV + `_inv_gen_*` yield on
 * one building and a fully-populated investor block on the flagship — see
 * {@link FEATURES}.
 *
 * Artifacts (all committed; the generator skips a write when the file would
 * parse identically, so re-running it leaves a clean tree):
 *  - `public/examples/limmo-nuernberg.xlsx` — all 37 buildings, generic flat
 *    layout (one row per building, `_inv_*` per-year energy columns);
 *  - `public/examples/beispiel-portfolio.xlsx` — the previous fictional
 *    4-building set as an investor row-label sheet (buildings in cols D–G;
 *    content in `scripts/data/fictionalExamples.ts` — no coordinates, so this
 *    file demonstrates geocode-on-import);
 *  - `public/examples/lastgang-am-tower-10.xlsx` — a 14-day 15-minute load
 *    profile (Lastgang) with a weekday/weekend-scaled synthetic curve;
 *  - `test/e2e/fixtures/limmo-core.xlsx` — the 6-building {@link CORE_IDS}
 *    subset the browser test lanes import (runtime parity with the old
 *    core seed).
 *
 * NOT representable in the import layouts (entered in-app instead): planned
 * (Soll) datasets, `operatedBy`/`ownedBy` self-links (WebID unknown here —
 * applied by the example loader, see `src/constants/exampleFiles.ts`), and a
 * series+annual combination on one building (a Lastgang file always creates
 * its own building).
 *
 * Run via `deno task gen:examples`; the freshness test
 * (`genExampleFiles.test.ts`) regenerates in memory and compares PARSED
 * records (xlsx bytes are not stable across writes), doubling as the
 * import-contract test for every bundled file.
 */

import * as XLSX from "xlsx";
import {
  detectSpreadsheetFormat,
  parseCsvToFields,
} from "../src/services/rdf/building/buildingImport.ts";
import {
  certLevelLabel,
  INV_YEAR_ROW_STEMS,
  INVESTOR_CERT_SYSTEMS,
  INVESTOR_OPCOST_ROW_MAP,
  INVESTOR_ROW_MAP,
  type SpreadsheetFormat,
} from "../src/services/xlsx/buildingTemplates.ts";
import {
  type Cell,
  newSheet,
  sheetToBytes,
  writeInvestorPortfolioSheet,
  writeTableSheet,
} from "../src/services/xlsx/buildingWorkbook.ts";
import { synthDayReadings } from "../src/services/xlsx/energySeriesXlsx.ts";
import {
  FICTIONAL_EXAMPLES,
  type FictionalSpec,
} from "./data/fictionalExamples.ts";

export const XLSX_PATH =
  "scripts/data/L.Immo-online-Objektdaten-Auszug Nürnberg_2025-07-01.xlsx";

export const LIMMO_OUT = "public/examples/limmo-nuernberg.xlsx";
export const PORTFOLIO_OUT = "public/examples/beispiel-portfolio.xlsx";
export const LASTGANG_OUT = "public/examples/lastgang-am-tower-10.xlsx";
export const CORE_OUT = "test/e2e/fixtures/limmo-core.xlsx";

/** One row of the L.Immo example sheet: importer field map + `_inv_*` energy. */
export interface ExampleSpec {
  fields: Record<string, string>;
  annual: Record<string, string>;
}

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

function synthAnnual(row: LImmoRow, yoc: number | null): Record<string, string> {
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
  for (const year of YEARS) {
    for (const metric of ["elec", "heat", "water"] as const) {
      const v = row.flaeche * intensity[metric] * TREND[year] *
        jitter(fnv1a(`${row.id}:${metric}:${year}`), 0.03);
      annual[`_inv_${metric}_${year}`] = String(
        roundTo(v, metric === "water" ? 10 : 100),
      );
    }
  }
  return annual;
}

// ── Feature-coverage overrides ───────────────────────────────────────────────

/**
 * Per-building overrides preserving the feature coverage of the example set.
 * Concrete picks (by extract ID):
 *  - 16074 Dachser, Thomas-Dachser-Str. 4, Nürnberg — the flagship: a
 *    SYNTHETIC investor block (lease/certification/operating costs/heat
 *    systems) so the fully-populated detail panel showcase survives — those
 *    fields are NOT in the extract. (Its planned/Soll dataset and its
 *    `operatedBy` self-link don't fit the file format — entered in-app.)
 *  - 14235 Loxxess, Steinauer Weg 7, Aurach — synthetic rooftop PV +
 *    `_inv_gen_*` yield → the generation map lens has data to colour.
 *  - 4212 NORDFROST, Fürth — cold store usedAs + intensity overrides (above).
 * The 15-minute series lives in the separate Lastgang example file
 * ({@link LASTGANG_OUT}); `selfOperated`/`selfOwned` marks are applied at
 * import time by the example loader (`src/constants/exampleFiles.ts`).
 */
interface FeatureOverride {
  extraFields?: Record<string, string>;
  /** Synthetic PV: nameplate kWp → `_pv_*` fields + `_inv_gen_*` yield. */
  pvKWp?: number;
  usedAs?: string;
}

const FEATURES: Record<number, FeatureOverride> = {
  16074: {
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
  4212: { usedAs: "Cold storage" },
};

/** PV yield assumption per year (kWh/kWp, southern Germany rooftop). */
const PV_YIELD: Record<number, number> = { 2022: 950, 2023: 970, 2024: 940 };

/**
 * The curated subset the browser test lanes import
 * (`test/e2e/fixtures/limmo-core.xlsx`): the flagship, the PV/generation
 * building, the two buildings the specs pair with series/planned data entered
 * in-app (Am Tower 10, Koperstr. 3), the cold store (locality spread: Fürth)
 * and one plain-annual building — every shape the e2e specs assert on, at an
 * import cost close to the old 4-building seed.
 */
export const CORE_IDS = [16074, 14235, 4095, 3951, 4212, 16167];

// ── Row → ExampleSpec mapping ────────────────────────────────────────────────

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

export function buildSpecs(rows: LImmoRow[]): ExampleSpec[] {
  return [...rows].sort((a, b) => a.id - b.id).map((row): ExampleSpec => {
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
      // Coordinates come from the extract — the import adopts them instead of
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
    const annual = synthAnnual(row, yoc);
    if (feat.pvKWp) {
      for (const year of YEARS) {
        annual[`_inv_gen_${year}`] = String(roundTo(
          feat.pvKWp * PV_YIELD[year] * jitter(fnv1a(`${row.id}:gen:${year}`), 0.03),
          100,
        ));
      }
    }
    return { fields, annual };
  });
}

// ── Sheet rendering ──────────────────────────────────────────────────────────

// Fields whose values must stay TEXT cells: identifiers where a numeric render
// could reformat them (a leading-zero PLZ, a trailing-zero NACE minor code) and
// coordinates (a float cell renders at ≤11 significant digits).
const KEEP_TEXT = new Set([
  "postalCode",
  "buildingCode",
  "naceCode",
  "lat",
  "long",
]);
const NUM_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Numeric-looking values become number cells (clean, summable columns);
 * everything else stays text. Round-trip safe: the importer's normalization
 * maps both renderings back to the same field string. */
function typedCell(field: string, v: string): string | number {
  return !KEEP_TEXT.has(field) && NUM_RE.test(v) ? Number(v) : v;
}

function flatRecord(spec: ExampleSpec): Record<string, string | number> {
  const rec: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(spec.fields)) rec[k] = typedCell(k, v);
  for (const [k, v] of Object.entries(spec.annual)) rec[k] = typedCell(k, v);
  return rec;
}

/** The generic flat workbook (one row per building) for `specs`. */
export async function limmoBytes(specs: ExampleSpec[]): Promise<Uint8Array> {
  const ws = await newSheet();
  writeTableSheet(ws, specs.map(flatRecord));
  return new Uint8Array(await sheetToBytes(ws));
}

/** The investor row-label portfolio workbook (buildings in cols D…). */
export async function portfolioBytes(
  specs: readonly FictionalSpec[],
): Promise<Uint8Array> {
  const n = specs.length;
  const rows: Cell[][] = [];
  const push = (label: string, values: Cell[]) => {
    if (values.some((v) => v !== null)) rows.push([null, label, null, ...values]);
  };
  const fieldCells = (field: string): Cell[] =>
    specs.map((s) => {
      const v = s.fields[field];
      return v == null ? null : typedCell(field, v);
    });

  for (const [label, field] of Object.entries(INVESTOR_ROW_MAP)) {
    push(label, fieldCells(field));
  }
  const years = [
    ...new Set(
      specs.flatMap((s) => Object.keys(s.annual ?? {}))
        .map((k) => k.match(/_(\d{4})$/)?.[1])
        .filter((y): y is string => !!y).map(Number),
    ),
  ].sort((a, b) => a - b);
  for (const year of years) {
    for (const { label, key } of INV_YEAR_ROW_STEMS) {
      push(
        `${label} ${year}`,
        specs.map((s) => {
          const v = s.annual?.[`_inv_${key}_${year}`];
          return v == null ? null : Number(v);
        }),
      );
    }
  }
  for (const [label, field] of Object.entries(INVESTOR_OPCOST_ROW_MAP)) {
    push(label, specs.map((s) => s.fields[`_opcost_${field}`] ?? null));
  }
  for (const sys of INVESTOR_CERT_SYSTEMS) {
    push(sys, specs.map((s) => (s.fields._cert_0_type === sys ? "Ja" : null)));
    push(
      certLevelLabel(sys),
      specs.map((s) =>
        s.fields._cert_0_type === sys ? s.fields._cert_0_level ?? null : null
      ),
    );
  }

  const ws = await newSheet();
  writeInvestorPortfolioSheet(ws, rows, n);
  return new Uint8Array(await sheetToBytes(ws));
}

// ── Lastgang example ─────────────────────────────────────────────────────────

export const LASTGANG_LABEL = "Am Tower 10";
export const LASTGANG_START = "2024-06-01";
export const LASTGANG_DAYS = 14;

/**
 * A Lastgang (utility load-profile) workbook: a "Marktlokation Name" header
 * row, then one row per 15-minute slot — col A = END-of-interval timestamp
 * (German format, Europe/Berlin — the June dates are all CEST/UTC+2), col B =
 * average power in kW. `parseLastgangXlsx` reads exactly this shape. The curve
 * is the synthetic daytime-peaked day, scaled by a deterministic
 * weekday/weekend factor (as the old seed's series was).
 */
export async function lastgangBytes(): Promise<Uint8Array> {
  const ws = await newSheet();
  const header = ws.addRow(["Marktlokation Name", LASTGANG_LABEL]);
  header.getCell(1).font = { bold: true };
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 12;

  const start = new Date(`${LASTGANG_START}T00:00:00Z`).getTime();
  for (let i = 0; i < LASTGANG_DAYS; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
    const factor = dow === 0 || dow === 6 ? 0.5 : 0.9 + (i % 5) * 0.05;
    for (const r of synthDayReadings(date)) {
      // End-of-interval Berlin wall time (CEST in June: UTC+2).
      const end = new Date(new Date(r.endTs).getTime() + 2 * 3_600_000);
      const ts = `${end.getUTCDate()}.${end.getUTCMonth() + 1}.${end.getUTCFullYear()} ${
        String(end.getUTCHours()).padStart(2, "0")
      }:${String(end.getUTCMinutes()).padStart(2, "0")}`;
      const kw = Number((parseFloat(r.valueKwh) * 4 * factor).toFixed(4));
      ws.addRow([ts, kw]);
    }
  }
  return new Uint8Array(await sheetToBytes(ws));
}

// ── Write-if-changed (xlsx bytes are unstable; compare parsed records) ───────

async function parsedView(
  bytes: Uint8Array,
  name: string,
): Promise<{ format: SpreadsheetFormat; json: string }> {
  const file = new File([bytes.slice() as Uint8Array<ArrayBuffer>], name);
  const format = await detectSpreadsheetFormat(file);
  const records = await parseCsvToFields(file, format);
  return { format, json: JSON.stringify(records) };
}

async function writeArtifact(path: string, bytes: Uint8Array): Promise<void> {
  const existing = await Deno.readFile(path).catch(() => null);
  const next = await parsedView(bytes, path);
  if (existing) {
    const prev = await parsedView(existing, path);
    if (prev.format === next.format && prev.json === next.json) {
      console.log(`${path} unchanged (${next.format})`);
      return;
    }
  }
  await Deno.mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await Deno.writeFile(path, bytes);
  console.log(`wrote ${path} (${next.format})`);
}

async function main(): Promise<void> {
  const rows = readRows(await Deno.readFile(XLSX_PATH));
  const specs = buildSpecs(rows);
  const coreCodes = new Set(CORE_IDS.map((id) => `LI-${id}`));
  await writeArtifact(LIMMO_OUT, await limmoBytes(specs));
  await writeArtifact(
    CORE_OUT,
    await limmoBytes(specs.filter((s) => coreCodes.has(s.fields.buildingCode))),
  );
  await writeArtifact(PORTFOLIO_OUT, await portfolioBytes(FICTIONAL_EXAMPLES));
  await writeArtifact(LASTGANG_OUT, await lastgangBytes());
}

if (import.meta.main) main();
