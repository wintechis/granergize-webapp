import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store, Writer } from "n3";
import type {
  BuildingType,
  InvestorAnnualData,
  UserRole,
} from "../../../types/types.ts";
import {
  BOOLEAN_FIELDS,
  DECIMAL_FIELDS,
  INTEGER_FIELDS,
  objectPropertyMap,
  predicateMap,
} from "./config/buildingConfig.ts";
import {
  GRAN_NS,
  INVESTOR_NS,
  PROV_AGENT,
  PROV_ATTRIBUTION,
  PROV_HAD_ROLE,
  PROV_QUALIFIED_ATTRIBUTION,
  RDF_TYPE as RDF_TYPE_IRI,
  USERVOC_NS,
  XSD_DECIMAL,
  XSD_INTEGER,
} from "./vocabularies.ts";
import {
  type AnnualMetrics,
  datasetFileUrl,
  datasetNodeUrl,
  type EnergyDataset,
  loadEnergyDatasets,
  serializeEnergyDataset,
  seriesContainerUrl,
  seriesDailyFileUrl,
} from "./energyDataset.ts";
import { isSeriesGranularity } from "./durationUtils.ts";
import { PROVENANCE_TO_IRI } from "../../constants/roles.ts";
import { getStorageRoot } from "./solidUtils.ts";
import { ensureContainer, readModifyWrite } from "./podWrite.ts";
import { mapPooled } from "./pool.ts";
import { deleteContainerRecursive } from "./podDelete.ts";
import { trackedFetch } from "./networkActivity.ts";
import * as XLSX from "xlsx";

const { namedNode, literal, blankNode } = DataFactory;

// XSD datatypes not centralised in vocabularies.ts (only used here).
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";
const REC_BUILDING = "https://w3id.org/rec#Building";

// Inverse maps: BuildingType field name → predicate IRI
const fieldToPredicate: Record<string, string> = Object.fromEntries(
  Object.entries(predicateMap).map(([iri, field]) => [field as string, iri]),
);
const fieldToObjectPredicate: Record<string, string> = Object.fromEntries(
  Object.entries(objectPropertyMap).map(([iri, field]) => [field as string, iri]),
);

// INTEGER_FIELDS / DECIMAL_FIELDS / BOOLEAN_FIELDS are derived from the building
// field descriptor table (buildingConfig.ts) so read and write share one source.


// Years scanned for the investor `_inv_<metric>_<year>` annual fields.
const INV_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];

// Investor operating-cost categories (one `investor:hasOperatingCosts` blank
// node). Each is read from a `_opcost_<field>` key; `operationInspectionAndMaintenance`
// is the only boolean, the rest are controlled-vocab/free-text values. The field
// names match the predicates buildingParser reads back, so they round-trip.
const OPCOST_FIELDS = [
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
const OPCOST_BOOLEAN_FIELDS = new Set<string>([
  "operationInspectionAndMaintenance",
]);

// Upper bound on certifications scanned per building (`_cert_<i>_*` keys).
const MAX_CERTS = 10;

// ---------------------------------------------------------------------------
// Lastgang (15-min load profile) helpers
// ---------------------------------------------------------------------------

export interface LastgangReading {
  date: string;     // "YYYY-MM-DD" UTC date of begin time
  slotId: string;   // "HHMM" of begin UTC
  beginTs: string;  // ISO 8601 UTC
  endTs: string;    // ISO 8601 UTC
  valueKwh: string; // kW × 0.25, 6 decimal places
}

function lastSundayOf(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - lastDow;
}

function berlinToUTC(
  year: number, month: number, day: number, hour: number, minute: number,
): Date {
  const dstStart = Date.UTC(year, 2, lastSundayOf(year, 3), 1, 0, 0);
  const dstEnd   = Date.UTC(year, 9, lastSundayOf(year, 10), 1, 0, 0);
  const asCEST   = Date.UTC(year, month - 1, day, hour - 2, minute);
  if (asCEST >= dstStart && asCEST < dstEnd) return new Date(asCEST);
  return new Date(Date.UTC(year, month - 1, day, hour - 1, minute));
}

function toISO8601(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Convert an Excel serial date number to {year,month,day,hour,minute} (local time). */
function xlSerialToComponents(serial: number): { year: number; month: number; day: number; hour: number; minute: number } {
  // Excel counts from Jan 1 1900 as day 1, but incorrectly treats 1900 as leap year.
  // For serials >= 60 (i.e. March 1, 1900+) subtract 1 to correct.
  const adjusted = serial >= 60 ? serial - 1 : serial;
  const ms = (adjusted - 1) * 86400000;
  const d = new Date(Date.UTC(1900, 0, 1) + ms);
  const frac = serial - Math.floor(serial);
  const totalMin = Math.round(frac * 1440);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: Math.floor(totalMin / 60),
    minute: totalMin % 60,
  };
}

/** Lastgang header label → BuildingType field name. */
const LASTGANG_FIELD_MAP: Record<string, string> = {
  "Marktlokation Name": "label",
};

/**
 * Parse an end-of-interval timestamp string to {year, month, day, hour, minute}.
 * Accepts:
 *   US format:     M/D/YYYY H:MM  or  MM/DD/YYYY HH:MM
 *   German format: D.M.YYYY H:MM  or  DD.MM.YYYY HH:MM
 *   ISO format:    YYYY-MM-DDTHH:MM  or  YYYY-MM-DD HH:MM  (timezone suffix ignored)
 */
function parseEndOfIntervalTs(
  tsStr: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const clean = tsStr.trim();
  // ISO: YYYY-MM-DDTHH:MM or YYYY-MM-DD HH:MM (optional seconds / timezone suffix)
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3], hour: +iso[4], minute: +iso[5] };
  // US: M/D/YYYY H:MM or M/D/YY H:MM
  const us = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (us) {
    const y = +us[3];
    return { month: +us[1], day: +us[2], year: y < 100 ? 2000 + y : y, hour: +us[4], minute: +us[5] };
  }
  // German: D.M.YYYY H:MM
  const de = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (de) return { day: +de[1], month: +de[2], year: +de[3], hour: +de[4], minute: +de[5] };
  return null;
}

