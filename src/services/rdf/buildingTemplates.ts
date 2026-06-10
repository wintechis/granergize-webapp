import {
  BOOLEAN_FIELDS,
  DECIMAL_FIELDS,
  INTEGER_FIELDS,
  iriPropertyMap,
  objectPropertyMap,
  predicateMap,
} from "./building/buildingConfig.ts";

// ---------------------------------------------------------------------------
// Spreadsheet template maps + value normalization, shared by the building
// import (parseCsvToFields) and export (buildingToWorkbook) paths. Split out of
// buildingSerializer so the two halves depend on one source of truth, not each
// other.
// ---------------------------------------------------------------------------

/**
 * The spreadsheet *layout* — shared by import (`parseCsvToFields` /
 * `detectSpreadsheetFormat`) and export (`buildingToWorkbook`). A file FORMAT, not a
 * user role: an investor row-label sheet, a BSP column table, or a generic flat /
 * Lastgang sheet. One literal set so a building exported in a style re-imports
 * through the matching adapter.
 */
export type SpreadsheetFormat = "investor" | "benchmark" | "generic";

// Investor operating-cost categories (one `investor:hasOperatingCosts` blank
// node). Each is read from a `_opcost_<field>` key; `operationInspectionAndMaintenance`
// is the only boolean, the rest are controlled-vocab/free-text values. The field
// names match the predicates buildingParser reads back, so they round-trip.
export const OPCOST_FIELDS = [
  "wasteDisposal",
  "insurance",
  "operationInspectionAndMaintenance",
  "routineCleaningOffice",
  "routineCleaningWarehouse",
  "glassCleaning",
  "exteriorMaintenance",
  "security",
  "propertyManagement",
  "caretaker",
  "repairAndMaintenance",
] as const;
export const OPCOST_BOOLEAN_FIELDS = new Set<string>([
  "operationInspectionAndMaintenance",
]);

// Upper bound on certifications scanned per building (`_cert_<i>_*` keys).
export const MAX_CERTS = 10;

/** BSP CSV column header (German) → BuildingType field name */
export const BSP_COL_MAP: Record<string, string> = {
  "Unternehmen": "companyName",
  "Gebäude-Name": "label",
  "Straße": "streetAddress",
  "PLZ": "postalCode",
  "Ort": "locality",
  "Bundesland": "region",
  "Baujahr": "yearOfConstruction",
  "Grundstücksfläche": "landArea",
  "Brutto-Grundfläche (BGF)": "buildingArea",
  "PV-Anlage installiert": "hasPVSystem",
  "Alter der PV-Anlage (Baujahr)": "pvInstallationYear",
  "Leistung der PV-Anlage (kW)": "pvCapacityKW",
  "Funktion der Logistikimmobilie": "logisticsFunction",
  "Innenraumtemperatur": "indoorTemperatureClass",
  "Klimatisierungstyp": "climateControlType",
  "Anteil GreenLeases": "greenLeaseShare",
  "Mietvertragsart": "leaseType",
  "Anzahl Mieter": "tenancyType",
  "Hauptindustrie des Mieters / Nutzers (Branche)": "tenantIndustry",
  "Ladetore": "numberOfLoadingDocks",
  // Energy observation columns
  "Strom - tatsächlicher Verbrauch (kWh)": "_bsp_elec",
  "Wärme - tatsächlicher Verbrauch (kWh)": "_bsp_heat",
  "Trinkwasser (m³)": "_bsp_water",
  "Schmutzwasser (m³)": "_bsp_wastewater",
};

/**
 * Investor XLSX row label (column B) → BuildingType field name.
 * Row labels mirror investor-to-ttl.ts exactly, including spacing.
 */
