import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store, Writer } from "n3";
import type {
  BuildingType,
  InvestorAnnualData,
  UserRole,
} from "../../types.ts";
import {
  BOOLEAN_FIELDS,
  DECIMAL_FIELDS,
  INTEGER_FIELDS,
  iriPropertyMap,
  objectPropertyMap,
  predicateMap,
} from "./config/buildingConfig.ts";
import {
  GEO_LAT,
  GEO_LOCATION,
  GEO_LONG,
  GEO_POINT,
  GEOCODE_PRECISION_IRI,
  type GeocodePrecision,
  GRAN_GEOCODE_PRECISION,
  GRAN_NS,
  INVESTOR_NS,
  PROV_AGENT,
  PROV_ATTRIBUTION,
  PROV_HAD_ROLE,
  PROV_QUALIFIED_ATTRIBUTION,
  RDF_TYPE as RDF_TYPE_IRI,
  REC_BUILDING,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_INTEGER,
  XSD_STRING,
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
import { appRoot, getStorageRoot } from "./solidUtils.ts";
import { ensureContainer, readModifyWrite } from "./podWrite.ts";
import { logError } from "./logError.ts";
import { mapPooled } from "./pool.ts";
import { deleteContainerRecursive } from "./podDelete.ts";
import { geocodeFields } from "./geocode.ts";
import {
  generateEnergyDayTtl,
  type LastgangReading,
  parseLastgangXlsx,
  synthDayReadings,
} from "./energySeriesXlsx.ts";
import {
  applyNormalization,
  BSP_COL_MAP,
  certLevelLabel,
  INV_YEARS,
  INVESTOR_CERT_SYSTEMS,
  INVESTOR_OPCOST_ROW_MAP,
  INVESTOR_ROW_MAP,
  MAX_CERTS,
  normalizeBoolean,
  normalizeNumber,
  OPCOST_BOOLEAN_FIELDS,
  OPCOST_FIELDS,
} from "./buildingTemplates.ts";
import { buildingsToXlsx, buildingToXlsx } from "./buildingWorkbook.ts";
import * as XLSX from "xlsx";

// Re-exported so existing importers can keep getting them from buildingSerializer
// (geocode, the Lastgang/energy-series helpers, and the XLSX export now live in
// their own modules).
export { geocodeFields };
export { generateEnergyDayTtl, type LastgangReading, synthDayReadings };
export { buildingsToXlsx, buildingToXlsx };

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

// INTEGER_FIELDS / DECIMAL_FIELDS / BOOLEAN_FIELDS are derived from the building
// field descriptor table (buildingConfig.ts) so read and write share one source.



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
/**
 * Write the building's coordinates as a `geo:Point` blank node linked by
 * `geo:location`, carrying `gran:geocodePrecision` when known. Keeping the point
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
  for (const link of store.getQuads(subject, namedNode(GEO_LOCATION), null, null)) {
    store.removeQuads(store.getQuads(link.object, null, null, null));
    store.removeQuad(link);
  }
  store.removeQuads(store.getQuads(subject, namedNode(GEO_LAT), null, null));
  store.removeQuads(store.getQuads(subject, namedNode(GEO_LONG), null, null));
  addGeoPoint(store, subject, fields);
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
  const pred = namedNode(`${INVESTOR_NS}hasOperatingCosts`);
  for (const link of store.getQuads(subject, pred, null, null)) {
    store.removeQuads(store.getQuads(link.object, null, null, null));
    store.removeQuad(link);
  }
  addOperatingCosts(store, subject, fields);
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
  const pred = namedNode(`${INVESTOR_NS}hasBuildingCertification`);
  for (const link of store.getQuads(subject, pred, null, null)) {
    store.removeQuads(store.getQuads(link.object, null, null, null));
    store.removeQuad(link);
  }
  addCertifications(store, subject, fields);
}

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
    // lat/long are written as a geo:Point blank node (see addGeoPoint), not flat
    // on the building — skip them here even though the config still maps them (so
    // legacy flat-coordinate Pods can still be parsed).
    if (field === "lat" || field === "long") continue;

    if (field in fieldToObjectPredicate) {
      store.addQuad(
        subject,
        namedNode(fieldToObjectPredicate[field]),
        namedNode(`${INVESTOR_NS}${value}`),
      );
    } else if (field in fieldToIriPredicate) {
      store.addQuad(
        subject,
        namedNode(fieldToIriPredicate[field]),
        namedNode(value),
      );
    } else if (field in fieldToPredicate) {
      store.addQuad(
        subject,
        namedNode(fieldToPredicate[field]),
        literal(value, namedNode(xsdType(field))),
      );
    }
  }

  // Coordinates as a geo:Point blank node (carries geocoding precision).
  addGeoPoint(store, subject, fields);

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
      signal?.throwIfAborted();
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

export async function uploadBuilding(
  session: Session,
  buildingUri: string,
  ttlString: string,
  webId: string,
  signal?: AbortSignal,
): Promise<void> {
  // Provision the buildings/ container first (announced once, on first add) so
  // the building-file PUT below has somewhere to land — via the shared helper.
  await ensureContainer(`${appRoot(webId)}buildings/`, session);
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

      const isObjProp = field in fieldToObjectPredicate;
      const isIriProp = field in fieldToIriPredicate;
      const predIri = isObjProp
        ? fieldToObjectPredicate[field]
        : isIriProp
        ? fieldToIriPredicate[field]
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
      } else if (isIriProp) {
        store.addQuad(subject, namedNode(predIri), namedNode(value));
      } else {
        store.addQuad(
          subject,
          namedNode(predIri),
          literal(value, namedNode(xsdType(field))),
        );
      }
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
  return `${appRoot(webId)}buildings/${id}.ttl`;
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
}

// ── Demo seed ─────────────────────────────────────────────────────────────────

/**
 * A demo building's master data, provenance role, and energy shape. `role` is
 * provenance only — the render/load paths key on the data *shape* (the energy
 * granularity). `annual`, when present, holds the `_inv_*`/`_bsp_*` fields merged
 * in for an `energy: "annual"` building (turned into annual SOSA observations).
 */
interface DemoSpec {
  fields: Record<string, string>;
  role: UserRole;
  energy: "annual" | "series";
  annual?: Record<string, string>;
}

/**
 * Investor demo: an annual aggregate (one gran:EnergyDataset per year) with a
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
  role: "investor",
  energy: "annual",
  // Multi-year `_inv_*` energy (electricity/heat in kWh, water in m³). Years
  // must be within INV_YEARS.
  annual: {
    _inv_elec_2022: "118000", _inv_elec_2023: "121500", _inv_elec_2024: "115200",
    _inv_heat_2022: "240000", _inv_heat_2023: "232000", _inv_heat_2024: "228500",
    _inv_water_2022: "1450", _inv_water_2023: "1500", _inv_water_2024: "1410",
  },
};

/**
 * User demo: a 15-minute load-profile series (lazy-loaded, time-series chart) with
 * light metadata — the shape an end user produces. `operatedBy` is set to the
 * seeding user's own WebID at seed time (see {@link seedDemoBuildings}) so the
 * agent-link → contact path resolves out of the box.
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
  role: "user",
  energy: "series",
};

/**
 * Benchmark Service Provider demo: a single-year annual aggregate (`_bsp_*`) with
 * BSP-specific master data (company, logistics function, climatisation, PV) — the
 * shape a benchmark provider works with.
 */
const DEMO_BSP: DemoSpec = {
  fields: {
    streetAddress: "Andernacher Straße 30",
    postalCode: "90411",
    locality: "Nürnberg",
    region: "Bayern",
    companyName: "Beispiel Benchmark Services GmbH",
    label: "DC Nürnberg-Nord",
    usedAs: "Distribution centre",
    buildingArea: "18000",
    landArea: "30000",
    yearOfConstruction: "2019",
    hasPVSystem: "true",
    logisticsFunction: "Distribution",
    climateControlType: "Partially air-conditioned",
    indoorTemperature: "15 °C",
    greenLeaseShare: "60",
    pvInstallationYear: "2020",
    pvCapacityKW: "750",
    tenantIndustry: "Retail logistics",
  },
  role: "benchmark_service_provider",
  energy: "annual",
  // Single-year `_bsp_*` energy (electricity/heat in kWh, water/wastewater in m³).
  annual: {
    _bsp_year: "2024",
    _bsp_elec: "1850000",
    _bsp_heat: "640000",
    _bsp_water: "3200",
    _bsp_wastewater: "2950",
  },
};

/** Company kinds we have example data for (the only kinds the demo is offered for). */
export const DEMO_KINDS: UserRole[] = [
  "investor",
  "user",
  "benchmark_service_provider",
];

/** Whether a demo building set exists for this company kind. */
export function companyKindHasDemo(kind?: UserRole | null): boolean {
  return kind != null && DEMO_KINDS.includes(kind);
}

/**
 * The demo set for a company kind: the one shape that kind actually produces
 * (investor → annual investor building, user → 15-minute series, BSP → annual
 * benchmark building). A kind we have no example data for seeds nothing — the
 * demo is only offered for {@link DEMO_KINDS}, so this is reached only defensively.
 */
function demoSetForKind(kind?: UserRole | null): DemoSpec[] {
  switch (kind) {
    case "investor":
      return [DEMO_INVESTOR];
    case "user":
      return [DEMO_USER];
    case "benchmark_service_provider":
      return [DEMO_BSP];
    default:
      return [];
  }
}

// `geocodeFields` moved to ./geocode.ts (self-contained Nominatim lookup); it is
// imported above and re-exported below so existing call sites keep importing it
// from here.

/**
 * Seed real, user-owned demo building(s) into the user's pod, matching the user's
 * company `kind` — an investor org gets the annual investor building, a user gets a
 * 15-minute series, a BSP gets the annual benchmark building (see
 * {@link demoSetForKind}; an unset/unsupported kind falls back to the investor+user
 * pair). The buildings are ordinary owned resources the user can delete. Coordinates
 * are geocoded at seed time; a building that can't be geocoded is still created (just
 * unmapped). Best-effort: failures are logged, never thrown, so a geocoder/network
 * hiccup can't block login.
 */
export async function seedDemoBuildings(
  session: Session,
  webId: string,
  kind?: UserRole | null,
): Promise<void> {
  for (const demo of demoSetForKind(kind)) {
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
      // Attribute the operator to the seeding user so the agent-link → contact
      // detail path resolves to a real profile out of the box.
      if (demo.role === "user") fields = { ...fields, operatedBy: webId };
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const uri = newBuildingUri(webId, id);
      const subjectUri = `${uri}#${id}`;

      let series:
        | { year: number; days: Array<{ date: string; readings: LastgangReading[] }>; label: string }
        | undefined;

      if (demo.energy === "annual") {
        // Annual aggregate (P1Y) — written as one gran:EnergyDataset per year.
        fields = { ...fields, ...(demo.annual ?? {}) };
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