/** Get the best timestamp string from a cell (formatted text preferred, serial fallback). */
function cellTimestamp(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  // Use formatted text only if it actually looks like a date (not a raw serial like "45292.010")
  if (cell.w) {
    const w = String(cell.w).trim();
    if (/\d{1,4}[-./T]\d{1,2}/.test(w)) return w;
  }
  // Excel serial date number (date-formatted cells)
  if (cell.t === "n" && typeof cell.v === "number" && cell.v > 25000) {
    const { year, month, day, hour, minute } = xlSerialToComponents(cell.v);
    return `${day}.${String(month).padStart(2, "0")}.${year} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return cell.v != null ? String(cell.v) : "";
}

/**
 * Parse a Lastgang XLSX worksheet:
 *   rows with col A non-empty = header block (label → value pairs)
 *   rows with col A empty, col B = end-of-interval timestamp (Europe/Berlin),
 *   col C = average power (kW) → 15-min readings
 *
 * Returns a single-element array with one building field map.
 * Energy readings are stored as JSON in `_readings_json`.
 * Returns [] if no readings could be parsed (signals: not Lastgang format).
 */
function parseLastgangXlsx(ws: XLSX.WorkSheet, range: XLSX.Range): Record<string, string>[] {
  const fields: Record<string, string> = {};
  const readings: LastgangReading[] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const cellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const cellB = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    const cellC = ws[XLSX.utils.encode_cell({ r, c: 2 })];

    const labelA = cellA?.v != null ? String(cellA.v).trim() : "";

    if (!labelA) {
      // Old format: col A empty, col B = end-of-interval timestamp, col C = kW value
      const tsStr = cellTimestamp(cellB);
      if (!tsStr) continue;
      const ts = parseEndOfIntervalTs(tsStr);
      if (!ts) continue;
      const endUTC = berlinToUTC(ts.year, ts.month, ts.day, ts.hour, ts.minute);
      const beginUTC = new Date(endUTC.getTime() - 15 * 60 * 1000);
      const kwRaw = cellC?.v != null ? cellC.v : null;
      if (kwRaw == null) continue;
      const kw = parseFloat(typeof kwRaw === "string" ? kwRaw.replace(",", ".") : String(kwRaw));
      if (isNaN(kw)) continue;
      const beginTs = toISO8601(beginUTC);
      readings.push({
        date:     beginTs.slice(0, 10),
        slotId:   beginTs.slice(11, 16).replace(":", ""),
        beginTs,
        endTs:    toISO8601(endUTC),
        valueKwh: (kw * 0.25).toFixed(6),
      });
      continue;
    }

    // Col A non-empty: try parsing as end-of-interval timestamp (Lastgang format:
    // col A = timestamp, col B = kW value). Fall back to header row if not a timestamp.
    const tsStrA = cellTimestamp(cellA);
    const ts = parseEndOfIntervalTs(tsStrA);
    if (ts) {
      const endUTC = berlinToUTC(ts.year, ts.month, ts.day, ts.hour, ts.minute);
      const beginUTC = new Date(endUTC.getTime() - 15 * 60 * 1000);
      const kwRaw = cellB?.v != null ? cellB.v : null;
      if (kwRaw == null) continue;
      const kw = parseFloat(typeof kwRaw === "string" ? kwRaw.replace(",", ".") : String(kwRaw));
      if (isNaN(kw)) continue;
      const beginTs = toISO8601(beginUTC);
      readings.push({
        date:     beginTs.slice(0, 10),
        slotId:   beginTs.slice(11, 16).replace(":", ""),
        beginTs,
        endTs:    toISO8601(endUTC),
        valueKwh: (kw * 0.25).toFixed(6),
      });
    } else {
      // Header row: col A = label, col B = value
      const field = LASTGANG_FIELD_MAP[labelA];
      if (field && cellB?.v != null) fields[field] = String(cellB.v).trim();
    }
  }

  if (readings.length === 0) return [];

  fields["_readings_json"] = JSON.stringify(readings);
  return [fields];
}

/** URL where a daily energy TTL file is stored, given the building.ttl URL and date. */
export function buildingEnergyFileUrl(buildingUri: string, date: string): string {
  return `${buildingUri.replace(/\.ttl$/, "")}/energy/${date}.ttl`;
}

/** Generate Turtle content for one day of 15-min energy readings. */
export function generateEnergyDayTtl(
  date: string,
  readings: LastgangReading[],
  buildingSubjectUri: string,
  label: string,
): string {
  const blocks = readings
    .map(
      (r) =>
        `:r_${r.slotId} a uservoc:EnergyConsumptionReading ;\n` +
        `    sosa:observedProperty gran:ElectricityConsumption ;\n` +
        `    sosa:hasFeatureOfInterest <${buildingSubjectUri}> ;\n` +
        `    sosa:hasResult [ a sosa:Result ; sosa:hasSimpleResult "${r.valueKwh}"^^xsd:decimal ; ssn:hasUnit unit:KiloW-HR ] ;\n` +
        `    sosa:phenomenonTime [ a time:Interval ; time:hasBeginning "${r.beginTs}"^^xsd:dateTime ; time:hasEnd "${r.endTs}"^^xsd:dateTime ] .`,
    )
    .join("\n\n");

  return (
    `@prefix : <#> .\n` +
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n` +
    `@prefix sosa: <http://www.w3.org/ns/sosa/> .\n` +
    `@prefix ssn: <http://www.w3.org/ns/ssn/> .\n` +
    `@prefix time: <http://www.w3.org/2006/time#> .\n` +
    `@prefix unit: <https://qudt.org/vocab/unit#> .\n` +
    `@prefix gran: <${GRAN_NS}> .\n` +
    `@prefix uservoc: <${USERVOC_NS}> .\n` +
    `\n# 15-minute energy readings — ${date} (UTC)\n` +
    `# ${label}\n` +
    `# ${readings.length} reading(s)\n\n` +
    blocks + "\n"
  );
}

