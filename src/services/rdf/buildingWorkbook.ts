import type { Borders, Fill, Worksheet } from "exceljs";
import type { BuildingType } from "../../types.ts";
import {
  BSP_FIELD_TO_HEADER,
  certLevelLabel,
  INV_FIELD_TO_LABEL,
  INV_YEAR_ROW_STEMS,
  OPCOST_FIELD_TO_LABEL,
  OPCOST_FIELDS,
  SCALAR_FIELDS,
  type SpreadsheetFormat,
} from "./buildingTemplates.ts";
import { GRANERGIZE_LOGO_PNG_BASE64 } from "./logoPng.ts";
import { BRAND_PRIMARY } from "../../constants/chartColors.ts";

// ---------------------------------------------------------------------------
// XLSX export (inverse of parseCsvToFields) — build per-building and combined
// workbooks shaped to re-import via the same template maps. Written with
// exceljs (lazy-loaded; the read/import side stays on `xlsx`, which cannot
// write styles) so the files carry the visual polish the community `xlsx`
// build can't produce: a brand header, styled header rows, column widths and
// the logo. The CELL layout is unchanged — detection and re-import read
// values only, never styling.
// ---------------------------------------------------------------------------

type Cell = string | number | null;

function cellValue(v: unknown): Cell {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return null; // skip nested structures
  return String(v);
}

/**
 * The investor row-label rows (label in col B, value in col D) so the file
 * re-imports via `parseCsvToFields("investor")`:
 *   per-field rows, then per-year energy rows, operating costs and the first
 *   certification block. Exports the *modelled* fields only (the whitelisted
 *   projection); the 15-minute user series lives in separate lazy files and is
 *   not included.
 */
function investorRows(b: BuildingType): Cell[][] {
  const rows: Cell[][] = [];
  const put = (label: string, raw: unknown) => {
    const v = cellValue(raw);
    if (v !== null) rows.push([null, label, null, v]);
  };
  for (const [field, label] of Object.entries(INV_FIELD_TO_LABEL)) {
    put(label, b[field as keyof BuildingType]);
  }
  let renewDone = false;
  for (const y of b.annualData ?? []) {
    for (const { label, field } of INV_YEAR_ROW_STEMS) {
      put(`${label} ${y.year}`, y[field]);
    }
    if (!renewDone && y.renewableSelfGeneratedShare != null) {
      put(
        "Anteil eigenerzeugter Strom aus erneuerbaren Quellen",
        y.renewableSelfGeneratedShare,
      );
      renewDone = true;
    }
  }
  if (b.operatingCosts) {
    const oc = b.operatingCosts as Record<string, unknown>;
    for (const [field, label] of Object.entries(OPCOST_FIELD_TO_LABEL)) {
      put(label, oc[field]);
    }
  }
  // Certifications: one yes/no + level pair per system (no per-system scope in
  // the row-label layout, so scope is not exported here).
  for (const cert of b.certifications ?? []) {
    if (!cert.type) continue;
    put(cert.type, "Ja");
    if (cert.level) put(certLevelLabel(cert.type), cert.level);
  }
  return rows;
}

/** Single-building column record for the benchmark / generic table layouts. */
function buildingRecord(
  b: BuildingType,
  style: SpreadsheetFormat,
): Record<string, string | number> {
  const record: Record<string, string | number> = {};
  if (style === "benchmark") {
    for (const [field, header] of Object.entries(BSP_FIELD_TO_HEADER)) {
      if (field.startsWith("_")) continue; // energy headers handled below
      const v = cellValue(b[field as keyof BuildingType]);
      if (v !== null) record[header] = v;
    }
    const y = b.annualData?.[0];
    if (y) {
      const e = cellValue(y.electricityConsumption);
      const h = cellValue(y.heatConsumption);
      const w = cellValue(y.waterConsumption);
      const ww = cellValue(y.wastewaterConsumption);
      if (e !== null) record["Strom - tatsächlicher Verbrauch (kWh)"] = e;
      if (h !== null) record["Wärme - tatsächlicher Verbrauch (kWh)"] = h;
      if (w !== null) record["Trinkwasser (m³)"] = w;
      if (ww !== null) record["Schmutzwasser (m³)"] = ww;
    }
  } else {
    // Generic (user / dummy / unknown): BuildingType field names as headers.
    for (const field of SCALAR_FIELDS) {
      const v = cellValue(b[field as keyof BuildingType]);
      if (v !== null) record[field] = v;
    }
  }
  return record;
}

