import * as XLSX from "xlsx";
import {
  applyNormalization,
  BSP_COL_MAP,
  certLevelLabel,
  INV_YEAR_ROW_STEMS,
  INVESTOR_CERT_SYSTEMS,
  INVESTOR_OPCOST_ROW_MAP,
  INVESTOR_ROW_MAP,
  normalizeBoolean,
  normalizeNumber,
  type SpreadsheetFormat,
  yearsIn,
} from "../buildingTemplates.ts";
import { parseLastgangXlsx } from "../energySeriesXlsx.ts";

// ── CSV / XLSX autofill: detect a partner spreadsheet's layout and parse it into
// per-building field maps. The inverse of the export side (buildingWorkbook.ts);
// the field maps feed serializeBuildingToTurtle / annualDatasetsFromFields. Pure
// (no Pod I/O) — moved out of buildingSerializer.ts so that file is serialize-only.

/**
 * Detect a spreadsheet's layout from its first sheet, so import can pick the right
 * parser without the user declaring anything: an investor sheet labels rows in column
 * B (`"Gebäude-Code"` etc.); a BSP sheet has the German column headers (incl. the
 * BSP-only `"Schmutzwasser (m³)"`); anything else is treated as generic (a
 * Lastgang 15-min profile or a flat field-name CSV). Returns the matching
 * {@link parseCsvToFields} format; the import UI uses it as the default, overridable.
 */
export async function detectSpreadsheetFormat(
  file: File,
): Promise<SpreadsheetFormat> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return "generic";
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  // BSP first — it is the more specific signal: several German column headers
  // in the first row. (Checked before the investor scan because a BSP header
  // row can carry a label like "PLZ" in column B, which the investor scan
  // would otherwise claim.) Two headers rule out a stray shared label.
  let bspHeaders = 0;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    const v = cell?.v != null ? String(cell.v).trim() : "";
    if (v && BSP_COL_MAP[v]) bspHeaders++;
  }
  if (bspHeaders >= 2) return "benchmark";
  // Investor: a known row label in column B (the row-label layout).
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    const v = cell?.v != null ? String(cell.v).trim() : "";
    if (v && INVESTOR_ROW_MAP[v]) return "investor";
  }
  return "generic";
}

/**
 * Parse a CSV or XLSX file into one field map per building.
 *
 * Investor template:  row-label format (labels in col B, buildings in cols D–K).
 *                 Energy observations extracted from per-year rows.
 * Benchmark template: column-header format (German headers, one row per building).
 *                 Energy columns mapped to _bsp_* keys; year defaults to 2024.
 * Generic:        flat CSV with BuildingType field names as headers, or Lastgang.
 */
