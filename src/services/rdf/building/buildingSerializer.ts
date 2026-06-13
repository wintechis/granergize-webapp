import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store, Writer } from "n3";
import type { BuildingType, AnnualData } from "../../../types.ts";
import {
  BOOLEAN_FIELDS,
  DECIMAL_FIELDS,
  INTEGER_FIELDS,
  iriPropertyMap,
  objectPropertyMap,
  predicateMap,
} from "./buildingConfig.ts";
import {
  BUILDING_NS,
  CONSUMPTION_NS,
  GEO_LAT,
  GEO_LOCATION,
  GEO_LONG,
  GEO_POINT,
  GEOCODE_PRECISION_IRI,
  GRAN_GEOCODE_PRECISION,
  PROV_AGENT,
  PROV_ATTRIBUTION,
  PROV_QUALIFIED_ATTRIBUTION,
  RDF_TYPE as RDF_TYPE_IRI,
  REC_BUILDING,
  type GeocodePrecision,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_INTEGER,
  XSD_STRING,
} from "../vocabularies.ts";
import {
  type AnnualMetrics,
  datasetFileUri,
  datasetNodeUri,
  type EnergyDataset,
  loadEnergyDatasets,
  serializeEnergyDataset,
  seriesContainerUri,
  seriesDailyFileUri,
} from "../energyDataset.ts";
import { isSeriesGranularity } from "../durationUtils.ts";
import { getStorageRoot, podResources } from "../../pod/solidUtils.ts";
import { ensureContainer, readModifyWrite } from "../../pod/podWrite.ts";
import { logError } from "../../../lib/logError.ts";
import { mapPooled } from "../../../lib/pool.ts";
import { deleteContainerRecursive, listDirectChildren } from "../../pod/podDelete.ts";
import { geocodeFields } from "../../geocode.ts";
import { mintLocalIri } from "../rdfHelpers.ts";
import { buildingFileUri, mintBuildingSubject } from "./buildingId.ts";
import {
  generateEnergyDayTtl,
  type LastgangReading,
  parseLastgangXlsx,
  synthDayReadings,
} from "../energySeriesXlsx.ts";
import {
  applyNormalization,
  BSP_COL_MAP,
  certLevelLabel,
  INV_YEAR_ROW_STEMS,
  INVESTOR_CERT_SYSTEMS,
  INVESTOR_OPCOST_ROW_MAP,
  INVESTOR_ROW_MAP,
  MAX_CERTS,
  normalizeBoolean,
  normalizeNumber,
  OPCOST_BOOLEAN_FIELDS,
  OPCOST_FIELDS,
  type SpreadsheetFormat,
  yearsIn,
} from "../buildingTemplates.ts";
import * as XLSX from "xlsx";

const { namedNode, literal, blankNode } = DataFactory;

// Inverse maps: BuildingType field name → predicate IRI
const fieldToPredicate: Record<string, string> = Object.fromEntries(
  Object.entries(predicateMap).map(([iri, field]) => [field as string, iri]),
);
const fieldToObjectPredicate: Record<string, string> = Object.fromEntries(
  Object.entries(objectPropertyMap).map(([iri, field]) => [field as string, iri]),
);
// Agent/IRI-reference fields (e.g. operatedBy → WebID): the value is written as a
// NamedNode verbatim (an absolute IRI), not a literal or a prefix-expanded local name.
const fieldToIriPredicate: Record<string, string> = Object.fromEntries(
  Object.entries(iriPropertyMap).map(([iri, field]) => [field as string, iri]),
);