export const INVESTOR_ROW_MAP: Record<string, string> = {
  "Gebäude-Code": "buildingCode",
  "Gebäude-Name": "label",
  "Straße": "streetAddress",
  "PLZ": "postalCode",
  "Ort": "locality",
  "Bundesland": "region",
  "Baujahr": "yearOfConstruction",
  "Sanierungsjahr": "yearOfRenovation",
  "Grundstücksfläche": "landArea",
  "Hallenfläche": "hallArea",
  "Büro- &Sozialfläche": "officeSocialArea", // exact label from script
  "Höhe": "buildingHeight",
  "Ladetore": "numberOfLoadingDocks",
  "Schichtregime": "shiftRegime",
  "Anzahl Mieter": "tenancyType",
  "Mietvertragsart": "leaseType",
  "Innenraumtemperatur": "indoorTemperatureClass",
  "PV-Anlage installiert": "hasPVSystem",
  "Ölkessel": "hasOilBoiler",
  "Gaskessel": "hasGasBoiler",
  "Stromkessel": "hasElectricBoiler",
  "Wärmepumpe": "hasHeatPump",
  "Fernwärme": "hasDistrictHeating",
  "Hauptindustrie des Mieters / Nutzers (Branche)": "tenantIndustry",
};

/**
 * Investor XLSX row label (column B) → operating-cost category. Produces
 * `_opcost_<field>` keys that serializeBuildingToTurtle emits under
 * `investor:hasOperatingCosts`.
 *
 * These are the labels of the template's "Servicelevel" section (the operating-
 * cost categories carry a categorical service level — Einfach/Mittel/Hoch/
 * All-Risk/…, see {@link investorLocalNameLabels}), matched verbatim to
 * the partner sheet (`test/e2e/fixtures/investor-import.xlsx` is the synthetic
 * stand-in). (`operationInspectionAndMaintenance`
 * is modelled as a boolean and round-trips as true/false.) Rows that don't match
 * are simply skipped (no error), so a stale label degrades to "not imported".
 */
export const INVESTOR_OPCOST_ROW_MAP: Record<string, string> = {
  "Entsorgung": "wasteDisposal",
  "Versicherung": "insurance",
  "Bedienung, Inspektion und Wartung": "operationInspectionAndMaintenance",
  "Unterhaltsreinigung Büronutzung": "routineCleaningOffice",
  "Unterhaltsreinigung Hallennutzung": "routineCleaningWarehouse",
  "Glasreinigung": "glassCleaning",
  "Reinigung und Pflege von Außenanlagen (inkl. Winterdienst)": "exteriorMaintenance",
  "Sicherheit": "security",
  "Verwaltung": "propertyManagement",
  "Hausmeister": "caretaker",
  "Instandsetzung / Instandhaltung": "repairAndMaintenance",
};

/**
 * Investor building-certification systems. The template records each system as a
 * yes/no row (column-B label = the system name) plus a level row
 * (`<System> Zertifizierungsstufe`). One {@link InvestorCertification} is
 * materialised per system whose yes/no cell is truthy, with `level` from the
 * level row. The template has no per-system scope, so `scope` is not carried by
 * the XLSX (it still round-trips at the RDF level via `_cert_<i>_scope`).
 */
export const INVESTOR_CERT_SYSTEMS = ["BREEAM", "DGNB", "LEED"] as const;

/** Column-B label of the certification-level row for a system. */
export function certLevelLabel(system: string): string {
  return `${system} Zertifizierungsstufe`;
}

/**
 * The investor sheet's per-year energy rows: German row-label stem (the label
 * is `"<stem> <year>"`), the `_inv_<key>_<year>` intermediate-field stem, and
 * the annual-metrics field it maps to. One source for the export writer
 * (buildingWorkbook), the import's year detection and its per-year row
 * extraction (buildingSerializer) — previously three hand-synced label copies.
 */
export const INV_YEAR_ROW_STEMS = [
  { label: "Stromverbrauch", key: "elec", field: "electricityConsumption" },
  { label: "Wärme - tatsächlicher Verbrauch", key: "heat", field: "heatConsumption" },
  { label: "Wasserverbrauch", key: "water", field: "waterConsumption" },
] as const;

/** Distinct years harvested from `keys` (capture group 1 of `re`), ascending. */
export function yearsIn(keys: Iterable<string>, re: RegExp): number[] {
  const out = new Set<number>();
  for (const k of keys) {
    const y = re.exec(k)?.[1];
    if (y) out.add(Number(y));
  }
  return [...out].sort((a, b) => a - b);
}