// ---------------------------------------------------------------------------

function xsdType(field: string): string {
  if (INTEGER_FIELDS.has(field)) return XSD_INTEGER;
  if (DECIMAL_FIELDS.has(field)) return XSD_DECIMAL;
  if (BOOLEAN_FIELDS.has(field)) return XSD_BOOLEAN;
  return XSD_STRING;
}


/**
 * Serialize investor operating costs as a single `investor:hasOperatingCosts`
 * blank node, from `_opcost_<field>` keys. The boolean category is typed
 * `xsd:boolean`; the rest are plain literals of the (already human-readable)
 * value — which is exactly what `buildingParser` reads back (its controlled-vocab
 * label lookup is a no-op for values that are already labels). No-op when no
 * `_opcost_*` keys are present.
 */
function addOperatingCosts(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  fields: Record<string, string>,
): void {
  const present = OPCOST_FIELDS.filter((f) => fields[`_opcost_${f}`]?.trim());
  if (present.length === 0) return;
  const oc = blankNode("opcosts");
  store.addQuad(subject, namedNode(`${INVESTOR_NS}hasOperatingCosts`), oc);
  for (const f of present) {
    const v = fields[`_opcost_${f}`].trim();
    if (OPCOST_BOOLEAN_FIELDS.has(f)) {
      store.addQuad(
        oc,
        namedNode(`${INVESTOR_NS}${f}`),
        literal(normalizeBoolean(v) || "false", namedNode(XSD_BOOLEAN)),
      );
    } else {
      store.addQuad(oc, namedNode(`${INVESTOR_NS}${f}`), literal(v));
    }
  }
}

/**
 * Serialize investor building certifications as `investor:hasBuildingCertification`
 * blank nodes, from indexed `_cert_<i>_type|level|scope` keys. The certification
 * type drives the blank node's `rdf:type` (`investor:<Type>Certification`), which
 * is how `buildingParser` recovers it; level/scope are plain literals. A cert with
 * no type is skipped (the parser requires a type to materialise it).
 */
function addCertifications(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  fields: Record<string, string>,
): void {
  for (let i = 0; i < MAX_CERTS; i++) {
    const type = fields[`_cert_${i}_type`]?.trim();
    if (!type) continue;
    const c = blankNode(`cert${i}`);
    store.addQuad(
      subject,
      namedNode(`${INVESTOR_NS}hasBuildingCertification`),
      c,
    );
    store.addQuad(
      c,
      namedNode(RDF_TYPE_IRI),
      namedNode(`${INVESTOR_NS}BuildingCertification`),
    );
    store.addQuad(
      c,
      namedNode(RDF_TYPE_IRI),
      namedNode(`${INVESTOR_NS}${type}Certification`),
    );
    const level = fields[`_cert_${i}_level`]?.trim();
    if (level) {
      store.addQuad(
        c,
        namedNode(`${INVESTOR_NS}certificationLevel`),
        literal(level),
      );
    }
    const scope = fields[`_cert_${i}_scope`]?.trim();
    if (scope) {
      store.addQuad(
        c,
        namedNode(`${INVESTOR_NS}certificationScope`),
        literal(scope),
      );
    }
  }
}