/**
 * Flatten one building to a single spreadsheet row. Master-data columns use the
 * BuildingType field names (so the row re-imports via the generic path), and the
 * structured parts use the importer's intermediate keys (`_inv_*` / `_bsp_*` /
 * `_opcost_*` / `_cert_0_*`) so energy, operating costs and the first
 * certification round-trip too. `id` is a reference column (no predicate, ignored
 * on import). Energy is shaped by the *data*: a single annual year carrying
 * wastewater (the BSP shape) round-trips through `_bsp_*`; otherwise the years go
 * out as multi-year `_inv_*`.
 */
function buildingToFlatRecord(b: BuildingType): Record<string, string | number> {
  const rec: Record<string, string | number> = {};
  const set = (k: string, raw: unknown) => {
    const v = cellValue(raw);
    if (v !== null) rec[k] = v;
  };
  set("id", b.id);
  for (const field of SCALAR_FIELDS) set(field, b[field as keyof BuildingType]);

  const hasWastewater = (b.annualData ?? []).some(
    (y) => y.wastewaterConsumption != null,
  );
  if (hasWastewater) {
    const y = b.annualData?.[0];
    if (y) {
      set("_bsp_year", y.year);
      set("_bsp_elec", y.electricityConsumption);
      set("_bsp_heat", y.heatConsumption);
      set("_bsp_water", y.waterConsumption);
      set("_bsp_wastewater", y.wastewaterConsumption);
    }
  } else {
    for (const y of b.annualData ?? []) {
      for (const { key, field } of INV_YEAR_ROW_STEMS) {
        set(`_inv_${key}_${y.year}`, y[field]);
      }
      set(`_inv_renew_${y.year}`, y.renewableSelfGeneratedShare);
    }
  }

  if (b.operatingCosts) {
    const oc = b.operatingCosts as Record<string, unknown>;
    for (const f of OPCOST_FIELDS) set(`_opcost_${f}`, oc[f]);
  }
  const cert = b.certifications?.[0];
  if (cert) {
    set("_cert_0_type", cert.type);
    set("_cert_0_level", cert.level);
    set("_cert_0_scope", cert.scope);
  }
  return rec;
}

// --- exceljs writing -------------------------------------------------------

// Brand primary (shared with theme.palette) in exceljs ARGB form, plus the
// derived accents. Style objects are module-level constants — exceljs assigns
// them by reference, so one object serves every cell.
const BRAND = "FF" + BRAND_PRIMARY.slice(1).toUpperCase();
const ZEBRA = "FFF0F6FB";
const GRID = "FFD0D7DE";

const THIN_SIDE = { style: "thin", color: { argb: GRID } } as const;
const THIN_BORDER: Partial<Borders> = {
  top: THIN_SIDE,
  bottom: THIN_SIDE,
  left: THIN_SIDE,
  right: THIN_SIDE,
};
const ZEBRA_FILL: Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: ZEBRA },
};
const BRAND_FILL: Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: BRAND },
};
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };

type Exceljs = typeof import("exceljs");

/** Lazy-load exceljs so the writer lands in its own code-split chunk. */
async function loadExceljs(): Promise<Exceljs> {
  const mod = await import("exceljs");
  return (mod as { default?: Exceljs }).default ?? (mod as Exceljs);
}

/** Place the logo via a two-cell anchor (tl→br; LibreOffice renders a
 * one-cell-anchor extent zero-sized). Images live in the drawing layer — they
 * occupy no cells, so import is unaffected. Anchors are fractional col/row
 * coordinates. */
function placeLogo(
  ws: Worksheet,
  tl: { col: number; row: number },
  br: { col: number; row: number },
): void {
  const id = ws.workbook.addImage({
    base64: GRANERGIZE_LOGO_PNG_BASE64,
    extension: "png",
  });
  ws.addImage(id, {
    tl,
    br,
    editAs: "oneCell",
  } as Parameters<Worksheet["addImage"]>[1]);
}

/**
 * Header-row + data-rows table sheet (benchmark / generic / combined export):
 * brand-filled bold header in row 1 (the row the importer reads the column
 * names from), zebra-striped data rows, fitted column widths, frozen header.
 */
