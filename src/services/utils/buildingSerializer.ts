import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store, Writer } from "n3";
import type { UserRole } from "../../../types/types.ts";
import { objectPropertyMap, predicateMap } from "./config/buildingConfig.ts";
import {
  GRAN_NS,
  INVESTOR_NS,
  RDF_TYPE as RDF_TYPE_IRI,
  SOSA_NS,
  SSN_NS,
  TIME_NS,
  USERVOC_NS,
  XSD_DECIMAL,
  XSD_INTEGER,
} from "./vocabularies.ts";
import { getStorageRoot, registryUrl as registryUrlFor } from "./solidUtils.ts";
import { readModifyWrite } from "./podWrite.ts";
import { deleteContainerRecursive } from "./podDelete.ts";
import { trackedFetch } from "./networkActivity.ts";
import * as XLSX from "xlsx";

const { namedNode, literal, blankNode } = DataFactory;

// XSD datatypes not centralised in vocabularies.ts (only used here).
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";
const XSD_DATE = "http://www.w3.org/2001/XMLSchema#date";
const XSD_GYEAR = "http://www.w3.org/2001/XMLSchema#gYear";
const REC_BUILDING = "https://w3id.org/rec#Building";
const UNIT_NS = "https://qudt.org/vocab/unit#";

// Inverse maps: BuildingType field name → predicate IRI
const fieldToPredicate: Record<string, string> = Object.fromEntries(
  Object.entries(predicateMap).map(([iri, field]) => [field as string, iri]),
);
const fieldToObjectPredicate: Record<string, string> = Object.fromEntries(
  Object.entries(objectPropertyMap).map(([iri, field]) => [field as string, iri]),
);

const INTEGER_FIELDS = new Set([
  "postalCode",
  "buildingArea",
  "landArea",
  "officeArea",
  "yearOfConstruction",
  "numberOfLoadingDocks",
  "yearOfRenovation",
  "pvInstallationYear",
]);
const DECIMAL_FIELDS = new Set([
  "lat",
  "long",
  "naceCode",
  "hallArea",
  "officeSocialArea",
  "buildingHeight",
  "greenLeaseShare",
  "pvCapacityKW",
]);
const BOOLEAN_FIELDS = new Set([
  "hasPVSystem",
  "hasOilBoiler",
  "hasGasBoiler",
  "hasElectricBoiler",
  "hasHeatPump",
  "hasDistrictHeating",
]);

const ROLE_TO_IRI: Record<UserRole, string> = {
  dummy: `${GRAN_NS}DummyRole`,
  investor: `${GRAN_NS}InvestorRole`,
  user: `${GRAN_NS}UserRoleInstance`,
  benchmark_service_provider: `${GRAN_NS}BenchmarkRole`,
};

// Energy metric definitions for SOSA observation serialization
interface EnergyMetric {
  fieldKey: string;
  propIri: string;
  unitIri: string;
}

const INV_METRICS: Omit<EnergyMetric, "fieldKey">[] = [
  { propIri: `${INVESTOR_NS}AnnualElectricityConsumption`, unitIri: `${UNIT_NS}KiloW-HR` },
  { propIri: `${INVESTOR_NS}RenewableSelfGeneratedShare`, unitIri: `${UNIT_NS}PERCENT` },
  { propIri: `${INVESTOR_NS}AnnualHeatConsumption`, unitIri: `${UNIT_NS}KiloW-HR` },
  { propIri: `${INVESTOR_NS}AnnualWaterConsumption`, unitIri: `${UNIT_NS}M3` },
];

// Suffix → metric index (matches INV_METRICS order)
const INV_SUFFIX_IDX: Record<string, number> = {
  elec: 0,
  renew: 1,
  heat: 2,
  water: 3,
};

const BSP_METRICS: EnergyMetric[] = [
  { fieldKey: "_bsp_elec", propIri: `${INVESTOR_NS}AnnualElectricityConsumption`, unitIri: `${UNIT_NS}KiloW-HR` },
  { fieldKey: "_bsp_heat", propIri: `${INVESTOR_NS}AnnualHeatConsumption`, unitIri: `${UNIT_NS}KiloW-HR` },
  { fieldKey: "_bsp_water", propIri: `${INVESTOR_NS}AnnualWaterConsumption`, unitIri: `${UNIT_NS}M3` },
  {
    fieldKey: "_bsp_wastewater",
    propIri: `${INVESTOR_NS}AnnualWastewaterConsumption`,
    unitIri: `${UNIT_NS}M3`,
  },
];

const INV_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];

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