/**
 * Provenance of the building data, expressed as a PROV-O qualified attribution:
 * `<#b> prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <webid> ;
 * prov:hadRole gran:<category> ]`. Provenance only — it records who produced the
 * data and as what actor category; it never drives parsing/loading/rendering.
 */
function addProvenance(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  provenance: { agent: string; category: UserRole },
): void {
  const attr = blankNode("attribution");
  store.addQuad(subject, namedNode(PROV_QUALIFIED_ATTRIBUTION), attr);
  store.addQuad(attr, namedNode(RDF_TYPE_IRI), namedNode(PROV_ATTRIBUTION));
  store.addQuad(attr, namedNode(PROV_AGENT), namedNode(provenance.agent));
  store.addQuad(
    attr,
    namedNode(PROV_HAD_ROLE),
    namedNode(PROVENANCE_TO_IRI[provenance.category]),
  );
}

/**
 * Serialize a flat field map to a Turtle string for a single building.
 * All values are strings; numeric/boolean XSD types are applied by field name.
 * Object-property fields (shiftRegime, tenancyType, indoorTemperatureClass)
 * expect local names like "OneShift" and are expanded to full IRIs.
 * Energy is NOT inlined: each dataset is its own resource (see
 * {@link writeBuildingEnergy}); pass the dataset node URLs to emit as
 * `gran:hasEnergyDataset` links. `provenance`, when given, is recorded as a
 * PROV-O qualified attribution.
 */
export function serializeBuildingToTurtle(
  fields: Record<string, string>,
  buildingUri: string,
  energyDatasetUrls?: string[],
  provenance?: { agent: string; category: UserRole },
): string {
  const store = new Store();
  const id = buildingUri.split("/").pop()?.replace(".ttl", "") ?? "building";
  const subject = namedNode(`${buildingUri}#${id}`);

  store.addQuad(subject, namedNode(RDF_TYPE_IRI), namedNode(REC_BUILDING));

  for (const [field, value] of Object.entries(fields)) {
    if (!value || value.trim() === "" || field.startsWith("_")) continue;

    if (field in fieldToObjectPredicate) {
      store.addQuad(
        subject,
        namedNode(fieldToObjectPredicate[field]),
        namedNode(`${INVESTOR_NS}${value}`),
      );
    } else if (field in fieldToPredicate) {
      store.addQuad(
        subject,
        namedNode(fieldToPredicate[field]),
        literal(value, namedNode(xsdType(field))),
      );
    }
  }

  // Investor master-data sub-structures (blank nodes), when present.
  addOperatingCosts(store, subject, fields);
  addCertifications(store, subject, fields);

  // Provenance (PROV-O qualified attribution), when provided.
  if (provenance) addProvenance(store, subject, provenance);

  // Unified energy model: link each gran:EnergyDataset resource (written
  // separately by writeBuildingEnergy). One predicate, no inline observations.
  for (const url of energyDatasetUrls ?? []) {
    store.addQuad(subject, namedNode(`${GRAN_NS}hasEnergyDataset`), namedNode(url));
  }

  return new Writer({ format: "text/turtle" }).quadsToString(
    store.getQuads(null, null, null, null),
  );
}

/**
 * Write (or overwrite) a single year's annual `gran:EnergyDataset` resource and
 * ensure the building links it via `gran:hasEnergyDataset`. The slug encodes the
 * (year, granularity, scenario), so re-saving the same one replaces it — used by
 * the per-year energy entry form (actual or planned/Soll figures).
 */
export async function writeEnergyYear(
  session: Session,
  buildingFileUri: string,
  buildingSubjectUri: string,
  ds: EnergyDataset,
): Promise<void> {
  const fileUrl = datasetFileUrl(
    buildingFileUri,
    ds.year,
    ds.granularity,
    ds.scenario,
  );
  const put = await session.fetch(fileUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: serializeEnergyDataset({ ...ds, building: buildingSubjectUri }),
  });
  if (!put.ok) {
    throw new Error(`Failed to write energy dataset: ${put.status} ${put.statusText}`);
  }

  const link = namedNode(datasetNodeUrl(fileUrl));
  const subject = namedNode(buildingSubjectUri);
  const pred = namedNode(`${GRAN_NS}hasEnergyDataset`);
  await readModifyWrite(buildingFileUri, session, (store, { created }) => {
    if (created) return false; // the building file must already exist
    if (store.getQuads(subject, pred, link, null).length === 0) {
      store.addQuad(subject, pred, link);
    }
  });
}

/**
 * Fetch each building's actual annual `gran:EnergyDataset` resources and attach
 * them as `annualData` — energy is no longer inline, but the synchronous Excel
 * export reads that field. Mutates the buildings in place and returns them; call
 * before {@link buildingToXlsx} / {@link buildingsToXlsx}.
 */
export function attachAnnualData(
  buildings: BuildingType[],
  session: Session,
): Promise<BuildingType[]> {
  return Promise.all(buildings.map(async (b) => {
    const refs = (b.energyDatasets ?? []).filter(
      (r) => r.scenario === "actual" && !isSeriesGranularity(r.granularity),
    );
    if (refs.length === 0) return b;
    const datasets = await loadEnergyDatasets(refs, session.fetch.bind(session));
    const annualData = datasets
      .filter((d) => d.metrics)
      .map((d) => ({ year: d.year, ...d.metrics }) as InvestorAnnualData)
      .sort((a, c) => a.year - c.year);
    return { ...b, annualData }; // clone — don't mutate React Query's cache
  }));
}