// An agent field's value is a WebID/IRI only when it carries a URI scheme; write
// those as a NamedNode. A legacy literal value (e.g. an investor name like
// "Aurelis" on an older Pod / import template) has no scheme — write it as a plain
// string literal instead, both to produce valid Turtle and to mirror the parser's
// read tolerance for legacy literals.
const isIriValue = (v: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(v);

// INTEGER_FIELDS / DECIMAL_FIELDS / BOOLEAN_FIELDS are derived from the building
// field descriptor table (buildingConfig.ts) so read and write share one source.



function xsdType(field: string): string {
  if (INTEGER_FIELDS.has(field)) return XSD_INTEGER;
  if (DECIMAL_FIELDS.has(field)) return XSD_DECIMAL;
  if (BOOLEAN_FIELDS.has(field)) return XSD_BOOLEAN;
  return XSD_STRING;
}

/**
 * The predicate IRI a building field is written under, or undefined for a field
 * the config doesn't map. Checked in the same precedence the field tables are
 * partitioned by: controlled-vocab object property, then agent/IRI reference,
 * then typed literal.
 */
function predicateFor(field: string): string | undefined {
  return fieldToObjectPredicate[field] ?? fieldToIriPredicate[field] ??
    fieldToPredicate[field];
}

/**
 * The RDF object term for a building field's value: a controlled-vocab field's
 * local name (e.g. "OneShift") expands to a `BUILDING_NS` IRI; an agent/IRI field
 * is a NamedNode when the value carries a URI scheme (a legacy non-IRI value
 * stays a plain literal — see {@link isIriValue}); everything else is a literal
 * typed by the field's XSD datatype. Shared by the create (serialize) and edit
 * (update) paths so the two can't drift.
 */
function objectTermFor(
  field: string,
  value: string,
): ReturnType<typeof namedNode> | ReturnType<typeof literal> {
  if (field in fieldToObjectPredicate) {
    // A controlled-vocab value is an IRI local name ("OneShift"); validate-then-
    // mint so junk reaching this path (e.g. an unmapped import label) fails
    // loudly instead of corrupting the building file.
    return mintLocalIri(BUILDING_NS, value, `not a known "${field}" value`);
  }
  if (field in fieldToIriPredicate) {
    return isIriValue(value) ? namedNode(value) : literal(value);
  }
  return literal(value, namedNode(xsdType(field)));
}


/**
 * Write the building's coordinates as a `geo:Point` blank node linked by
 * `geo:location`, carrying `bldg:geocodePrecision` when known. Keeping the point
 * separate from the building lets the precision sit on the coordinate itself.
 * No-op when lat/long are absent (an unmapped building is still valid).
 */
function addGeoPoint(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  fields: Record<string, string>,
): void {
  const lat = fields.lat?.trim();
  const long = fields.long?.trim();
  if (!lat || !long) return;
  const point = blankNode("point");
  store.addQuad(subject, namedNode(GEO_LOCATION), point);
  store.addQuad(point, namedNode(RDF_TYPE_IRI), namedNode(GEO_POINT));
  store.addQuad(point, namedNode(GEO_LAT), literal(lat, namedNode(XSD_DECIMAL)));
  store.addQuad(point, namedNode(GEO_LONG), literal(long, namedNode(XSD_DECIMAL)));
  const precision = fields.geocodePrecision?.trim();
  if (precision && precision in GEOCODE_PRECISION_IRI) {
    store.addQuad(
      point,
      namedNode(GRAN_GEOCODE_PRECISION),
      namedNode(GEOCODE_PRECISION_IRI[precision as GeocodePrecision]),
    );
  }
}

/**
 * The shared edit-path shape behind {@link replaceGeoPoint} /
 * {@link replaceOperatingCosts} / {@link replaceCertifications}: drop every node
 * linked from `subject` via `predIri` (with the linked node's own triples), then
 * re-add fresh ones from `fields` via `addFn`.
 */
function replaceLinkedNodes(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  predIri: string,
  fields: Record<string, string>,
  addFn: (
    store: Store,
    subject: ReturnType<typeof namedNode>,
    fields: Record<string, string>,
  ) => void,
): void {
  for (const link of store.getQuads(subject, namedNode(predIri), null, null)) {
    store.removeQuads(store.getQuads(link.object, null, null, null));
    store.removeQuad(link);
  }
  addFn(store, subject, fields);
}

/**
 * Replace the building's coordinates on an EXISTING store (the edit path): drop
 * the current geo:Point (and any legacy flat geo:lat/long), then re-add a fresh
 * point from `fields`. Migrates legacy flat-coordinate buildings to the point
 * model on first edit.
 */
function replaceGeoPoint(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  fields: Record<string, string>,
): void {
  store.removeQuads(store.getQuads(subject, namedNode(GEO_LAT), null, null));
  store.removeQuads(store.getQuads(subject, namedNode(GEO_LONG), null, null));
  replaceLinkedNodes(store, subject, GEO_LOCATION, fields, addGeoPoint);
}

/**
 * Replace the building's `investor:hasOperatingCosts` node on an EXISTING store
 * (the edit path): drop the current node (and its triples), then re-add from
 * `fields`. Mirrors {@link replaceGeoPoint}; call only when the edit carries
 * `_opcost_*` keys, so an edit that doesn't touch operating costs leaves them be.
 */
function replaceOperatingCosts(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  fields: Record<string, string>,
): void {
  replaceLinkedNodes(
    store,
    subject,
    `${BUILDING_NS}hasOperatingCosts`,
    fields,
    addOperatingCosts,
  );
}

/**
 * Replace the building's `investor:hasBuildingCertification` nodes on an EXISTING
 * store (the edit path): drop all current ones, then re-add from `fields`. Call
 * only when the edit carries `_cert_*` keys.
 */
function replaceCertifications(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  fields: Record<string, string>,
): void {
  replaceLinkedNodes(
    store,
    subject,
    `${BUILDING_NS}hasBuildingCertification`,
    fields,
    addCertifications,
  );
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
  store.addQuad(subject, namedNode(`${BUILDING_NS}hasOperatingCosts`), oc);
  for (const f of present) {
    const v = fields[`_opcost_${f}`].trim();
    if (OPCOST_BOOLEAN_FIELDS.has(f)) {
      store.addQuad(
        oc,
        namedNode(`${BUILDING_NS}${f}`),
        literal(normalizeBoolean(v) || "false", namedNode(XSD_BOOLEAN)),
      );
    } else {
      store.addQuad(oc, namedNode(`${BUILDING_NS}${f}`), literal(v));
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
    // The type becomes an IRI local name (`bldg:<type>Certification`);
    // validate-then-mint, see {@link mintLocalIri}.
    const certClass = mintLocalIri(
      BUILDING_NS,
      `${type}Certification`,
      `use a known certification system (e.g. ${INVESTOR_CERT_SYSTEMS.join(", ")})`,
    );
    const c = blankNode(`cert${i}`);
    store.addQuad(
      subject,
      namedNode(`${BUILDING_NS}hasBuildingCertification`),
      c,
    );
    store.addQuad(
      c,
      namedNode(RDF_TYPE_IRI),
      namedNode(`${BUILDING_NS}BuildingCertification`),
    );
    store.addQuad(c, namedNode(RDF_TYPE_IRI), certClass);
    const level = fields[`_cert_${i}_level`]?.trim();
    if (level) {
      store.addQuad(
        c,
        namedNode(`${BUILDING_NS}certificationLevel`),
        literal(level),
      );
    }
    const scope = fields[`_cert_${i}_scope`]?.trim();
    if (scope) {
      store.addQuad(
        c,
        namedNode(`${BUILDING_NS}certificationScope`),
        literal(scope),
      );
    }
  }
}

/**
 * Provenance of the building data, expressed as a PROV-O qualified attribution:
 * `<#b> prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <webid> ]`.
 * Records only WHO produced the data (no producing-role category — roles live only
 * in data rooms now); it never drives parsing/loading/rendering.
 */
function addProvenance(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  provenance: { agent: string },
): void {
  const attr = blankNode("attribution");
  store.addQuad(subject, namedNode(PROV_QUALIFIED_ATTRIBUTION), attr);
  store.addQuad(attr, namedNode(RDF_TYPE_IRI), namedNode(PROV_ATTRIBUTION));
  store.addQuad(attr, namedNode(PROV_AGENT), namedNode(provenance.agent));
}

/**
 * Serialize a flat field map to a Turtle string for a single building.
 * All values are strings; numeric/boolean XSD types are applied by field name.
 * Object-property fields (shiftRegime, tenancyType, indoorTemperatureClass)
 * expect local names like "OneShift" and are expanded to full IRIs.
 * Energy is NOT inlined: each dataset is its own resource (see
 * {@link writeBuildingEnergy}); pass the dataset node URLs to emit as
 * `cons:hasEnergyDataset` links. `provenance`, when given, is recorded as a
 * PROV-O qualified attribution (the producing agent only).
 */
export function serializeBuildingToTurtle(
  fields: Record<string, string>,
  buildingUri: string,
  energyDatasetUris?: string[],
  provenance?: { agent: string },
): string {
  const store = new Store();
  const subject = namedNode(mintBuildingSubject(buildingUri));

  store.addQuad(subject, namedNode(RDF_TYPE_IRI), namedNode(REC_BUILDING));

  for (const [field, value] of Object.entries(fields)) {
    if (!value || value.trim() === "" || field.startsWith("_")) continue;
    // lat/long are written as a geo:Point blank node (see addGeoPoint), not flat
    // on the building — skip them here even though the config still maps them (so
    // legacy flat-coordinate Pods can still be parsed).
    if (field === "lat" || field === "long") continue;

    const predIri = predicateFor(field);
    if (predIri) {
      store.addQuad(subject, namedNode(predIri), objectTermFor(field, value));
    }
  }

  // Coordinates as a geo:Point blank node (carries geocoding precision).
  addGeoPoint(store, subject, fields);

  // Investor master-data sub-structures (blank nodes), when present.
  addOperatingCosts(store, subject, fields);
  addCertifications(store, subject, fields);

  // Provenance (PROV-O qualified attribution), when provided.
  if (provenance) addProvenance(store, subject, provenance);

  // Unified energy model: link each cons:EnergyDataset resource (written
  // separately by writeBuildingEnergy). One predicate, no inline observations.
  for (const url of energyDatasetUris ?? []) {
    store.addQuad(subject, namedNode(`${CONSUMPTION_NS}hasEnergyDataset`), namedNode(url));
  }

  return new Writer({ format: "text/turtle" }).quadsToString(
    store.getQuads(null, null, null, null),
  );
}

/**
 * Write (or overwrite) a single year's annual `cons:EnergyDataset` resource and
 * ensure the building links it via `cons:hasEnergyDataset`. The slug encodes the
 * (year, granularity, scenario), so re-saving the same one replaces it — used by
 * the per-year energy entry form (actual or planned/Soll figures).
 * @operation mutation
 */
export async function writeEnergyYear(
  session: Session,
  buildingFileUri: string,
  buildingSubjectUri: string,
  ds: EnergyDataset,
): Promise<void> {
  const fileUri = datasetFileUri(
    buildingFileUri,
    ds.year,
    ds.granularity,
    ds.scenario,
  );
  const put = await session.fetch(fileUri, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: serializeEnergyDataset({ ...ds, building: buildingSubjectUri }),
  });
  if (!put.ok) {
    throw new Error(`Failed to write energy dataset: ${put.status} ${put.statusText}`);
  }

  const link = namedNode(datasetNodeUri(fileUri));
  const subject = namedNode(buildingSubjectUri);
  const pred = namedNode(`${CONSUMPTION_NS}hasEnergyDataset`);
  await readModifyWrite(buildingFileUri, session, (store, { created }) => {
    if (created) return false; // the building file must already exist
    if (store.getQuads(subject, pred, link, null).length === 0) {
      store.addQuad(subject, pred, link);
    }
  });
}

/**
 * Delete one year's annual `cons:EnergyDataset` resource and drop the building's
 * `cons:hasEnergyDataset` link to it — the inverse of {@link writeEnergyYear},
 * used by the per-year energy entry form to remove a year entered by mistake.
 * Annual (single-file) datasets only; series (`PT15M`) live in a container and
 * are not managed here. A 404 on the dataset is treated as "already gone".
 * @operation mutation
 */
export async function deleteEnergyYear(
  session: Session,
  buildingFileUri: string,
  buildingSubjectUri: string,
  ds: Pick<EnergyDataset, "year" | "granularity" | "scenario">,
): Promise<void> {
  const fileUri = datasetFileUri(
    buildingFileUri,
    ds.year,
    ds.granularity,
    ds.scenario,
  );
  const del = await session.fetch(fileUri, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    throw new Error(
      `Failed to delete energy dataset: ${del.status} ${del.statusText}`,
    );
  }
  // Drop the now-orphaned per-resource ACL if it had one (best-effort).
  await session.fetch(`${fileUri}.acl`, { method: "DELETE" }).catch((err) =>
    logError("delete energy dataset ACL", err)
  );

  // Unlink it from the building file (skip the PUT when there's nothing to remove).
  const link = namedNode(datasetNodeUri(fileUri));
  const subject = namedNode(buildingSubjectUri);
  const pred = namedNode(`${CONSUMPTION_NS}hasEnergyDataset`);
  await readModifyWrite(buildingFileUri, session, (store, { created }) => {
    if (created) return false; // building file gone — nothing to unlink
    const quads = store.getQuads(subject, pred, link, null);
    if (quads.length === 0) return false;
    for (const q of quads) store.removeQuad(q);
  });
}

/**
 * Fetch each building's actual annual `cons:EnergyDataset` resources and attach
 * them as `annualData` — energy is no longer inline, but the synchronous Excel
 * export reads that field. Mutates the buildings in place and returns them; call
 * before `buildingToXlsx` / `buildingsToXlsx` (buildingWorkbook.ts).
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
      .map((d) => ({ year: d.year, ...d.metrics }) as AnnualData)
      .sort((a, c) => a.year - c.year);
    return { ...b, annualData }; // clone — don't mutate React Query's cache
  }));
}

/**
 * Build the annual `cons:EnergyDataset` objects from a building's field map —
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

  // Investor: one dataset per year carrying any of elec/heat/water/renew. The
  // years come from the `_inv_*_<year>` field keys themselves, not a hardcoded
  // range — an import carrying a newer year must not silently drop it.
  const invYears = yearsIn(Object.keys(fields), /^_inv_[a-z]+_(\d{4})$/i);
  for (const year of invYears) {
    const metrics: AnnualMetrics = {};
    for (const { key, field } of INV_YEAR_ROW_STEMS) {
      const v = num(fields[`_inv_${key}_${year}`]);
      if (v !== undefined) metrics[field] = v;
    }
    const renew = num(fields[`_inv_renew_${year}`]);
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
 * `cons:hasEnergyDataset` link IRIs (to pass to {@link serializeBuildingToTurtle}):
 *  - annual aggregates from the field map (one `<year>-P1Y.ttl` each), and
 *  - an optional 15-minute series (daily files under `<year>-PT15M/` + the
 *    located descriptor `<year>-PT15M.ttl`).
 * @operation mutation
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
  signal?: AbortSignal,
): Promise<string[]> {
  const links: string[] = [];

  const putTtl = async (url: string, body: string): Promise<void> => {
    signal?.throwIfAborted();
    const res = await session.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body,
      signal,
    });
    if (!res.ok) {
      throw new Error(`Energy upload failed (${url}): ${res.status} ${res.statusText}`);
    }
  };

  for (const ds of annualDatasetsFromFields(buildingSubjectUri, fields)) {
    const fileUri = datasetFileUri(buildingUri, ds.year, ds.granularity, ds.scenario);
    await putTtl(fileUri, serializeEnergyDataset(ds));
    links.push(datasetNodeUri(fileUri));
  }

  if (series && series.days.length > 0) {
    const container = seriesContainerUri(buildingUri, series.year);
    await ensureContainer(container, session);
    // A full year is ~365 daily files; write them with bounded concurrency.
    const total = series.days.length;
    let done = 0;
    onProgress?.(0, total);
    await mapPooled(series.days, 8, async (day) => {
      signal?.throwIfAborted();
      const dailyUri = seriesDailyFileUri(buildingUri, series.year, day.date);
      await putTtl(
        dailyUri,
        generateEnergyDayTtl(day.date, day.readings, buildingSubjectUri, series.label),
      );
      onProgress?.(++done, total);
    });
    const descUri = datasetFileUri(buildingUri, series.year, "PT15M", "actual");
    await putTtl(
      descUri,
      serializeEnergyDataset({
        building: buildingSubjectUri,
        year: series.year,
        granularity: "PT15M",
        scenario: "actual",
        datasetLocation: container,
      }),
    );
    links.push(datasetNodeUri(descUri));
  }

  return links;
}

/**
 * Upload a building Turtle file to the user's Pod (provisioning the `buildings/`
 * container first), PUT-overwriting any existing file at the URI.
 * @operation mutation
 */
export async function uploadBuilding(
  session: Session,
  buildingUri: string,
  ttlString: string,
  webId: string,
  signal?: AbortSignal,
): Promise<void> {
  // Provision the buildings/ container first (silently — the add flow has its
  // own "Building added" toast) so the building-file PUT below has somewhere
  // to land — via the shared helper.
  await ensureContainer(podResources(webId).buildings, session);
  signal?.throwIfAborted();
  const res = await session.fetch(buildingUri, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: ttlString,
    signal,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Patch scalar fields on an existing building Turtle file.
 * Fetches the current file, updates only the provided fields (preserving energy
 * observations and other complex blank-node structures), and PUTs it back.
 * @operation mutation
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
      // Coordinates are rewritten as a geo:Point below, not flat on the subject.
      if (field === "lat" || field === "long") continue;

      const predIri = predicateFor(field);
      if (!predIri) continue;

      store.removeQuads(store.getQuads(subject, namedNode(predIri), null, null));
      if (!value?.trim()) continue;

      store.addQuad(subject, namedNode(predIri), objectTermFor(field, value));
    }
    // Rewrite the geo:Point when coordinates were edited (also migrates a legacy
    // flat-coordinate building to the point model).
    if ("lat" in updatedFields || "long" in updatedFields) {
      replaceGeoPoint(store, subject, updatedFields);
    }
    // Replace the investor master-data blank nodes only when the edit actually
    // carries their keys — a partial edit without them leaves existing data intact.
    const keys = Object.keys(updatedFields);
    if (keys.some((k) => k.startsWith("_opcost_"))) {
      replaceOperatingCosts(store, subject, updatedFields);
    }
    if (keys.some((k) => k.startsWith("_cert_"))) {
      replaceCertifications(store, subject, updatedFields);
    }
  });
}