function addEnergyObservations(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  yearData: Array<{ year: number; metrics: Array<{ propIri: string; value: number; unitIri: string }> }>,
): void {
  yearData.forEach((yd, yi) => {
    if (yd.metrics.length === 0) return;
    const ds = blankNode(`dataset${yi}`);
    store.addQuad(subject, namedNode(`${INVESTOR_NS}hasInvestorAnnualData`), ds);
    store.addQuad(ds, namedNode(RDF_TYPE_IRI), namedNode(`${INVESTOR_NS}InvestorAnnualDataset`));
    store.addQuad(ds, namedNode(`${GRAN_NS}measurementYear`), literal(String(yd.year), namedNode(XSD_GYEAR)));

    yd.metrics.forEach((m, mi) => {
      const obs = blankNode(`obs${yi}_${mi}`);
      const res = blankNode(`res${yi}_${mi}`);
      const iv = blankNode(`int${yi}_${mi}`);

      store.addQuad(obs, namedNode(RDF_TYPE_IRI), namedNode(`${SOSA_NS}Observation`));
      store.addQuad(obs, namedNode(`${SOSA_NS}observedProperty`), namedNode(m.propIri));
      store.addQuad(obs, namedNode(`${SOSA_NS}hasFeatureOfInterest`), subject);
      store.addQuad(obs, namedNode(`${SOSA_NS}hasResult`), res);
      store.addQuad(obs, namedNode(`${SOSA_NS}phenomenonTime`), iv);

      store.addQuad(res, namedNode(RDF_TYPE_IRI), namedNode(`${SOSA_NS}Result`));
      store.addQuad(res, namedNode(`${SOSA_NS}hasSimpleResult`), literal(String(m.value), namedNode(XSD_DECIMAL)));
      store.addQuad(res, namedNode(`${SSN_NS}hasUnit`), namedNode(m.unitIri));

      store.addQuad(iv, namedNode(RDF_TYPE_IRI), namedNode(`${TIME_NS}Interval`));
      store.addQuad(iv, namedNode(`${TIME_NS}hasBeginning`), literal(`${yd.year}-01-01`, namedNode(XSD_DATE)));
      store.addQuad(iv, namedNode(`${TIME_NS}hasEnd`), literal(`${yd.year}-12-31`, namedNode(XSD_DATE)));
    });
  });
}

/**
 * Serialize a flat field map to a Turtle string for a single building.
 * All values are strings; numeric/boolean XSD types are applied by field name.
 * Object-property fields (shiftRegime, tenancyType, indoorTemperatureClass)
 * expect local names like "OneShift" and are expanded to full IRIs.
 * Special keys _inv_*_{year} and _bsp_* are serialized as SOSA observations.
 */