/**
 * Build the annual `gran:EnergyDataset` objects from a building's field map —
 * the `_inv_<metric>_<year>` (investor, one dataset per year) and `_bsp_*`
 * (benchmark, single year) conventions. All actual-scenario P1Y aggregates.
 */
export function annualDatasetsFromFields(
  buildingSubjectUri: string,
  fields: Record<string, string>,
): EnergyDataset[] {
  const out: EnergyDataset[] = [];
  const num = (raw?: string): number | undefined => {
    if (!raw) return undefined;
    const v = parseFloat(raw);
    return isNaN(v) ? undefined : v;
  };
  const annual = (year: number, metrics: AnnualMetrics): void => {
    if (Object.keys(metrics).length > 0) {
      out.push({
        building: buildingSubjectUri,
        year,
        granularity: "P1Y",
        scenario: "actual",
        metrics,
      });
    }
  };

  // Investor: one dataset per year carrying any of elec/heat/water/renew.
  for (const year of INV_YEARS) {
    const metrics: AnnualMetrics = {};
    const elec = num(fields[`_inv_elec_${year}`]);
    const heat = num(fields[`_inv_heat_${year}`]);
    const water = num(fields[`_inv_water_${year}`]);
    const renew = num(fields[`_inv_renew_${year}`]);
    if (elec !== undefined) metrics.electricityConsumption = elec;
    if (heat !== undefined) metrics.heatConsumption = heat;
    if (water !== undefined) metrics.waterConsumption = water;
    if (renew !== undefined) metrics.renewableSelfGeneratedShare = renew;
    annual(year, metrics);
  }

  // Benchmark: a single year (`_bsp_year`, default 2024).
  const bspYear = parseInt(fields["_bsp_year"] || "2024");
  const bsp: AnnualMetrics = {};
  const be = num(fields["_bsp_elec"]);
  const bh = num(fields["_bsp_heat"]);
  const bw = num(fields["_bsp_water"]);
  const bww = num(fields["_bsp_wastewater"]);
  if (be !== undefined) bsp.electricityConsumption = be;
  if (bh !== undefined) bsp.heatConsumption = bh;
  if (bw !== undefined) bsp.waterConsumption = bw;
  if (bww !== undefined) bsp.wastewaterConsumption = bww;
  annual(bspYear, bsp);

  return out;
}

/**
 * Write a building's energy dataset resources and return their
 * `gran:hasEnergyDataset` link URLs (to pass to {@link serializeBuildingToTurtle}):
 *  - annual aggregates from the field map (one `<year>-P1Y.ttl` each), and
 *  - an optional 15-minute series (daily files under `<year>-PT15M/` + the
 *    located descriptor `<year>-PT15M.ttl`).
 */