// ── Normalizers — mirror scripts exactly ──────────────────────────────────────

/** Mirrors investor-to-ttl.ts yesNo() + benchmark-to-ttl.ts parseBool() */
export function normalizeBoolean(val: string): string {
  const s = val.trim().toLowerCase();
  if (["ja", "yes", "true", "j", "1"].includes(s)) return "true";
  if (["nein", "no", "false", "n", "0"].includes(s)) return "false";
  return "";
}

/** Strip German commas, percent signs, whitespace — mirrors parseNumeric() */
export function normalizeNumber(val: string): string {
  return val.replace(/,/g, ".").replace(/%/g, "").replace(/\s+/g, "");
}

/**
 * Mirrors investor-to-ttl.ts SHIFT_MAP (exact lowercase keys).
 * Returns local name or empty string if unrecognised.
 */
const SHIFT_MAP: Record<string, string> = {
  "1 schicht": "OneShift",
  "1-shift": "OneShift",
  "2 schicht": "TwoShift",
  "2-shift": "TwoShift",
  "3 schicht": "ThreeShift",
  "3-shift": "ThreeShift",
};
function normalizeShift(val: string): string {
  return SHIFT_MAP[val.trim().toLowerCase()] ?? "";
}

/**
 * Mirrors investor-to-ttl.ts TENANCY_MAP + benchmark-to-ttl.ts tenancyType()
 * ("1" and "mehr" coverage).
 */
const TENANCY_MAP: Record<string, string> = {
  "single": "SingleTenant",
  "single tenant": "SingleTenant",
  "1": "SingleTenant",
  "multi-tenant": "MultiTenant",
  "multi tenant": "MultiTenant",
};
function normalizeTenancy(val: string): string {
  const s = val.trim().toLowerCase();
  if (TENANCY_MAP[s]) return TENANCY_MAP[s];
  if (s.includes("multi") || s.includes("mehr")) return "MultiTenant";
  return "";
}

/**
 * Mirrors investor-to-ttl.ts TEMP_MAP (exact lowercase keys).
 * Used for investor XLSX where Innenraumtemperatur → indoorTemperatureClass.
 */
const TEMP_MAP: Record<string, string> = {
  "<= 12°c": "MaxTwelveDegrees",
  "≤12 °c": "MaxTwelveDegrees",
  "<= 18°c": "MaxEighteenDegrees",
  "≤18 °c": "MaxEighteenDegrees",
};
function normalizeTempClass(val: string): string {
  return TEMP_MAP[val.trim().toLowerCase()] ?? "";
}

export function applyNormalization(field: string, raw: string): string {
  if (BOOLEAN_FIELDS.has(field)) return normalizeBoolean(raw);
  if (INTEGER_FIELDS.has(field) || DECIMAL_FIELDS.has(field)) {
    return normalizeNumber(raw);
  }
  if (field === "tenancyType") return normalizeTenancy(raw);
  if (field === "shiftRegime") return normalizeShift(raw);
  if (field === "indoorTemperatureClass") return normalizeTempClass(raw);
  if (field === "greenLeaseShare") return normalizeNumber(raw);
  // Energy observation fields — always numeric
  if (field.startsWith("_bsp_") && field !== "_bsp_year") return normalizeNumber(raw);
  if (field.startsWith("_inv_")) return normalizeNumber(raw);
  return raw.trim();
}

// ── Export-side derived maps (inverse of the import maps) ──────────────────────

function invertMap(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) out[v] = k;
  return out;
}

// field → spreadsheet label/header (built once from the import maps).
export const INV_FIELD_TO_LABEL = invertMap(INVESTOR_ROW_MAP);
export const BSP_FIELD_TO_HEADER = invertMap(BSP_COL_MAP);
export const OPCOST_FIELD_TO_LABEL = invertMap(INVESTOR_OPCOST_ROW_MAP);
// All scalar BuildingType fields, for the generic (user/dummy) sheet.
export const SCALAR_FIELDS: string[] = [
  ...new Set(
    [
      ...Object.values(predicateMap),
      ...Object.values(objectPropertyMap),
      ...Object.values(iriPropertyMap),
    ].map((f) => String(f)),
  ),
];