export function serializeBuildingToTurtle(
  fields: Record<string, string>,
  buildingUri: string,
  energyDatasets?: { date: string; location: string }[],
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

  // Investor multi-year energy observations
  const invYearData = INV_YEARS.map((year, yi) => {
    const metrics: Array<{ propIri: string; value: number; unitIri: string }> = [];
    for (const [suffix, idx] of Object.entries(INV_SUFFIX_IDX)) {
      const raw = fields[`_inv_${suffix}_${year}`];
      if (!raw) continue;
      const value = parseFloat(raw);
      if (isNaN(value)) continue;
      metrics.push({ ...INV_METRICS[idx], value });
    }
    return { year, metrics, yi };
  }).filter((d) => d.metrics.length > 0);

  if (invYearData.length > 0) {
    addEnergyObservations(store, subject, invYearData);
  }

  // BSP single-year energy observations
  const bspYear = parseInt(fields["_bsp_year"] || "2024");
  const bspMetrics = BSP_METRICS.map((m) => {
    const raw = fields[m.fieldKey];
    if (!raw) return null;
    const value = parseFloat(raw);
    if (isNaN(value)) return null;
    return { propIri: m.propIri, unitIri: m.unitIri, value };
  }).filter(Boolean) as Array<{ propIri: string; unitIri: string; value: number }>;

  if (bspMetrics.length > 0) {
    addEnergyObservations(store, subject, [{ year: bspYear, metrics: bspMetrics }]);
  }

  // User-role energy dataset links (one blank node per daily TTL file)
  if (energyDatasets && energyDatasets.length > 0) {
    energyDatasets.forEach((ds, i) => {
      const dsNode = blankNode(`eds${i}`);
      store.addQuad(subject, namedNode(`${GRAN_NS}hasEnergyConsumptionDataset`), dsNode);
      store.addQuad(dsNode, namedNode(RDF_TYPE_IRI), namedNode(`${USERVOC_NS}EnergyConsumptionDataset`));
      store.addQuad(dsNode, namedNode(`${GRAN_NS}datasetDate`), literal(ds.date, namedNode(XSD_DATE)));
      store.addQuad(dsNode, namedNode(`${GRAN_NS}datasetLocation`), namedNode(ds.location));
      // gran:type is required for the parser to surface this dataset on
      // building.energyData (it filters out datasets lacking year+location+type);
      // without it the lazy 15-min chart never sees the daily files.
      store.addQuad(dsNode, namedNode(`${GRAN_NS}type`), literal("electricity"));
      // Declare the observation period so the loader can dispatch on granularity,
      // not role: these daily files hold 15-minute readings.
      store.addQuad(dsNode, namedNode(`${GRAN_NS}granularity`), literal("PT15M"));
    });
  }

  return new Writer({ format: "text/turtle" }).quadsToString(
    store.getQuads(null, null, null, null),
  );
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
 * Add a building source URL to the user's dataSources.ttl registry.
 * Reads the current registry, appends two quads, and PUTs it back.
 */
export async function addBuildingToRegistry(
  session: Session,
  webId: string,
  buildingUri: string,
  role: UserRole,
): Promise<void> {
  const registryUrl = registryUrlFor(webId);
  await readModifyWrite(registryUrl, session, (store) => {
    store.addQuad(
      namedNode(registryUrl),
      namedNode(`${GRAN_NS}hasBuildingDataSource`),
      namedNode(buildingUri),
    );
    store.addQuad(
      namedNode(buildingUri),
      namedNode(`${GRAN_NS}dataSourceRole`),
      namedNode(ROLE_TO_IRI[role]),
    );
  });
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
 * Remove a building source from the registry — the inverse of
 * {@link addBuildingToRegistry}. Drops both the `gran:hasBuildingDataSource`
 * link and the building's `gran:dataSourceRole` triple, then PUTs the registry
 * back. A missing registry is a no-op.
 */
export async function removeBuildingFromRegistry(
  session: Session,
  webId: string,
  buildingUri: string,
): Promise<void> {
  const registryUrl = registryUrlFor(webId);
  await readModifyWrite(registryUrl, session, (store, { created }) => {
    if (created) return false; // no registry → nothing to remove
    store.removeQuads(store.getQuads(
      namedNode(registryUrl),
      namedNode(`${GRAN_NS}hasBuildingDataSource`),
      namedNode(buildingUri),
      null,
    ));
    store.removeQuads(store.getQuads(
      namedNode(buildingUri),
      namedNode(`${GRAN_NS}dataSourceRole`),
      null,
      null,
    ));
  });
}

/**
 * Permanently delete a building the user owns: de-register it, delete its
 * per-building energy subtree (`buildings/<id>/…`, if any), then delete the
 * building file itself. Refuses to touch resources outside the user's own Pod
 * (e.g. a building shared from another Pod), which must only be *hidden*.
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

  await removeBuildingFromRegistry(session, webId, fileUri);

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

      let energyDatasets: { date: string; location: string }[] | undefined;

      if (demo.energy === "annual") {
        // Annual aggregate (P1Y): inline SOSA observations, no separate file.
        fields = { ...fields, ...DEMO_ANNUAL_FIELDS };
      } else {
        // 15-minute series (PT15M): write one daily readings file and link it.
        const day = "2024-06-03";
        const subjectUri = `${uri}#${id}`;
        const readings = synthDayReadings(day);
        const energyUrl = buildingEnergyFileUrl(uri, day);
        const dayTtl = generateEnergyDayTtl(
          day, readings, subjectUri, fields.streetAddress ?? "",
        );
        const res = await session.fetch(energyUrl, {
          method: "PUT",
          headers: { "Content-Type": "text/turtle" },
          body: dayTtl,
        });
        if (!res.ok) {
          throw new Error(`Energy upload failed: ${res.status} ${res.statusText}`);
        }
        energyDatasets = [{ date: day, location: energyUrl }];
      }

      const ttl = serializeBuildingToTurtle(fields, uri, energyDatasets);
      await uploadBuilding(session, uri, ttl, webId);
      await addBuildingToRegistry(session, webId, uri, demo.role);
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
 * Investor role:  row-label format (labels in col B, buildings in cols D–K).
 *                 Energy observations extracted from per-year rows.
 * BSP role:       column-header format (German headers, one row per building).
 *                 Energy columns mapped to _bsp_* keys; year defaults to 2024.
 * User / Dummy:   flat CSV with BuildingType field names as headers.
 */
export async function parseCsvToFields(
  file: File,
  role: UserRole,
): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const results: Record<string, string>[] = [];

  if (role === "investor") {
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

      if (Object.keys(result).length > 0) results.push(result);
    }
  } else {
    // Detect Lastgang format for User role (utility load-profile export)
    if (role === "user") {
      const wsRange = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      const parsed = parseLastgangXlsx(ws, wsRange);
      if (parsed.length > 0) return parsed;
    }

    // Column-header format (BSP and user/dummy) — one result per data row
    const colMap = role === "benchmark_service_provider" ? BSP_COL_MAP : {};
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
      if (role === "benchmark_service_provider" && !result["_bsp_year"]) {
        result["_bsp_year"] = "2024";
      }
      if (Object.keys(result).length > 0) results.push(result);
    }
  }

  return results;
}