export async function writeBuildingEnergy(
  session: Session,
  buildingUri: string,
  buildingSubjectUri: string,
  fields: Record<string, string>,
  series?: {
    year: number;
    days: Array<{ date: string; readings: LastgangReading[] }>;
    label: string;
  },
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const links: string[] = [];

  const putTtl = async (url: string, body: string): Promise<void> => {
    const res = await session.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Energy upload failed (${url}): ${res.status} ${res.statusText}`);
    }
  };

  for (const ds of annualDatasetsFromFields(buildingSubjectUri, fields)) {
    const fileUrl = datasetFileUrl(buildingUri, ds.year, ds.granularity, ds.scenario);
    await putTtl(fileUrl, serializeEnergyDataset(ds));
    links.push(datasetNodeUrl(fileUrl));
  }

  if (series && series.days.length > 0) {
    const container = seriesContainerUrl(buildingUri, series.year);
    await ensureContainer(container, session);
    // A full year is ~365 daily files; write them with bounded concurrency.
    const total = series.days.length;
    let done = 0;
    onProgress?.(0, total);
    await mapPooled(series.days, 8, async (day) => {
      const dailyUrl = seriesDailyFileUrl(buildingUri, series.year, day.date);
      await putTtl(
        dailyUrl,
        generateEnergyDayTtl(day.date, day.readings, buildingSubjectUri, series.label),
      );
      onProgress?.(++done, total);
    });
    const descUrl = datasetFileUrl(buildingUri, series.year, "PT15M", "actual");
    await putTtl(
      descUrl,
      serializeEnergyDataset({
        building: buildingSubjectUri,
        year: series.year,
        granularity: "PT15M",
        scenario: "actual",
        datasetLocation: container,
      }),
    );
    links.push(datasetNodeUrl(descUrl));
  }

  return links;
}

async function ensureBuildingsDirectoryExists(
  session: Session,
  webId: string,
): Promise<void> {
  const dir = `${getStorageRoot(webId)}granergize/buildings/`;
  try {
    const res = await session.fetch(dir, { method: "HEAD" });
    if (res.status === 404) {
      await session.fetch(dir, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: "",
      });
    }
  } catch {
    // directory may already exist
  }
}

export async function uploadBuilding(
  session: Session,
  buildingUri: string,
  ttlString: string,
  webId: string,
): Promise<void> {
  await ensureBuildingsDirectoryExists(session, webId);
  const res = await session.fetch(buildingUri, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: ttlString,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Patch scalar fields on an existing building Turtle file.
 * Fetches the current file, updates only the provided fields (preserving energy
 * observations and other complex blank-node structures), and PUTs it back.
 */
export async function updateBuilding(
  session: Session,
  buildingFileUri: string,
  subjectUri: string,
  updatedFields: Record<string, string>,
): Promise<void> {
  const subject = namedNode(subjectUri);
  await readModifyWrite(buildingFileUri, session, (store, { created }) => {
    if (created) throw new Error(`Building not found: ${buildingFileUri}`);
    for (const [field, value] of Object.entries(updatedFields)) {
      if (field.startsWith("_")) continue;

      const isObjProp = field in fieldToObjectPredicate;
      const predIri = isObjProp
        ? fieldToObjectPredicate[field]
        : fieldToPredicate[field];
      if (!predIri) continue;

      store.removeQuads(store.getQuads(subject, namedNode(predIri), null, null));
      if (!value?.trim()) continue;

      if (isObjProp) {
        store.addQuad(
          subject,
          namedNode(predIri),
          namedNode(`${INVESTOR_NS}${value}`),
        );
      } else {
        store.addQuad(
          subject,
          namedNode(predIri),
          literal(value, namedNode(xsdType(field))),
        );
      }
    }
  });
}

/** Construct the POD URL for a new building file. */
export function newBuildingUri(webId: string, id: string): string {
  return `${getStorageRoot(webId)}granergize/buildings/${id}.ttl`;
}

/**
 * Permanently delete a building the user owns: delete its per-building energy
 * subtree (`buildings/<id>/…`, if any), then delete the building file itself.
 * Own buildings are now discovered by *listing* the `buildings/` container, so
 * removing the file de-registers it — there's no registry to update. Refuses to
 * touch resources outside the user's own Pod (e.g. a building shared from
 * another Pod), which must only be *hidden*.
 */
export async function deleteBuilding(
  session: Session,
  webId: string,
  buildingFileUri: string,
): Promise<void> {
  const fileUri = buildingFileUri.split("#")[0];
  if (!fileUri.startsWith(getStorageRoot(webId))) {
    throw new Error("Refusing to delete a building outside your own Pod");
  }

  // Energy lives under a sibling container named after the building file
  // (buildingEnergyFileUrl strips the ".ttl"); remove it best-effort.
  await deleteContainerRecursive(`${fileUri.replace(/\.ttl$/, "")}/`, session)
    .catch(() => {});

  const res = await session.fetch(fileUri, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete building (HTTP ${res.status})`);
  }
}

// ── Demo seed ─────────────────────────────────────────────────────────────────

/**
 * Master data for the two demo buildings seeded into a fresh pod. Each carries
 * energy at a *different granularity* so a new user immediately sees both shapes
 * the app dispatches on (Phase 4): one annual aggregate, one 15-minute series.
 * `role` is provenance only — the render/load paths key on the data shape.
 */
const DEMO_BUILDINGS: Array<{
  fields: Record<string, string>;
  role: UserRole;
  energy: "annual" | "series";
}> = [
  {
    fields: {
      streetAddress: "Nordostpark 84",
      postalCode: "90411",
      locality: "Nürnberg",
      region: "Bayern",
    },
    role: "investor",
    energy: "annual", // inline P1Y SOSA observations → annual chart, bulk-loaded
  },
  {
    fields: {
      streetAddress: "Lange Gasse 20",
      postalCode: "90403",
      locality: "Nürnberg",
      region: "Bayern",
    },
    role: "user",
    energy: "series", // PT15M load profile in a daily file → lazy-loaded on click
  },
];

/**
 * Inline multi-year annual energy for the "annual" demo building, expressed as the
 * `_inv_*` fields serializeBuildingToTurtle turns into annual SOSA observations
 * (electricity/heat in kWh, water in m³). Years must be within INV_YEARS.
 */
const DEMO_ANNUAL_FIELDS: Record<string, string> = {
  _inv_elec_2022: "118000", _inv_elec_2023: "121500", _inv_elec_2024: "115200",
  _inv_heat_2022: "240000", _inv_heat_2023: "232000", _inv_heat_2024: "228500",
  _inv_water_2022: "1450", _inv_water_2023: "1500", _inv_water_2024: "1410",
};

/** A representative day of synthetic 15-minute readings (96 slots, UTC) with a
 * simple daytime-peaked load curve. Used for the "series" demo building. */