function writeTableSheet(
  ws: Worksheet,
  records: Record<string, string | number>[],
): void {
  // Union of keys across rows, first-seen order (sparse columns coexist).
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = BRAND_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: "middle" };
  });
  headerRow.height = 22;

  for (const [i, rec] of records.entries()) {
    const row = ws.addRow(headers.map((h) => rec[h] ?? null));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = THIN_BORDER;
      if (i % 2 === 1) cell.fill = ZEBRA_FILL;
    });
  }

  headers.forEach((h, i) => {
    const longest = records.reduce(
      (n, r) => Math.max(n, String(r[h] ?? "").length),
      h.length,
    );
    ws.getColumn(i + 1).width = Math.min(40, Math.max(12, longest + 2));
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  // Floats right of the data; visible on screen (print ranges clip to the
  // used cells, which is fine for a data table).
  placeLogo(
    ws,
    { col: headers.length + 1, row: 0.1 },
    { col: headers.length + 1.5, row: 1.7 },
  );
}

/**
 * Investor row-label sheet: a brand title band (row 1, columns A–D merged — the
 * importer matches col-B labels by exact text, which the title is not), a bold
 * "Datenfeld / Wert" header, then the label/value rows with zebra striping.
 */
function writeInvestorSheet(ws: Worksheet, rows: Cell[][]): void {
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 52;
  ws.getColumn(3).width = 3;
  ws.getColumn(4).width = 20;

  const title = ws.addRow(["Gebäudedaten"]);
  ws.mergeCells(1, 1, 1, 4);
  const titleCell = title.getCell(1);
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.fill = BRAND_FILL;
  titleCell.alignment = { vertical: "middle", indent: 1 };
  title.height = 30;

  ws.addRow([]);
  const header = ws.addRow([null, "Datenfeld", null, "Wert"]);
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.border = {
      bottom: { style: "medium", color: { argb: BRAND } },
    };
  });

  for (const [i, r] of rows.entries()) {
    const row = ws.addRow(r);
    if (i % 2 === 1) {
      for (const c of [2, 3, 4]) row.getCell(c).fill = ZEBRA_FILL;
    }
  }
  // Badge in the title band's right corner — inside the used range, so it
  // survives print/PDF too. Col D is 20 chars (~145px) wide and the band is
  // 30pt (~40px) tall; the fractions keep the badge ~32px square.
  placeLogo(ws, { col: 3.3, row: 0.1 }, { col: 3.95, row: 0.9 });
}

async function newSheet(): Promise<Worksheet> {
  const ExcelJS = await loadExceljs();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Granergize";
  return wb.addWorksheet("Gebäude");
}

async function sheetToBytes(ws: Worksheet): Promise<ArrayBuffer> {
  const out = await ws.workbook.xlsx.writeBuffer();
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out);
  // Plain ArrayBuffer copy so it drops straight into `new Blob([...])`.
  const copy = new ArrayBuffer(u8.byteLength);
  new Uint8Array(copy).set(u8);
  return copy;
}

/**
 * Serialize a building to `.xlsx` bytes in the user-chosen layout `style`
 * (default generic) so the file re-imports via `parseCsvToFields`:
 *   - investor → row-label sheet (label in col B, value in col D);
 *   - benchmark → single header row + value row, energy as BSP columns;
 *   - generic → flat sheet keyed by BuildingType field names.
 */
export async function buildingToXlsx(
  b: BuildingType,
  style: SpreadsheetFormat = "generic",
): Promise<ArrayBuffer> {
  const ws = await newSheet();
  if (style === "investor") writeInvestorSheet(ws, investorRows(b));
  else writeTableSheet(ws, [buildingRecord(b, style)]);
  return sheetToBytes(ws);
}

/**
 * One workbook with a single sheet, one row per building — a unified table of all
 * buildings. Mixed-role buildings coexist as sparse columns; each row re-imports
 * via the generic path (import as user / dummy). See {@link buildingToFlatRecord}.
 */
export async function buildingsToXlsx(
  buildings: BuildingType[],
): Promise<ArrayBuffer> {
  const ws = await newSheet();
  writeTableSheet(ws, buildings.map(buildingToFlatRecord));
  return sheetToBytes(ws);
}
