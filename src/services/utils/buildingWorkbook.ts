import * as XLSX from "xlsx";
import type { BuildingType } from "../../../types/types.ts";
import {
  BSP_FIELD_TO_HEADER,
  certLevelLabel,
  INV_FIELD_TO_LABEL,
  OPCOST_FIELD_TO_LABEL,
  OPCOST_FIELDS,
  SCALAR_FIELDS,
} from "./buildingTemplates.ts";

// ---------------------------------------------------------------------------
// XLSX export (inverse of parseCsvToFields) — build per-building and combined
// workbooks shaped to re-import via the same template maps. Split out of
// buildingSerializer.
// ---------------------------------------------------------------------------

function cellValue(v: unknown): string | number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return null; // skip nested structures
  return String(v);
}

/**
 * Build an XLSX workbook for a building, shaped to match the role's import
 * template so the file re-imports via `parseCsvToFields`:
 *   - investor → row-label sheet (label in col B, value in col D), with per-year
 *     energy rows, operating costs and the first certification block;
 *   - benchmark → single header row + value row, energy as `_bsp_*` columns;
 *   - user / dummy / unknown → flat sheet keyed by BuildingType field names.
 * Exports the *modelled* fields only (the whitelisted projection); the 15-minute
 * user series lives in separate lazy files and is not included.
 */
function buildingSheet(b: BuildingType): XLSX.WorkSheet {
  const role = b.provenance;

  if (role === "investor") {
    const rows: (string | number)[][] = [];
    const put = (label: string, raw: unknown) => {
      const v = cellValue(raw);
      if (v !== null) rows.push(["", label, "", v]);
    };
    for (const [field, label] of Object.entries(INV_FIELD_TO_LABEL)) {
      put(label, b[field as keyof BuildingType]);
    }
    let renewDone = false;
    for (const y of b.annualData ?? []) {
      put(`Stromverbrauch ${y.year}`, y.electricityConsumption);
      put(`Wärme - tatsächlicher Verbrauch ${y.year}`, y.heatConsumption);
      put(`Wasserverbrauch ${y.year}`, y.waterConsumption);
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
    // the template, so scope is not exported to the row-label sheet).
    for (const cert of b.certifications ?? []) {
      if (!cert.type) continue;
      put(cert.type, "Ja");
      if (cert.level) put(certLevelLabel(cert.type), cert.level);
    }
    return XLSX.utils.aoa_to_sheet(rows);
  }

  const record: Record<string, string | number> = {};
  if (role === "benchmark_service_provider") {
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
  return XLSX.utils.json_to_sheet([record]);
}

function buildingToWorkbook(b: BuildingType): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildingSheet(b), "Gebäude");
  return wb;
}

/**
 * Flatten one building to a single spreadsheet row. Master-data columns use the
 * BuildingType field names (so the row re-imports via the generic path), and the
 * structured parts use the importer's intermediate keys (`_inv_*` / `_bsp_*` /
 * `_opcost_*` / `_cert_0_*`) so energy, operating costs and the first
 * certification round-trip too. `id` / `role` are reference columns (no predicate,
 * ignored on import).
 */
function buildingToFlatRecord(b: BuildingType): Record<string, string | number> {
  const rec: Record<string, string | number> = {};
  const set = (k: string, raw: unknown) => {
    const v = cellValue(raw);
    if (v !== null) rec[k] = v;
  };
  set("id", b.id);
  set("provenance", b.provenance);
  for (const field of SCALAR_FIELDS) set(field, b[field as keyof BuildingType]);

  if (b.provenance === "benchmark_service_provider") {
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
      set(`_inv_elec_${y.year}`, y.electricityConsumption);
      set(`_inv_heat_${y.year}`, y.heatConsumption);
      set(`_inv_water_${y.year}`, y.waterConsumption);
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

/**
 * One workbook with a single sheet, one row per building — a unified table of all
 * buildings. Mixed-role buildings coexist as sparse columns; each row re-imports
 * via the generic path (import as user / dummy). See {@link buildingToFlatRecord}.
 */
function buildingsToWorkbook(buildings: BuildingType[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const rows = buildings.map(buildingToFlatRecord);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Gebäude");
  return wb;
}

function workbookToBytes(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const u8: Uint8Array = out instanceof Uint8Array
    ? out
    : new Uint8Array(out as ArrayBuffer);
  const copy = new ArrayBuffer(u8.byteLength);
  new Uint8Array(copy).set(u8);
  return copy;
}

/**
 * Serialize a building to `.xlsx` bytes (see {@link buildingToWorkbook}), as a
 * plain `ArrayBuffer` so it drops straight into `new Blob([...])` / `new File([...])`.
 */
export function buildingToXlsx(b: BuildingType): ArrayBuffer {
  return workbookToBytes(buildingToWorkbook(b));
}

/** Serialize all buildings to one multi-sheet `.xlsx` (see {@link buildingsToWorkbook}). */
export function buildingsToXlsx(buildings: BuildingType[]): ArrayBuffer {
  return workbookToBytes(buildingsToWorkbook(buildings));
}