export function synthDayReadings(date: string): LastgangReading[] {
  const dayStart = new Date(`${date}T00:00:00Z`).getTime();
  const out: LastgangReading[] = [];
  for (let slot = 0; slot < 96; slot++) {
    const begin = new Date(dayStart + slot * 15 * 60 * 1000);
    const end = new Date(begin.getTime() + 15 * 60 * 1000);
    const hour = begin.getUTCHours() + begin.getUTCMinutes() / 60;
    // Base load + a daytime bump peaking ~midday; never negative.
    const kw = 12 + 18 * Math.max(0, Math.sin(((hour - 6) / 24) * 2 * Math.PI));
    const beginTs = toISO8601(begin);
    out.push({
      date: beginTs.slice(0, 10),
      slotId: beginTs.slice(11, 16).replace(":", ""),
      beginTs,
      endTs: toISO8601(end),
      valueKwh: (kw * 0.25).toFixed(6),
    });
  }
  return out;
}

/** Geocode an address to { lat, long } via Nominatim, or null on miss/failure. */
async function geocode(
  fields: Record<string, string>,
): Promise<{ lat: string; long: string } | null> {
  const query = [
    fields.streetAddress,
    fields.postalCode,
    fields.locality,
    fields.region,
  ].filter(Boolean).join(", ");
  if (!query) return null;
  try {
    const res = await trackedFetch(
      `https://nominatim.openstreetmap.org/search?q=${
        encodeURIComponent(query)
      }&format=json&limit=1`,
      { headers: { "User-Agent": "Granergize/1.0 (thomas.wehr@fau.de)" } },
      "geocode address",
    );
    const data = await res.json() as { lat: string; lon: string }[];
    if (!data.length) return null;
    return { lat: data[0].lat, long: data[0].lon };
  } catch {
    return null;
  }
}

/**
 * Seed two real, user-owned demo buildings into the user's pod. Called once when a
 * fresh registry is bootstrapped (see TurtleParsingService) so a brand-new user has
 * something to see; the buildings are ordinary owned resources the user can delete.
 * Coordinates are geocoded at seed time; a building that can't be geocoded is still
 * created (just unmapped). Best-effort: failures are logged, never thrown, so a
 * geocoder/network hiccup can't block login.
 */
export async function seedDemoBuildings(
  session: Session,
  webId: string,
): Promise<void> {
  for (const demo of DEMO_BUILDINGS) {
    try {
      const coords = await geocode(demo.fields);
      let fields: Record<string, string> = coords
        ? { ...demo.fields, lat: coords.lat, long: coords.long }
        : { ...demo.fields };
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const uri = newBuildingUri(webId, id);
      const subjectUri = `${uri}#${id}`;

      let series:
        | { year: number; days: Array<{ date: string; readings: LastgangReading[] }>; label: string }
        | undefined;

      if (demo.energy === "annual") {
        // Annual aggregate (P1Y) — written as one gran:EnergyDataset per year.
        fields = { ...fields, ...DEMO_ANNUAL_FIELDS };
      } else {
        // 15-minute series (PT15M): one demo day of readings.
        const day = "2024-06-03";
        series = {
          year: 2024,
          days: [{ date: day, readings: synthDayReadings(day) }],
          label: fields.streetAddress ?? "",
        };
      }

      // Write the energy dataset resources, then the building (with the links).
      const energyLinks = await writeBuildingEnergy(
        session,
        uri,
        subjectUri,
        fields,
        series,
      );
      const ttl = serializeBuildingToTurtle(fields, uri, energyLinks, {
        agent: webId,
        category: demo.role,
      });
      await uploadBuilding(session, uri, ttl, webId);
    } catch (err) {
      console.error(
        `Failed to seed demo building ${demo.fields.streetAddress}:`,
        err,
      );
    }
  }
}

// ── CSV / XLSX autofill ───────────────────────────────────────────────────────