export async function parseCsvToFields(
  file: File,
  template: SpreadsheetFormat,
): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // An empty workbook has no first sheet — "no buildings found", not a TypeError
  // (detectSpreadsheetFormat guards the same way).
  if (!ws) return [];
  const results: Record<string, string>[] = [];

  if (template === "investor") {
    // Build row index from column B labels
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    const rowIndex: Record<string, number> = {};
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
      if (cell?.v != null) rowIndex[String(cell.v).trim()] = r;
    }

    // Renewable share: single row applied to every year that has electricity data
    const renewRowIdx = rowIndex["Anteil eigenerzeugter Strom aus erneuerbaren Quellen"];

    // Years come from the sheet's own row labels ("Stromverbrauch 2025"), not a
    // hardcoded range — a partner sheet with a newer year row used to be
    // silently dropped. (Same labels the per-year extraction below reads.)
    const yearLabelRe = new RegExp(
      `^(?:${INV_YEAR_ROW_STEMS.map((s) => s.label).join("|")}) (\\d{4})$`,
    );
    const sheetYears = yearsIn(Object.keys(rowIndex), yearLabelRe);

    // Buildings in columns D–K (indices 3–10), matching investor-to-ttl.ts
    for (const col of [3, 4, 5, 6, 7, 8, 9, 10]) {
      // Skip column if no building code present
      const codeRow = rowIndex["Gebäude-Code"];
      if (codeRow !== undefined) {
        const codeCell = ws[XLSX.utils.encode_cell({ r: codeRow, c: col })];
        if (codeCell?.v == null) continue;
      }

      const result: Record<string, string> = {};

      // Building metadata fields
      for (const [label, field] of Object.entries(INVESTOR_ROW_MAP)) {
        const row = rowIndex[label];
        if (row === undefined) continue;
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell?.v == null) continue;
        const normalized = applyNormalization(field, String(cell.v));
        if (normalized !== "") result[field] = normalized;
      }

      // Energy observations per year
      const renewRaw = renewRowIdx !== undefined
        ? ws[XLSX.utils.encode_cell({ r: renewRowIdx, c: col })]?.v
        : null;
      const renewNorm = renewRaw != null ? normalizeNumber(String(renewRaw)) : "";

      for (const year of sheetYears) {
        for (const { label, key } of INV_YEAR_ROW_STEMS) {
          const r = rowIndex[`${label} ${year}`];
          if (r === undefined) continue;
          const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
          if (cell?.v == null) continue;
          const v = normalizeNumber(String(cell.v));
          if (v) result[`_inv_${key}_${year}`] = v;
        }
        // Attach renewable share to each year that has electricity data
        if (renewNorm && result[`_inv_elec_${year}`]) {
          result[`_inv_renew_${year}`] = renewNorm;
        }
      }

      // Operating costs → _opcost_<field> (one investor:hasOperatingCosts node).
      for (const [label, field] of Object.entries(INVESTOR_OPCOST_ROW_MAP)) {
        const row = rowIndex[label];
        if (row === undefined) continue;
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell?.v == null) continue;
        const raw = String(cell.v).trim();
        if (!raw) continue;
        const value = field === "operationInspectionAndMaintenance"
          ? normalizeBoolean(raw)
          : raw;
        if (value) result[`_opcost_${field}`] = value;
      }

      // Certifications: one block per system (BREEAM/DGNB/LEED) whose yes/no row
      // is truthy; level comes from its "<System> Zertifizierungsstufe" row.
      let certIdx = 0;
      for (const sys of INVESTOR_CERT_SYSTEMS) {
        const presentRow = rowIndex[sys];
        if (presentRow === undefined) continue;
        const presentCell = ws[XLSX.utils.encode_cell({ r: presentRow, c: col })];
        if (normalizeBoolean(String(presentCell?.v ?? "")) !== "true") continue;
        result[`_cert_${certIdx}_type`] = sys;
        const levelRow = rowIndex[certLevelLabel(sys)];
        if (levelRow !== undefined) {
          const lc = ws[XLSX.utils.encode_cell({ r: levelRow, c: col })];
          if (lc?.v != null && String(lc.v).trim()) {
            result[`_cert_${certIdx}_level`] = String(lc.v).trim();
          }
        }
        certIdx++;
      }

      if (Object.keys(result).length > 0) results.push(result);
    }
  } else {
    // Detect Lastgang format for the generic layout (utility load-profile export)
    if (template === "generic") {
      const wsRange = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      const parsed = parseLastgangXlsx(ws, wsRange);
      if (parsed.length > 0) return parsed;
    }

    // Column-header format (BSP and generic) — one result per data row
    const colMap = template === "benchmark" ? BSP_COL_MAP : {};
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
      raw: false,
      defval: "",
    });
    for (const row of rows) {
      const result: Record<string, string> = {};
      for (const [header, raw] of Object.entries(row)) {
        if (!raw || raw === "") continue;
        const field = colMap[header] ?? header;
        const normalized = applyNormalization(field, raw);
        if (normalized !== "") result[field] = normalized;
      }
      // Default measurement year for BSP energy observations
      if (template === "benchmark" && !result["_bsp_year"]) {
        result["_bsp_year"] = "2024";
      }
      if (Object.keys(result).length > 0) results.push(result);
    }
  }

  return results;
}