/** Construct the POD URL for a new building file. */
export function newBuildingUri(webId: string, id: string): string {
  return `${podResources(webId).buildings}${id}.ttl`;
}

/**
 * Permanently delete a building the user owns: delete its per-building energy
 * subtree (`buildings/<id>/…`, if any), then delete the building file itself.
 * Own buildings are now discovered by *listing* the `buildings/` container, so
 * removing the file de-registers it — there's no registry to update. Refuses to
 * touch resources outside the user's own Pod (e.g. a building shared from
 * another Pod), which must only be *hidden*.
 * @operation mutation
 */
export async function deleteBuilding(
  session: Session,
  webId: string,
  buildingUri: string,
): Promise<void> {
  const fileUri = buildingFileUri(buildingUri);
  if (!fileUri.startsWith(getStorageRoot(webId))) {
    throw new Error("Refusing to delete a building outside your own Pod");
  }

  // Energy lives under a sibling container named after the building file
  // (the ".ttl" suffix stripped); remove it best-effort.
  await deleteContainerRecursive(`${fileUri.replace(/\.ttl$/, "")}/`, session)
    .catch((err) => logError("delete building energy container", err));

  // Delete the file directly — NOT its .acl first. Removing a resource's .acl
  // before the resource would briefly fall it back to the container's (possibly
  // more permissive) inherited ACL — a TOCTOU exposure window. The owner-lockout
  // that motivated such a "recovery" is prevented at the source now (a revoke
  // never strips the owner's Control; see sharingManager.removeFromACL), so a
  // normal delete keeps the owner's authorization and just works.
  const res = await session.fetch(fileUri, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete building (HTTP ${res.status})`);
  }

  // Read-after-write: the resource is gone, but the parent `buildings/` container's
  // `ldp:contains` listing can briefly still list it (CSS eventual consistency).
  // The caller (the delete mutation) invalidates the buildings query right after
  // this resolves, so a refetch fired into that window would surface the just-
  // deleted building as a phantom row and then not re-fetch. Wait (bounded) until
  // the listing no longer contains it, so that refetch is consistent. Usually the
  // first check already sees it gone, so this adds ~no latency; the backoff only
  // engages in the rare lag window, and gives up gracefully (a reload reconciles).
  const container = fileUri.replace(/[^/]+$/, ""); // …/buildings/
  for (const delayMs of [0, 150, 300, 600, 900]) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const children = await listDirectChildren(container, session)
      .catch(() => null);
    if (children === null || !children.includes(fileUri)) return;
  }
}

// ── Demo seed ─────────────────────────────────────────────────────────────────

/**
 * A demo building's master data and energy shape. The render/load paths key on
 * the data *shape* (the energy granularity), never a role. `annual`, when
 * present, holds the `_inv_*`/`_bsp_*` fields merged in for an
 * `energy: "annual"` (or `"both"`) building (turned into annual SOSA
 * observations); `"both"` carries annual aggregates AND a 15-minute series,
 * the shape that surfaces the Annual | Time series toggle.
 */
interface DemoSpec {
  fields: Record<string, string>;
  energy: "annual" | "series" | "both";
  annual?: Record<string, string>;
  /** For a series-carrying shape: how many demo days (15-min) to synthesize. */
  seriesDays?: number;
  /**
   * Set `operatedBy` to the seeding user's own WebID at seed time. Two effects:
   * the agent-link → contact detail path resolves to a real profile out of the
   * box, and every self-operated building with annual data joins ONE operator
   * group — so the operator-average (Betreiber) benchmark shows on the demo data
   * without any extra setup (it needs ≥2 buildings sharing an operator).
   */
  selfOperated?: boolean;
  /**
   * Set `ownedBy` to the seeding user's own WebID at seed time — the
   * owner-occupier constellation. The agent links are independent axes: a demo
   * can be operated-but-not-owned (the investor demos, owned economically by
   * the fictional fund) or owned-and-operated (the small series buildings).
   */
  selfOwned?: boolean;
  /**
   * An extra planned (Soll) annual dataset, so the demo shows a Soll-Ist pair
   * next to the actual figures of the same year out of the box.
   */
  planned?: { year: number; metrics: AnnualMetrics };
}

/**
 * Investor demo: an annual aggregate (one cons:EnergyDataset per year) with a
 * fully-populated investor master-data panel (block, a certification, operating
 * costs). This is the shape an investor org actually produces.
 */
const DEMO_INVESTOR: DemoSpec = {
  fields: {
    streetAddress: "Nordostpark 84",
    postalCode: "90411",
    locality: "Nürnberg",
    region: "Bayern",
    // Core master data — gives a new user a fully-populated detail panel.
    customer: "Muster Logistik GmbH",
    investor: "Beispiel Real Estate Fund",
    usedAs: "Logistics warehouse",
    naceCode: "52.10",
    buildingArea: "12500",
    landArea: "20000",
    officeArea: "1800",
    yearOfConstruction: "2016",
    hasPVSystem: "true",
    // Investor block (controlled-vocab fields use local names, not labels).
    buildingCode: "NOP-84",
    hallArea: "10200",
    officeSocialArea: "1500",
    buildingHeight: "11.5",
    numberOfLoadingDocks: "14",
    yearOfRenovation: "2021",
    leaseType: "Triple net",
    tenantIndustry: "Contract logistics",
    shiftRegime: "TwoShift", // investor:ShiftRegime → "2-Shift"
    tenancyType: "MultiTenant", // investor:TenancyType → "Multi Tenant"
    indoorTemperatureClass: "MaxEighteenDegrees", // → "≤18 °C"
    hasGasBoiler: "true",
    hasHeatPump: "true",
    hasDistrictHeating: "false",
    // One certification (type drives investor:<Type>Certification).
    _cert_0_type: "DGNB",
    _cert_0_level: "Gold",
    _cert_0_scope: "New construction",
    // A few operating-cost categories (one investor:hasOperatingCosts node).
    _opcost_propertyManagement: "Medium",
    _opcost_security: "High",
    _opcost_operationInspectionAndMaintenance: "true",
  },
  energy: "annual",
  selfOperated: true,
  // Multi-year `_inv_*` energy (electricity/heat in kWh, water in m³).
  annual: {
    _inv_elec_2022: "118000", _inv_elec_2023: "121500", _inv_elec_2024: "115200",
    _inv_heat_2022: "240000", _inv_heat_2023: "232000", _inv_heat_2024: "228500",
    _inv_water_2022: "1450", _inv_water_2023: "1500", _inv_water_2024: "1410",
  },
  // Planned (Soll) 2024 next to the actual 2024 figures — the demo data shows
  // the Soll-Ist comparison out of the box (the actuals run slightly over plan).
  planned: {
    year: 2024,
    metrics: {
      electricityConsumption: 110000,
      heatConsumption: 220000,
      waterConsumption: 1400,
    },
  },
};

/** Investor demo #2: a cold store — electricity-heavy, low heat. */
const DEMO_INVESTOR_2: DemoSpec = {
  fields: {
    streetAddress: "Hafenstraße 12",
    postalCode: "90451",
    locality: "Nürnberg",
    region: "Bayern",
    customer: "Frischlager Franken GmbH",
    investor: "Beispiel Real Estate Fund",
    usedAs: "Cold storage",
    naceCode: "52.10",
    buildingArea: "7400",
    landArea: "12000",
    officeArea: "600",
    yearOfConstruction: "2018",
    hasPVSystem: "true",
    buildingCode: "HAF-12",
    hallArea: "6800",
    officeSocialArea: "550",
    buildingHeight: "12.0",
    numberOfLoadingDocks: "6",
    leaseType: "Triple net",
    tenantIndustry: "Food logistics",
    shiftRegime: "ThreeShift",
    tenancyType: "SingleTenant",
    indoorTemperatureClass: "MaxTwelveDegrees",
    hasGasBoiler: "false",
    hasHeatPump: "true",
    hasDistrictHeating: "false",
    _cert_0_type: "LEED",
    _cert_0_level: "Silver",
    _cert_0_scope: "New construction",
    _opcost_propertyManagement: "Medium",
    _opcost_operationInspectionAndMaintenance: "true",
  },
  // Deliberately NOT self-operated: the cold store stays outside the operator
  // group, so the demo set also shows a building WITHOUT the Betreiber benchmark.
  energy: "annual",
  annual: {
    _inv_elec_2022: "210000", _inv_elec_2023: "205000", _inv_elec_2024: "198000",
    _inv_heat_2022: "60000", _inv_heat_2023: "58000", _inv_heat_2024: "55000",
    _inv_water_2022: "640", _inv_water_2023: "660", _inv_water_2024: "650",
  },
};

/**
 * User demo: a 15-minute load-profile series (lazy-loaded, time-series chart)
 * PLUS a couple of annual years — the one demo carrying BOTH energy shapes, so
 * the Annual | Time series toggle shows on the demo data out of the box.
 * Light metadata otherwise — the shape an end user produces. Self-operated, so
 * the agent-link → contact path resolves out of the box.
 */
const DEMO_USER: DemoSpec = {
  fields: {
    streetAddress: "Lange Gasse 20",
    postalCode: "90403",
    locality: "Nürnberg",
    region: "Bayern",
    customer: "Atelier Lange Gasse",
    usedAs: "Office",
    buildingArea: "1400",
    yearOfConstruction: "1998",
    hasPVSystem: "false",
  },
  energy: "both",
  selfOperated: true,
  selfOwned: true, // owner-occupier: the small office is owned AND operated
  // Two weeks of demo days — enough to populate the Day View, Daily Totals and
  // Average Profile with weekday/weekend variation, while keeping the seed's
  // request count low (each day is one Pod write; throttling providers such as
  // solidcommunity.net rate-limit bursts).
  seriesDays: 14,
  // The annual aggregates next to the series (a small 1400 m² office's scale).
  // They make this the SECOND member of the operator group (with the investor
  // demo), so the Betreiber benchmark shows on the demo data.
  annual: {
    _inv_elec_2023: "48200", _inv_elec_2024: "46900",
    _inv_heat_2023: "142000", _inv_heat_2024: "138500",
    _inv_water_2023: "260", _inv_water_2024: "255",
  },
};

/** User demo #2: a small workshop, a lighter (one-week) load profile. */
const DEMO_USER_2: DemoSpec = {
  fields: {
    streetAddress: "Pirckheimerstraße 68",
    postalCode: "90408",
    locality: "Nürnberg",
    region: "Bayern",
    customer: "Werkstatt Pirckheimer",
    usedAs: "Workshop",
    buildingArea: "850",
    yearOfConstruction: "2005",
    hasPVSystem: "true",
  },
  energy: "series",
  selfOperated: true,
  selfOwned: true, // owner-occupier, like DEMO_USER
  seriesDays: 7,
};

/**
 * The demo building set — deliberately small (each building costs several Pod
 * writes and throttling providers such as solidcommunity.net rate-limit bursts),
 * but still one demo per special case:
 *  - DEMO_INVESTOR — annual aggregates with the fully-populated investor panel
 *    (cert, operating costs), a planned (Soll) dataset → the Soll-Ist pair, and
 *    a member of the operator group;
 *  - DEMO_INVESTOR_2 — annual but NOT self-operated → a building WITHOUT the
 *    Betreiber benchmark;
 *  - DEMO_USER — the one demo carrying BOTH shapes (Annual | Time series
 *    toggle), owner-occupier, and the operator group's second member;
 *  - DEMO_USER_2 — a series-ONLY building (no annual data, no toggle).
 * The buildings are ordinary owned resources the user can delete.
 */
const DEMO_BUILDINGS: DemoSpec[] = [
  DEMO_INVESTOR,
  DEMO_INVESTOR_2,
  DEMO_USER,
  DEMO_USER_2,
];

/**
 * Seed the example buildings (see {@link DEMO_BUILDINGS}) into the user's pod, as
 * ordinary owned resources the user can delete. Coordinates are geocoded at seed
 * time; a building that can't be geocoded is still created (just unmapped).
 * Best-effort: per-building failures are logged, never thrown, so a network hiccup
 * can't block login — but they ARE counted: the returned tally lets the caller
 * report a partial seed ("Added 3 of 4") instead of a blanket success. Within one
 * building the writes are ordered commit-last (datasets first, the discoverable
 * building file last), so a failed building leaves only inert orphan files.
 * @operation mutation
 */
export async function seedDemoBuildings(
  session: Session,
  webId: string,
): Promise<{ seeded: number; total: number }> {
  let seeded = 0;
  for (const demo of DEMO_BUILDINGS) {
    try {
      const coords = await geocodeFields(demo.fields);
      let fields: Record<string, string> = coords
        ? {
          ...demo.fields,
          lat: coords.lat,
          long: coords.long,
          geocodePrecision: coords.precision,
        }
        : { ...demo.fields };
      // Attribute the operator/owner to the seeding user (see {@link DemoSpec}'s
      // `selfOperated`/`selfOwned`: real profile resolution + the shared
      // operator group that makes the Betreiber benchmark show on the demo data).
      if (demo.selfOperated) fields = { ...fields, operatedBy: webId };
      if (demo.selfOwned) fields = { ...fields, ownedBy: webId };
      // A collision-free FILE name (several demo buildings are written in a
      // tight loop); identity is the subject IRI, not the uuid.
      const uri = newBuildingUri(webId, crypto.randomUUID());
      const subjectUri = mintBuildingSubject(uri);

      let series:
        | { year: number; days: Array<{ date: string; readings: LastgangReading[] }>; label: string }
        | undefined;

      if (demo.energy !== "series") {
        // Annual aggregate (P1Y) — written as one cons:EnergyDataset per year.
        fields = { ...fields, ...(demo.annual ?? {}) };
      }
      if (demo.energy !== "annual") {
        // 15-minute series (PT15M): `seriesDays` demo days from 2024-06-01, so the
        // Day View, Daily Totals and Average Profile are all populated. Each day is
        // scaled by a deterministic weekday/weekend factor (offices idle at the
        // weekend), so the totals and average profile vary instead of being flat.
        const n = demo.seriesDays ?? 14;
        const start = new Date("2024-06-01T00:00:00Z").getTime();
        const days: Array<{ date: string; readings: LastgangReading[] }> = [];
        for (let i = 0; i < n; i++) {
          const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
          const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
          const factor = dow === 0 || dow === 6 ? 0.5 : 0.9 + (i % 5) * 0.05;
          const readings = synthDayReadings(date).map((r) => ({
            ...r,
            valueKwh: (parseFloat(r.valueKwh) * factor).toFixed(6),
          }));
          days.push({ date, readings });
        }
        series = { year: 2024, days, label: fields.streetAddress ?? "" };
      }

      // Write the energy dataset resources, then the building (with the links).
      const energyLinks = await writeBuildingEnergy(
        session,
        uri,
        subjectUri,
        fields,
        series,
      );
      if (demo.planned) {
        // The extra planned (Soll) dataset — its own resource, like the actuals.
        const fileUri = datasetFileUri(uri, demo.planned.year, "P1Y", "planned");
        const put = await session.fetch(fileUri, {
          method: "PUT",
          headers: { "Content-Type": "text/turtle" },
          body: serializeEnergyDataset({
            building: subjectUri,
            year: demo.planned.year,
            granularity: "P1Y",
            scenario: "planned",
            metrics: demo.planned.metrics,
          }),
        });
        if (!put.ok) {
          throw new Error(
            `Energy upload failed (${fileUri}): ${put.status} ${put.statusText}`,
          );
        }
        energyLinks.push(datasetNodeUri(fileUri));
      }
      const ttl = serializeBuildingToTurtle(fields, uri, energyLinks, {
        agent: webId,
      });
      await uploadBuilding(session, uri, ttl, webId);
      seeded++;
    } catch (err) {
      console.error(
        `Failed to seed demo building ${demo.fields.streetAddress}:`,
        err,
      );
    }
  }
  return { seeded, total: DEMO_BUILDINGS.length };
}

// ── CSV / XLSX autofill ───────────────────────────────────────────────────────

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