/** BSP CSV column header (German) → BuildingType field name */
const BSP_COL_MAP: Record<string, string> = {
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
  "Innenraumtemperatur": "indoorTemperature",
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
 * Row labels mirror scripts/investor-to-ttl.ts exactly, including spacing.
 */
const INVESTOR_ROW_MAP: Record<string, string> = {
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
 * NOTE: these German row labels are ASSUMED — the investor `.xlsx` template is
 * binary and the original `scripts/investor-to-ttl.ts` is no longer in the repo,
 * so the exact labels could not be introspected. Verify against
 * `public/templates/` and adjust if they differ; rows that don't match are simply
 * skipped (no error), so a wrong label degrades to "not imported", never a crash.
 */
const INVESTOR_OPCOST_ROW_MAP: Record<string, string> = {
  "Abfallentsorgung": "wasteDisposal",
  "Versicherung": "insurance",
  "Betrieb, Inspektion und Wartung": "operationInspectionAndMaintenance",
  "Unterhaltsreinigung Büro": "routineCleaningOffice",
  "Unterhaltsreinigung Lager": "routineCleaningWarehouse",
  "Glasreinigung": "glassCleaning",
  "Außenanlagenpflege": "exteriorMaintenance",
  "Bewachung": "security",
  "Hausverwaltung": "propertyManagement",
  "Hausmeister": "caretaker",
  "Reparatur und Instandhaltung": "repairAndMaintenance",
};

/**
 * Investor XLSX row label (column B) → certification part. Produces a single
 * certification block (`_cert_0_type|level|scope`). Same caveat as
 * {@link INVESTOR_OPCOST_ROW_MAP}: labels are assumed pending template review.
 */
const INVESTOR_CERT_ROWS: Record<string, "type" | "level" | "scope"> = {
  "Zertifizierung": "type",
  "Zertifizierungslevel": "level",
  "Zertifizierungsumfang": "scope",
};

// ── Normalizers — mirror scripts exactly ──────────────────────────────────────

/** Mirrors investor-to-ttl.ts yesNo() + benchmark-to-ttl.ts parseBool() */
function normalizeBoolean(val: string): string {
  const s = val.trim().toLowerCase();
  if (["ja", "yes", "true", "j", "1"].includes(s)) return "true";
  if (["nein", "no", "false", "n", "0"].includes(s)) return "false";
  return "";
}

/** Strip German commas, percent signs, whitespace — mirrors parseNumeric() */
function normalizeNumber(val: string): string {
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

function applyNormalization(field: string, raw: string): string {
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

/**
 * Parse a CSV or XLSX file into one field map per building.
 *
 * Investor template:  row-label format (labels in col B, buildings in cols D–K).
 *                 Energy observations extracted from per-year rows.
 * BSP template:       column-header format (German headers, one row per building).
 *                 Energy columns mapped to _bsp_* keys; year defaults to 2024.
 * User / Dummy:   flat CSV with BuildingType field names as headers.
 */
export async function parseCsvToFields(
  file: File,
  template: UserRole,
): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
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

      for (const year of INV_YEARS) {
        const yearRows: [string, string][] = [
          [`Stromverbrauch ${year}`, `_inv_elec_${year}`],
          [`Wärme - tatsächlicher Verbrauch ${year}`, `_inv_heat_${year}`],
          [`Wasserverbrauch ${year}`, `_inv_water_${year}`],
        ];
        for (const [rowLabel, fieldKey] of yearRows) {
          const r = rowIndex[rowLabel];
          if (r === undefined) continue;
          const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
          if (cell?.v == null) continue;
          const v = normalizeNumber(String(cell.v));
          if (v) result[fieldKey] = v;
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

      // Certification block → _cert_0_<part> (type drives the cert's rdf:type).
      for (const [label, part] of Object.entries(INVESTOR_CERT_ROWS)) {
        const row = rowIndex[label];
        if (row === undefined) continue;
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell?.v == null) continue;
        const raw = String(cell.v).trim();
        if (raw) result[`_cert_0_${part}`] = raw;
      }

      if (Object.keys(result).length > 0) results.push(result);
    }
  } else {
    // Detect Lastgang format for User role (utility load-profile export)
    if (template === "user") {
      const wsRange = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      const parsed = parseLastgangXlsx(ws, wsRange);
      if (parsed.length > 0) return parsed;
    }

    // Column-header format (BSP and user/dummy) — one result per data row
    const colMap = template === "benchmark_service_provider" ? BSP_COL_MAP : {};
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
      if (template === "benchmark_service_provider" && !result["_bsp_year"]) {
        result["_bsp_year"] = "2024";
      }
      if (Object.keys(result).length > 0) results.push(result);
    }
  }

  return results;
}

// ── XLSX export (inverse of parseCsvToFields) ─────────────────────────────────

function invertMap(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) out[v] = k;
  return out;
}

// field → spreadsheet label/header (built once from the import maps).
const INV_FIELD_TO_LABEL = invertMap(INVESTOR_ROW_MAP);
const BSP_FIELD_TO_HEADER = invertMap(BSP_COL_MAP);
const OPCOST_FIELD_TO_LABEL = invertMap(INVESTOR_OPCOST_ROW_MAP);
const CERT_PART_TO_LABEL = invertMap(
  INVESTOR_CERT_ROWS as Record<string, string>,
);
// All scalar BuildingType fields, for the generic (user/dummy) sheet.
const SCALAR_FIELDS: string[] = [
  ...new Set(
    [
      ...Object.values(predicateMap),
      ...Object.values(objectPropertyMap),
    ].map((f) => String(f)),
  ),
];

function cellValue(v: unknown): string | number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return null; // skip nested structures
  return String(v);
}

/**
 * Build an XLSX workbook for a building, shaped to match the role's import
 * template so the file re-imports via {@link parseCsvToFields}:
 *   - investor → row-label sheet (label in col B, value in col D), with per-year
 *     energy rows, operating costs and the first certification block;
 *   - benchmark → single header row + value row, energy as `_bsp_*` columns;
 *   - user / dummy / unknown → flat sheet keyed by BuildingType field names.
 * Exports the *modelled* fields only (the whitelisted projection); the 15-minute
 * user series lives in separate lazy files and is not included.
 */
/** Build the worksheet for one building, shaped to its provenance template. */
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
    // The row-label template holds a single certification block.
    const cert = b.certifications?.[0];
    if (cert) {
      put(CERT_PART_TO_LABEL.type, cert.type);
      put(CERT_PART_TO_LABEL.level, cert.level);
      put(CERT_PART_TO_LABEL.scope, cert.scope);
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

export function buildingToWorkbook(b: BuildingType): XLSX.WorkBook {
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
export function buildingsToWorkbook(buildings: BuildingType[]): XLSX.WorkBook {
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
