/**
 * Derive the browser lanes' core building fixture from the committed L.Immo
 * example workbook.
 *
 * The bundled example workbooks under `public/examples/` are **source files,
 * not build outputs** — the example data lives in the spreadsheets and nowhere
 * else:
 *  - `limmo-nuernberg.xlsx` — 37 logistics buildings around Nürnberg in the
 *    importer's generic flat layout: master data, WGS84 coordinates, annual
 *    electricity/heat/water 2022–2024, rooftop PV + `_inv_gen_*` on one
 *    building and a fully-populated investor block on the flagship;
 *  - `beispiel-portfolio.xlsx` — 4 fictional buildings as an investor row-label
 *    sheet, without coordinates (so this file demonstrates geocode-on-import);
 *  - `lastgang-am-tower-10.xlsx` — a 14-day 15-minute load profile.
 * Edit them as spreadsheets; nothing regenerates them. What the layouts cannot
 * carry (planned/Soll datasets, `operatedBy`/`ownedBy` self-links, a series and
 * an annual aggregate on ONE building) is supplied around them — see
 * `src/constants/exampleFiles.ts` and `notes/storage-layout.md`.
 *
 * Their content used to be emitted by a codegen pipeline that read a native
 * L.Immo extract and bolted deterministic synthetic energy and technical
 * systems onto it. That pipeline is gone by decision — recover it from git
 * (`git show a62a680:scripts/genExampleFiles.ts`) if the synthesis is ever
 * wanted again; the native extract stays in `scripts/data/` as provenance.
 *
 * The ONE derived artifact is `test/e2e/fixtures/limmo-core.xlsx`: the
 * {@link CORE_CODES} subset of the L.Immo workbook, kept as its own file so the
 * browser lanes import 6 buildings instead of 37. Deriving it — rather than
 * committing a second hand-maintained sheet — is what stops the fixture from
 * drifting away from the example the app actually ships.
 *
 * Run via `deno task gen:core-fixture`. Re-running is a no-op: the write is
 * skipped when the file would parse identically (xlsx bytes are not stable
 * across writes, so the comparison is on PARSED records).
 */

import * as XLSX from "xlsx";
import {
  detectSpreadsheetFormat,
  parseCsvToFields,
} from "../src/services/rdf/building/buildingImport.ts";
import type { SpreadsheetFormat } from "../src/services/xlsx/buildingTemplates.ts";
import {
  newSheet,
  sheetToBytes,
  writeTableSheet,
} from "../src/services/xlsx/buildingWorkbook.ts";

/** The bundled example workbooks (sources — hand-maintained, never emitted). */
export const LIMMO_SRC = "public/examples/limmo-nuernberg.xlsx";
export const PORTFOLIO_SRC = "public/examples/beispiel-portfolio.xlsx";
export const LASTGANG_SRC = "public/examples/lastgang-am-tower-10.xlsx";

/** The single derived artifact. */
export const CORE_OUT = "test/e2e/fixtures/limmo-core.xlsx";

/**
 * The curated subset the browser test lanes import: the flagship, the
 * PV/generation building, the two buildings the specs pair with series/planned
 * data entered in-app, the cold store (locality spread: Fürth) and one
 * plain-annual building — every shape the e2e specs assert on, at an import
 * cost close to the old 4-building seed.
 */
export const CORE_CODES = [
  "LI-3951", // Koperstr. 3, Nürnberg — plain annual, paired with series in-app
  "LI-4095", // Am Tower 10, Nürnberg — the Lastgang example's address
  "LI-4212", // Aischweg 2, Fürth — cold store (usedAs + locality spread)
  "LI-14235", // Steinauer Weg 7, Aurach — rooftop PV + `_inv_gen_*`
  "LI-16074", // Thomas-Dachser-Str. 4, Nürnberg — the flagship investor block
  "LI-16167", // Kurt-Nagel-Platz 1, Nürnberg — plain annual
] as const;

/** One row of a generic flat sheet: header → cell value (`null` = empty cell). */
export type FlatRow = Record<string, string | number | null>;

/**
 * Read a generic flat workbook into rows keyed by header. `defval: null` keeps
 * every column on every row, so the sheet's column ORDER survives the
 * round-trip (a sparse column would otherwise re-order by first appearance).
 */
export function readFlatRows(bytes: Uint8Array): FlatRow[] {
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<FlatRow>(ws, { defval: null });
  if (rows.length === 0) throw new Error("no data rows");
  if (!("buildingCode" in rows[0])) {
    throw new Error("sheet has no `buildingCode` column");
  }
  const codes = rows.map((r) => r.buildingCode);
  if (new Set(codes).size !== codes.length) {
    throw new Error("duplicate buildingCode in sheet");
  }
  return rows;
}

/** The {@link CORE_CODES} rows, in the source sheet's own order. */
export function coreSubset(rows: FlatRow[]): FlatRow[] {
  const wanted = new Set<string>(CORE_CODES);
  const subset = rows.filter((r) => wanted.has(String(r.buildingCode)));
  if (subset.length !== CORE_CODES.length) {
    const found = new Set(subset.map((r) => String(r.buildingCode)));
    const missing = CORE_CODES.filter((c) => !found.has(c));
    throw new Error(`${LIMMO_SRC} is missing core building(s): ${missing.join(", ")}`);
  }
  return subset;
}

/** Render rows back into a generic flat workbook. */
export async function tableBytes(rows: FlatRow[]): Promise<Uint8Array> {
  const ws = await newSheet();
  writeTableSheet(ws, rows);
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
  const rows = readFlatRows(await Deno.readFile(LIMMO_SRC));
  await writeArtifact(CORE_OUT, await tableBytes(coreSubset(rows)));
}

if (import.meta.main) main();
