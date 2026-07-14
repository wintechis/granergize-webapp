import type { PodGateway } from "../../pod/podGateway.ts";
import { DataFactory, Parser, Store, Writer } from "n3";
import type {
  AnnualData,
  Building,
  Scenario,
  TechnicalSystem,
} from "../../../types.ts";
import { HEAT_KINDS } from "../../../types.ts";
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
  DCTERMS_SPATIAL,
  GEO_LAT,
  GEO_LOCATION,
  GEO_LONG,
  GEO_POINT,
  GEOCODE_PRECISION_IRI,
  GRAN_GEOCODE_PRECISION,
  DCTERMS_LICENSE,
  DCTERMS_SOURCE,
  FOAF_NAME,
  ADDRESSAPI_DE_ATTRIBUTION,
  ADDRESSAPI_DE_LICENSE,
  GISCO_ADDRESSAPI_SOURCE,
  OWL_SAME_AS,
  PROV_AGENT,
  PROV_ATTRIBUTION,
  PROV_ENTITY,
  PROV_QUALIFIED_ATTRIBUTION,
  PROV_WAS_DERIVED_FROM,
  RDF_TYPE as RDF_TYPE_IRI,
  RDFS_LABEL,
  REC_BUILDING,
  REC_NS,
  SOSA_NS,
  type GeocodePrecision,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_DURATION,
  XSD_GYEAR,
  XSD_INTEGER,
  XSD_STRING,
  SYSTEM_TYPE_IRI,
} from "../vocabularies.ts";
import {
  type AnnualMetrics,
  datasetFileUri,
  datasetNodeUri,
  type EnergyDataset,
  findDatasetLink,
  listSeriesDays,
  loadEnergyDatasets,
  mintDatasetId,
  observationsRootForBuilding,
  parseEnergyDatasetRefs,
  serializeEnergyDataset,
  seriesContainerUri,
  seriesDailyFileUri,
} from "../../energy/energyDataset.ts";
import { isSeriesGranularity } from "../durationUtils.ts";
import { getStorageRoot, podResources } from "../../pod/solidUtils.ts";
import { ensureContainer, readModifyWrite } from "../../pod/podWrite.ts";
import { fetchFresh } from "../../pod/podFetch.ts";
import { logError } from "../../../lib/logError.ts";
import { mapPooled } from "../../../lib/pool.ts";
import {
  deleteContainerRecursive,
  listDirectChildren,
} from "../../pod/podDelete.ts";
import { lauConceptUrl } from "../../../constants/dataSources.ts";
import { mintLocalIri } from "../rdfHelpers.ts";
import { buildingFileUri, mintBuildingSubject } from "./buildingId.ts";
import {
  generateEnergyDayTtl,
  type LastgangReading,
  synthDayReadings,
} from "../../xlsx/energySeriesXlsx.ts";
import {
  INV_YEAR_ROW_STEMS,
  INVESTOR_CERT_SYSTEMS,
  MAX_CERTS,
  normalizeBoolean,
  yearsIn,
} from "../../xlsx/buildingTemplates.ts";
import { OPCOST_FIELDS } from "./buildingConfig.ts";

const { namedNode, literal, blankNode } = DataFactory;

// Inverse maps: Building field name → predicate IRI
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
  // Fixed, readable blank-node labels ("point", "cert0", …) are safe because a
  // serialization always targets ONE building document (labels are
  // document-scoped). Don't merge two buildings' quads into one store/graph —
  // their labels would collide; each building writes its own file.
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
    // A geocodePrecision is set ONLY by the addressapi geocoder (geocodeFields);
    // coordinates from other sources (a partner file, MaStR/LoD2 import, manual
    // entry) carry none. So its presence marks register-derived coordinates —
    // record that provenance + the BKG attribution on the point itself.
    addGeocodeProvenance(store, point);
  }
}

/**
 * Link the building to its region via `dcterms:spatial` → the `…/ags/{code}` place, from the
 * 8-digit Gemeinde AGS resolved at geocode time. No-op when unresolved (an unplaced building is
 * still valid). The region is a derived fact, not a config field — written here, not in the
 * field→predicate loop (which skips it, like lat/long).
 */
function addRegion(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  fields: Record<string, string>,
): void {
  // dcterms:spatial → the authoritative LAU/NUTS `skos:Concept` IRI. A loaded building
  // carries the concept IRI verbatim (`regionConceptIri`); a freshly geocoded one
  // carries only the AGS, from which we build the LAU concept IRI. The bare AGS join
  // key is NOT stored here — it is the concept's own `dcterms:identifier`, served by
  // the wrapper and read by dereferencing the concept.
  const ags = fields.regionAgs?.trim();
  const region = fields.regionConceptIri?.trim() || (ags ? lauConceptUrl(ags) : "");
  if (!region) return;
  store.addQuad(subject, namedNode(DCTERMS_SPATIAL), namedNode(region));
}

/**
 * Record, on a geocoded `geo:Point`, that its coordinates were derived from the
 * national address register via the GISCO Address API (linked-addressapi), with
 * the dl-de/by-2-0 licence and the required BKG attribution — so the obligation
 * travels with shared building data.
 */
function addGeocodeProvenance(
  store: Store,
  point: ReturnType<typeof blankNode>,
): void {
  const src = blankNode("geocodeSource");
  store.addQuad(point, namedNode(PROV_WAS_DERIVED_FROM), src);
  store.addQuad(src, namedNode(RDF_TYPE_IRI), namedNode(PROV_ENTITY));
  store.addQuad(src, namedNode(FOAF_NAME), literal(ADDRESSAPI_DE_ATTRIBUTION));
  store.addQuad(src, namedNode(DCTERMS_SOURCE), namedNode(GISCO_ADDRESSAPI_SOURCE));
  store.addQuad(src, namedNode(DCTERMS_LICENSE), namedNode(ADDRESSAPI_DE_LICENSE));
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
 * Replace the building's coordinates on an EXISTING store (the edit path): drop the
 * current geo:Point, then re-add a fresh one from `fields`.
 */
function replaceGeoPoint(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  fields: Record<string, string>,
): void {
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
 * Write one energy-unit node `<#{id}>` — its kind's `rdf:type` plus the capacity
 * (kind-specific), commissioning year, operator and `owl:sameAs` it carries — linked
 * by `bldg:hasSystem`. A hash-fragment NamedNode in the building document, so the unit
 * has its own identity: its `rec:operatedBy` is the Anlagenbetreiber (not the
 * building's operator) and `owl:sameAs` the external MaStR Einheit. Mirrors the parser.
 */
function addSystem(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  system: TechnicalSystem,
): void {
  const node = namedNode(`${buildingFileUri(subject.value)}#${system.id}`);
  store.addQuad(subject, namedNode(`${BUILDING_NS}hasSystem`), node);
  store.addQuad(node, namedNode(RDF_TYPE_IRI), namedNode(SYSTEM_TYPE_IRI[system.kind]));
  if (system.label) store.addQuad(node, namedNode(RDFS_LABEL), literal(system.label));
  const decimal = (pred: string, v: number | undefined) => {
    if (v != null) {
      store.addQuad(node, namedNode(pred), literal(String(v), namedNode(XSD_DECIMAL)));
    }
  };
  decimal(`${BUILDING_NS}capacityKW`, system.capacityKW);
  decimal(`${BUILDING_NS}storageCapacityKWh`, system.storageCapacityKWh);
  decimal(`${BUILDING_NS}thermalCapacityKW`, system.thermalCapacityKW);
  if (system.commissioningYear != null) {
    store.addQuad(
      node,
      namedNode(`${BUILDING_NS}commissioningYear`),
      literal(String(system.commissioningYear), namedNode(XSD_GYEAR)),
    );
  }
  if (system.operatedBy) {
    store.addQuad(node, namedNode(`${REC_NS}operatedBy`), namedNode(system.operatedBy));
  }
  if (system.sameAs) store.addQuad(node, namedNode(OWL_SAME_AS), namedNode(system.sameAs));
}

/** Write every energy unit (PV plants, batteries, CHP) of the building. */
function addSystems(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  systems: TechnicalSystem[],
): void {
  for (const system of systems) addSystem(store, subject, system);
}

/**
 * The energy units described by the legacy single-unit import/create fields
 * (`_pv_*`/`_battery_*`/`_chp_*`, plus the bare `_<kind>_present` boolean) — one unit
 * per kind, the kind name as a stable id. The XLSX import and the building-create path
 * feed these; the per-unit editor passes a {@link TechnicalSystem}[] directly instead.
 */
export function systemsFromFields(fields: Record<string, string>): TechnicalSystem[] {
  const num = (k: string) => {
    const v = fields[k]?.trim();
    return v ? Number(v) : undefined;
  };
  const text = (k: string) => fields[k]?.trim() || undefined;
  const present = (kind: string) =>
    normalizeBoolean(fields[`_${kind}_present`] ?? "") === "true";
  const nonEmpty = (s: TechnicalSystem) =>
    s.capacityKW != null || s.storageCapacityKWh != null ||
    s.thermalCapacityKW != null || s.commissioningYear != null || !!s.operatedBy ||
    !!s.sameAs;

  const systems: TechnicalSystem[] = [];
  const pv: TechnicalSystem = {
    id: "pv",
    kind: "pv",
    capacityKW: num("_pv_capacityKW"),
    commissioningYear: num("_pv_commissioningYear"),
    operatedBy: text("_pv_operatedBy"),
    sameAs: text("_pv_sameAs"),
  };
  if (present("pv") || nonEmpty(pv)) systems.push(pv);
  const battery: TechnicalSystem = {
    id: "battery",
    kind: "battery",
    storageCapacityKWh: num("_battery_capacityKWh"),
    commissioningYear: num("_battery_commissioningYear"),
    operatedBy: text("_battery_operatedBy"),
    sameAs: text("_battery_sameAs"),
  };
  if (present("battery") || nonEmpty(battery)) systems.push(battery);
  const chp: TechnicalSystem = {
    id: "chp",
    kind: "chp",
    capacityKW: num("_chp_capacityKW"),
    thermalCapacityKW: num("_chp_thermalCapacityKW"),
    commissioningYear: num("_chp_commissioningYear"),
    operatedBy: text("_chp_operatedBy"),
    sameAs: text("_chp_sameAs"),
  };
  if (present("chp") || nonEmpty(chp)) systems.push(chp);
  // Heat generators — presence-only from the XLSX import (a yes/no column), or with thermal
  // capacity / commissioning year when given; each becomes a :TechnicalSystem of its kind.
  for (const kind of HEAT_KINDS) {
    const sys: TechnicalSystem = {
      id: kind,
      kind,
      thermalCapacityKW: num(`_${kind}_thermalCapacityKW`),
      commissioningYear: num(`_${kind}_commissioningYear`),
      operatedBy: text(`_${kind}_operatedBy`),
      sameAs: text(`_${kind}_sameAs`),
    };
    if (present(kind) || nonEmpty(sys)) systems.push(sys);
  }
  return systems;
}

/**
 * Replace ALL of the building's energy-unit nodes on an EXISTING store (the edit
 * path): drop every `bldg:hasSystem` node, then re-add from `systems`. The per-unit
 * editor sends the full list, so a removed unit's node disappears and an added one's
 * (with its minted id) lands — siblings are rebuilt verbatim.
 */
function replaceSystems(
  store: Store,
  subject: ReturnType<typeof namedNode>,
  systems: TechnicalSystem[],
): void {
  for (
    const link of store.getQuads(subject, namedNode(`${BUILDING_NS}hasSystem`), null, null)
  ) {
    store.removeQuads(store.getQuads(link.object, null, null, null));
    store.removeQuad(link);
  }
  addSystems(store, subject, systems);
}

/**
 * Serialize investor operating costs as a single `investor:hasOperatingCosts`
 * blank node, from `_opcost_<field>` keys. Every category is a plain-literal amount
 * (already human-readable) — which is exactly what `buildingParser` reads back (its
 * controlled-vocab label lookup is a no-op for values that are already labels). No-op
 * when no `_opcost_*` keys are present.
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
    store.addQuad(oc, namedNode(`${BUILDING_NS}${f}`), literal(v));
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
 * Energy is NOT inlined: each dataset is its own first-class observation
 * resource (see {@link writeBuildingEnergy}); pass {@link EnergyDatasetLink}s to
 * emit each as a `cons:hasEnergyDataset` link PLUS the `cons:granularity` /
 * `cons:scenario` triples re-stated about the dataset node, so phase-1 can
 * dispatch load (series lazy, annual prefetched) without fetching the dataset.
 * `provenance`, when given, is recorded as a PROV-O qualified attribution (the
 * producing agent only).
 */
export interface EnergyDatasetLink {
  /** The dataset node IRI (the time-first `observations/…/{id}.ttl#ds`). */
  uri: string;
  granularity: string;
  scenario: Scenario;
  /** The unit the dataset is about (`sosa:hasFeatureOfInterest`), when not the
   * building as a whole — re-stated on the link so phase-1 + the reuse match can
   * tell a per-unit series apart from the building's. */
  featureOfInterest?: string;
}

export function serializeBuildingToTurtle(
  fields: Record<string, string>,
  buildingUri: string,
  energyDatasets?: EnergyDatasetLink[],
  provenance?: { agent: string },
  /** The building's energy units. When omitted, derived from the legacy single-unit
   * import/create fields (`_pv_*`/…) via {@link systemsFromFields}. */
  systems?: TechnicalSystem[],
): string {
  const store = new Store();
  const subject = namedNode(mintBuildingSubject(buildingUri));

  store.addQuad(subject, namedNode(RDF_TYPE_IRI), namedNode(REC_BUILDING));

  for (const [field, value] of Object.entries(fields)) {
    if (!value || value.trim() === "" || field.startsWith("_")) continue;
    // lat/long aren't config-mapped — they go to a geo:Point (addGeoPoint, below) —
    // so `predicateFor` returns undefined for them and the `if (predIri)` skips them.
    const predIri = predicateFor(field);
    if (predIri) {
      store.addQuad(subject, namedNode(predIri), objectTermFor(field, value));
    }
  }

  // Coordinates as a geo:Point blank node (carries geocoding precision), and the region
  // (dcterms:spatial) resolved from those coordinates at geocode time.
  addGeoPoint(store, subject, fields);
  addRegion(store, subject, fields);

  // Investor master-data sub-structures (blank nodes), when present.
  addOperatingCosts(store, subject, fields);
  addCertifications(store, subject, fields);

  // Energy-unit nodes (each linked by bldg:hasSystem): the explicit list, or the
  // single units the legacy import/create fields describe.
  addSystems(store, subject, systems ?? systemsFromFields(fields));

  // Provenance (PROV-O qualified attribution), when provided.
  if (provenance) addProvenance(store, subject, provenance);

  // Unified energy model: link each cons:EnergyDataset resource (written
  // separately by writeBuildingEnergy). One predicate, no inline observations —
  // plus the dataset's granularity/scenario re-stated so phase-1 needn't fetch.
  for (const ds of energyDatasets ?? []) {
    const node = namedNode(ds.uri);
    store.addQuad(subject, namedNode(`${CONSUMPTION_NS}hasEnergyDataset`), node);
    // Keep every link dimension `linkEnergyDatasetInStore` writes — dropping the
    // feature of interest here would fold a per-unit (<#pv>/<#battery>) series
    // into the building total on the next full serialize.
    if (ds.featureOfInterest) {
      store.addQuad(
        node,
        namedNode(`${SOSA_NS}hasFeatureOfInterest`),
        namedNode(ds.featureOfInterest),
      );
    }
    store.addQuad(
      node,
      namedNode(`${CONSUMPTION_NS}granularity`),
      literal(ds.granularity, namedNode(XSD_DURATION)),
    );
    store.addQuad(
      node,
      namedNode(`${CONSUMPTION_NS}scenario`),
      namedNode(
        ds.scenario === "planned"
          ? `${CONSUMPTION_NS}Planned`
          : `${CONSUMPTION_NS}Actual`,
      ),
    );
  }

  return new Writer({ format: "text/turtle" }).quadsToString(
    store.getQuads(null, null, null, null),
  );
}

/**
 * Add (or overwrite) the building's `cons:hasEnergyDataset` link to a dataset
 * node, re-stating its `cons:granularity`/`cons:scenario` so phase-1 can
 * dispatch without fetching. Idempotent: clears any prior triples for that node
 * before re-adding. Run inside a {@link readModifyWrite} of the building file.
 */
function linkEnergyDatasetInStore(
  store: Store,
  buildingSubjectUri: string,
  link: EnergyDatasetLink,
): void {
  const subject = namedNode(buildingSubjectUri);
  const node = namedNode(link.uri);
  const pred = namedNode(`${CONSUMPTION_NS}hasEnergyDataset`);
  store.removeQuads(store.getQuads(subject, pred, node, null));
  store.removeQuads(
    store.getQuads(node, namedNode(`${CONSUMPTION_NS}granularity`), null, null),
  );
  store.removeQuads(
    store.getQuads(node, namedNode(`${CONSUMPTION_NS}scenario`), null, null),
  );
  store.removeQuads(
    store.getQuads(node, namedNode(`${SOSA_NS}hasFeatureOfInterest`), null, null),
  );
  store.addQuad(subject, pred, node);
  if (link.featureOfInterest) {
    store.addQuad(
      node,
      namedNode(`${SOSA_NS}hasFeatureOfInterest`),
      namedNode(link.featureOfInterest),
    );
  }
  store.addQuad(
    node,
    namedNode(`${CONSUMPTION_NS}granularity`),
    literal(link.granularity, namedNode(XSD_DURATION)),
  );
  store.addQuad(
    node,
    namedNode(`${CONSUMPTION_NS}scenario`),
    namedNode(
      link.scenario === "planned"
        ? `${CONSUMPTION_NS}Planned`
        : `${CONSUMPTION_NS}Actual`,
    ),
  );
}

/**
 * Write (or overwrite) a single year's annual `cons:EnergyDataset` resource and
 * ensure the building links it via `cons:hasEnergyDataset`. Datasets are
 * time-first under `observations/`; the building's existing links locate the one
 * matching (year, granularity, scenario), so re-saving overwrites it in place —
 * otherwise a fresh id is minted. Used by the per-year energy entry form (actual
 * or planned/Soll figures).
 * @operation mutation
 */
export async function writeEnergyYear(
  gateway: PodGateway,
  buildingFileUri: string,
  buildingSubjectUri: string,
  ds: EnergyDataset,
): Promise<void> {
  const root = observationsRootForBuilding(buildingFileUri);

  // Reuse the existing dataset's id when this (year, granularity, scenario) is
  // already linked, so a re-save overwrites it rather than orphaning a file.
  const store = await readBuildingStore(gateway, buildingFileUri);
  const reuse = store
    ? findDatasetLink(
      store,
      buildingSubjectUri,
      ds.year,
      ds.granularity,
      ds.scenario,
      ds.featureOfInterest,
    )
    : null;
  const nodeUri = await putObservationDataset(
    gateway,
    root,
    { ...ds, building: buildingSubjectUri },
    reuse,
  );
  await linkBuildingToObservation(
    gateway,
    buildingFileUri,
    buildingSubjectUri,
    nodeUri,
    ds,
  );
}

/**
 * Write (PUT) one `cons:EnergyDataset` resource under `observationsRoot` — minting an
 * id, or overwriting `reuseNodeUri` when given. Building-agnostic: `ds.building` decides
 * whether `cons:ofBuilding` is emitted (the serializer omits it when empty). Returns the
 * dataset node IRI. The shared write step behind both the building-linked
 * {@link writeEnergyYear} and the building-less {@link writeBuildinglessObservation}.
 */
async function putObservationDataset(
  gateway: PodGateway,
  observationsRoot: string,
  ds: EnergyDataset,
  reuseNodeUri?: string | null,
): Promise<string> {
  const nodeUri = reuseNodeUri ??
    datasetNodeUri(datasetFileUri(observationsRoot, ds.year, mintDatasetId()));
  const fileUri = nodeUri.split("#")[0];
  const put = await gateway.fetch(fileUri, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: serializeEnergyDataset(ds),
  });
  if (!put.ok) {
    throw new Error(`Failed to write energy dataset: ${put.status} ${put.statusText}`);
  }
  return nodeUri;
}

/**
 * Add the building's `cons:hasEnergyDataset` link to a dataset (the building file must
 * already exist). The binding step shared by {@link writeEnergyYear} and the
 * link-an-unbound-observation flow.
 * @operation mutation
 */
export async function linkBuildingToObservation(
  gateway: PodGateway,
  buildingFileUri: string,
  buildingSubjectUri: string,
  datasetUri: string,
  ds: EnergyDataset,
): Promise<void> {
  await readModifyWrite(buildingFileUri, gateway, (s, { created }) => {
    if (created) return false; // the building file must already exist
    linkEnergyDatasetInStore(s, buildingSubjectUri, {
      uri: datasetUri,
      granularity: ds.granularity,
      scenario: ds.scenario,
      featureOfInterest: ds.featureOfInterest,
    });
  });
}

/**
 * Write a **building-less** observation (no `cons:ofBuilding`, no building link) under
 * the user's own `observations/` root — an unbound reading to be linked to a building
 * later. Returns the dataset node IRI.
 * @operation mutation
 */
export async function writeBuildinglessObservation(
  gateway: PodGateway,
  observationsRoot: string,
  ds: EnergyDataset,
): Promise<string> {
  return await putObservationDataset(gateway, observationsRoot, {
    ...ds,
    building: "",
  });
}

/**
 * Delete a **building-less** observation by its node IRI — just remove the resource
 * (+ its per-resource ACL, best-effort); there's no building link to unlink.
 * @operation mutation
 */
export async function deleteBuildinglessObservation(
  gateway: PodGateway,
  observationUri: string,
): Promise<void> {
  const fileUri = observationUri.split("#")[0];
  const del = await gateway.fetch(fileUri, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    throw new Error(
      `Failed to delete observation: ${del.status} ${del.statusText}`,
    );
  }
  await gateway.fetch(`${fileUri}.acl`, { method: "DELETE" }).catch((err) =>
    logError("delete observation ACL", err)
  );
}

/**
 * Bind a building-less observation to a building (late FoI binding): add
 * `cons:ofBuilding` to the dataset **in place** (the IRI never changes), then add the
 * building's `cons:hasEnergyDataset` link. `link` carries the dataset's
 * granularity/scenario for the building-side ref. The observation file must exist.
 * @operation mutation
 */
export async function bindObservationToBuilding(
  gateway: PodGateway,
  observationUri: string,
  buildingFileUri: string,
  buildingSubjectUri: string,
  link: { granularity: string; scenario: Scenario; featureOfInterest?: string },
): Promise<void> {
  const obsFileUri = observationUri.split("#")[0];
  // 1. Record the building on the dataset (the late FoI binding) — in place.
  await readModifyWrite(obsFileUri, gateway, (s, { created }) => {
    if (created) return false; // the observation must already exist
    s.addQuad(
      DataFactory.namedNode(observationUri),
      DataFactory.namedNode(`${CONSUMPTION_NS}ofBuilding`),
      DataFactory.namedNode(buildingSubjectUri),
    );
  });
  // 2. Link the building to the now-bound dataset.
  await linkBuildingToObservation(
    gateway,
    buildingFileUri,
    buildingSubjectUri,
    observationUri,
    { building: buildingSubjectUri, year: 0, ...link },
  );
}

/**
 * Fetch + parse the building file into a store, or null when the resource is
 * missing/inaccessible (a non-ok response). Reads through {@link fetchFresh} so
 * the request carries `Accept: text/turtle` — a raw `gateway.fetch` relied on
 * the server's default serialization, and a JSON-LD-native server (JSS) then
 * returned JSON-LD that n3 rejects; with the parse error swallowed to null,
 * deleteBuilding silently skipped its energy cleanup and orphaned the datasets.
 * A network or parse error now propagates (an unreadable-but-present building
 * must fail the operation loudly, not masquerade as "missing").
 */
async function readBuildingStore(
  gateway: PodGateway,
  buildingFileUri: string,
): Promise<Store | null> {
  const res = await fetchFresh(buildingFileUri, gateway);
  if (!res.ok) return null;
  return new Store(new Parser({ baseIRI: buildingFileUri }).parse(await res.text()));
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
  gateway: PodGateway,
  buildingFileUri: string,
  buildingSubjectUri: string,
  ds: Pick<EnergyDataset, "year" | "granularity" | "scenario" | "featureOfInterest">,
): Promise<void> {
  // Locate the linked dataset by (year, granularity, scenario, FoI) — the time-first
  // path no longer encodes those, so the building's own links are the index.
  const store = await readBuildingStore(gateway, buildingFileUri);
  const nodeUri = store
    ? findDatasetLink(
      store,
      buildingSubjectUri,
      ds.year,
      ds.granularity,
      ds.scenario,
      ds.featureOfInterest,
    )
    : null;
  if (!nodeUri) return; // nothing linked — already gone

  const fileUri = nodeUri.split("#")[0];
  const del = await gateway.fetch(fileUri, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    throw new Error(
      `Failed to delete energy dataset: ${del.status} ${del.statusText}`,
    );
  }
  // Drop the now-orphaned per-resource ACL if it had one (best-effort).
  await gateway.fetch(`${fileUri}.acl`, { method: "DELETE" }).catch((err) =>
    logError("delete energy dataset ACL", err)
  );

  // Unlink it from the building file (skip the PUT when there's nothing to remove).
  const link = namedNode(nodeUri);
  const subject = namedNode(buildingSubjectUri);
  const pred = namedNode(`${CONSUMPTION_NS}hasEnergyDataset`);
  await readModifyWrite(buildingFileUri, gateway, (s, { created }) => {
    if (created) return false; // building file gone — nothing to unlink
    const quads = s.getQuads(subject, pred, link, null);
    if (quads.length === 0) return false;
    for (const q of quads) s.removeQuad(q);
    s.removeQuads(s.getQuads(link, namedNode(`${CONSUMPTION_NS}granularity`), null, null));
    s.removeQuads(s.getQuads(link, namedNode(`${CONSUMPTION_NS}scenario`), null, null));
    s.removeQuads(
      s.getQuads(link, namedNode(`${SOSA_NS}hasFeatureOfInterest`), null, null),
    );
  });
}

/**
 * Fetch each building's actual annual `cons:EnergyDataset` resources and attach
 * them as `annualData` — energy is no longer inline, but the synchronous Excel
 * export reads that field. Mutates the buildings in place and returns them; call
 * before `buildingToXlsx` / `buildingsToXlsx` (buildingWorkbook.ts).
 */
export function attachAnnualData(
  buildings: Building[],
  gateway: PodGateway,
): Promise<Building[]> {
  return Promise.all(buildings.map(async (b) => {
    const refs = (b.energyDatasets ?? []).filter(
      (r) => r.scenario === "actual" && !isSeriesGranularity(r.granularity),
    );
    if (refs.length === 0) return b;
    const datasets = await loadEnergyDatasets(refs, gateway.fetch.bind(gateway));
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
    // Electricity generated/fed in that year. Like `_inv_renew`, a serializer-only
    // field — NOT an `INV_YEAR_ROW_STEMS` row, so it stays out of the partner XLSX
    // import/export. It joins the SAME per-year actual dataset as consumption (the
    // cube reads `electricityGeneration` off the year as a selectable measure axis;
    // a separate dataset would clash on `byYear.set(year, …)` in useAnnualEnergyByYear).
    const gen = num(fields[`_inv_gen_${year}`]);
    if (gen !== undefined) metrics.electricityGeneration = gen;
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
 * Write a building's energy dataset resources (time-first, under
 * `observations/`) and return their {@link EnergyDatasetLink}s (to pass to
 * {@link serializeBuildingToTurtle}):
 *  - annual aggregates from the field map (one `observations/{year}/{id}.ttl`
 *    each, a fresh `{id}` per dataset), and
 *  - an optional 15-minute series: daily chunk files at
 *    `observations/{year}/{month}/{day}/{id}.ttl` (all sharing one `{id}`) plus
 *    the located descriptor `observations/{year}/{id}.ttl` pointing at the year
 *    container.
 * @operation mutation
 */
export async function writeBuildingEnergy(
  gateway: PodGateway,
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
): Promise<EnergyDatasetLink[]> {
  const root = observationsRootForBuilding(buildingUri);
  const links: EnergyDatasetLink[] = [];

  const putTtl = async (uri: string, body: string): Promise<void> => {
    signal?.throwIfAborted();
    const res = await gateway.fetch(uri, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body,
      signal,
    });
    if (!res.ok) {
      throw new Error(`Energy upload failed (${uri}): ${res.status} ${res.statusText}`);
    }
  };

  for (const ds of annualDatasetsFromFields(buildingSubjectUri, fields)) {
    const fileUri = datasetFileUri(root, ds.year, mintDatasetId());
    await ensureContainer(seriesContainerUri(root, ds.year), gateway);
    await putTtl(fileUri, serializeEnergyDataset(ds));
    links.push({
      uri: datasetNodeUri(fileUri),
      granularity: ds.granularity,
      scenario: ds.scenario,
    });
  }

  if (series && series.days.length > 0) {
    const seriesId = mintDatasetId();
    const yearContainer = seriesContainerUri(root, series.year);
    await ensureContainer(yearContainer, gateway);
    // A full year is ~365 daily files; write them with bounded concurrency.
    // Day chunks are time-first (`{year}/{month}/{day}/{id}.ttl`), so each
    // distinct day container is provisioned before its chunk lands. Because the
    // writes run concurrently and many days share one month container, dedup the
    // ensure calls through a promise-cache: each container is created exactly
    // once and concurrent callers await the same in-flight promise — otherwise
    // they'd race to PUT the same shared parent and conflict.
    const ensuring = new Map<string, Promise<unknown>>();
    const ensureOnce = (uri: string): Promise<unknown> => {
      let p = ensuring.get(uri);
      if (!p) {
        p = ensureContainer(uri, gateway);
        ensuring.set(uri, p);
      }
      return p;
    };
    const ensureDayDir = async (date: string): Promise<void> => {
      const [, mm, dd] = date.split("-");
      const monthDir = `${yearContainer}${mm}/`;
      await ensureOnce(monthDir); // parent must exist before the day container
      await ensureOnce(`${monthDir}${dd}/`);
    };
    const total = series.days.length;
    let done = 0;
    onProgress?.(0, total);
    await mapPooled(series.days, 8, async (day) => {
      signal?.throwIfAborted();
      await ensureDayDir(day.date);
      const dailyUri = seriesDailyFileUri(root, day.date, seriesId);
      await putTtl(
        dailyUri,
        generateEnergyDayTtl(day.date, day.readings, buildingSubjectUri, series.label),
      );
      onProgress?.(++done, total);
    });
    const descUri = datasetFileUri(root, series.year, seriesId);
    await putTtl(
      descUri,
      serializeEnergyDataset({
        building: buildingSubjectUri,
        year: series.year,
        granularity: "PT15M",
        scenario: "actual",
        datasetLocation: yearContainer,
      }),
    );
    links.push({
      uri: datasetNodeUri(descUri),
      granularity: "PT15M",
      scenario: "actual",
    });
  }

  return links;
}

/**
 * Upload a building Turtle file to the user's Pod (provisioning the `buildings/`
 * container first), PUT-overwriting any existing file at the URI.
 * @operation mutation
 */
export async function uploadBuilding(
  gateway: PodGateway,
  buildingUri: string,
  ttlString: string,
  webId: string,
  signal?: AbortSignal,
): Promise<void> {
  // Provision the buildings/ container first (silently — the add flow has its
  // own "Building added" toast) so the building-file PUT below has somewhere
  // to land — via the shared helper.
  await ensureContainer(podResources(webId).buildings, gateway);
  signal?.throwIfAborted();
  const res = await gateway.fetch(buildingUri, {
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
  gateway: PodGateway,
  buildingFileUri: string,
  subjectUri: string,
  updatedFields: Record<string, string>,
  /** The full energy-unit list to replace the building's with. Pass it from the
   * per-unit editor; omit it on a plain field edit and the existing units are left
   * untouched. */
  systems?: TechnicalSystem[],
): Promise<void> {
  const subject = namedNode(subjectUri);
  await readModifyWrite(buildingFileUri, gateway, (store, { created }) => {
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
    // Rewrite the region (dcterms:spatial) when the edit carries it — an address
    // change re-geocodes and hands the fresh Gemeinde AGS in `regionAgs` (with
    // `regionConceptIri` cleared); without this the building kept pointing at
    // its OLD region forever. An edit that doesn't re-geocode omits both keys
    // and leaves the stored region intact.
    if ("regionAgs" in updatedFields || "regionConceptIri" in updatedFields) {
      store.removeQuads(
        store.getQuads(subject, namedNode(DCTERMS_SPATIAL), null, null),
      );
      addRegion(store, subject, updatedFields);
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
    // Replace the energy units only when the edit carries an explicit list (the
    // per-unit editor); a plain field edit leaves the building's units intact.
    if (systems) {
      replaceSystems(store, subject, systems);
    }
  });
}

/** Construct the POD IRI for a new building file. */
export function newBuildingUri(webId: string, id: string): string {
  return `${podResources(webId).buildings}${id}.ttl`;
}

/**
 * Permanently delete a building the user owns: delete its (time-first) energy
 * datasets — each `cons:hasEnergyDataset` resource and, for a series, every
 * day-chunk under its year container — its `buildings/{id}/` subtree (the
 * uploaded attachments under `files/`), then the building file itself. Own
 * buildings are now discovered by *listing* the `buildings/` container, so
 * removing the file de-registers it — there's no registry to update. Refuses to
 * touch resources outside the user's own Pod (e.g. a building shared from
 * another Pod), which must only be *hidden*.
 * @operation mutation
 */
export async function deleteBuilding(
  gateway: PodGateway,
  webId: string,
  buildingUri: string,
): Promise<void> {
  const fileUri = buildingFileUri(buildingUri);
  if (!fileUri.startsWith(getStorageRoot(webId))) {
    throw new Error("Refusing to delete a building outside your own Pod");
  }

  // Energy datasets are first-class under observations/; delete each linked
  // dataset (and a series' day-chunks) best-effort, from the building's links.
  const store = await readBuildingStore(gateway, fileUri);
  if (store) {
    for (const ref of parseEnergyDatasetRefs(store, null)) {
      const dsFile = ref.uri.split("#")[0];
      if (isSeriesGranularity(ref.granularity)) {
        for (const { uri } of await listSeriesDays(gateway, ref)) {
          await gateway.fetch(uri, { method: "DELETE" })
            .catch((err) => logError("delete energy day chunk", err));
        }
      }
      await gateway.fetch(dsFile, { method: "DELETE" })
        .catch((err) => logError("delete energy dataset", err));
    }
  }

  // The per-building subtree (`buildings/{id}/`, holding every uploaded
  // attachment under `files/`) is part of what the deletion preview promises
  // to remove. Delete it BEFORE the building file and let a failure propagate:
  // the building then stays listed and the delete is retryable, instead of
  // orphaning invisible (possibly still-shared) binaries on the Pod.
  await deleteContainerRecursive(fileUri.replace(/\.ttl$/, "/"), gateway);

  // Delete the file directly — NOT its .acl first. Removing a resource's .acl
  // before the resource would briefly fall it back to the container's (possibly
  // more permissive) inherited ACL — a TOCTOU exposure window. The owner-lockout
  // that motivated such a "recovery" is prevented at the source now (a revoke
  // never strips the owner's Control; see sharing.removeFromACL), so a
  // normal delete keeps the owner's authorization and just works.
  const res = await gateway.fetch(fileUri, { method: "DELETE" });
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
    const children = await listDirectChildren(container, gateway)
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
    // PV plant as a <#pv> :PVSystem node (presence ⇒ has PV).
    _pv_capacityKW: "750",
    _pv_commissioningYear: "2018",
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
    // Heat generation: a gas boiler + a heat pump, each a :TechnicalSystem with a thermal
    // nameplate + commissioning year (district heating absent).
    _gasboiler_present: "true",
    _gasboiler_thermalCapacityKW: "320",
    _gasboiler_commissioningYear: "2008",
    _heatpump_present: "true",
    _heatpump_thermalCapacityKW: "120",
    _heatpump_commissioningYear: "2019",
    // One certification (type drives investor:<Type>Certification).
    _cert_0_type: "DGNB",
    _cert_0_level: "Gold",
    _cert_0_scope: "New construction",
    // A few operating-cost categories (one investor:hasOperatingCosts node).
    _opcost_propertyManagement: "Medium",
    _opcost_security: "High",
    _opcost_operationInspectionAndMaintenance: "High",
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
    _pv_capacityKW: "480",
    _pv_commissioningYear: "2019",
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
    // Heat generation: a heat pump (cold store — electric-driven heat).
    _heatpump_present: "true",
    _heatpump_thermalCapacityKW: "90",
    _heatpump_commissioningYear: "2018",
    _cert_0_type: "LEED",
    _cert_0_level: "Silver",
    _cert_0_scope: "New construction",
    _opcost_propertyManagement: "Medium",
    _opcost_operationInspectionAndMaintenance: "Medium",
  },
  // Deliberately NOT self-operated: the cold store stays outside the operator
  // group, so the demo set also shows a building WITHOUT the Betreiber benchmark.
  energy: "annual",
  annual: {
    _inv_elec_2022: "210000", _inv_elec_2023: "205000", _inv_elec_2024: "198000",
    _inv_heat_2022: "60000", _inv_heat_2023: "58000", _inv_heat_2024: "55000",
    _inv_water_2022: "640", _inv_water_2023: "660", _inv_water_2024: "650",
    // The 480 kWp rooftop PV's annual yield (commissioned 2019): the one demo
    // building carrying electricity GENERATION, so the map's generation lens
    // (`metricElectricityGeneration`, magnitude-framed) has data to colour — a
    // building the consumption lens leaves blank surfaces under generation.
    _inv_gen_2022: "452000", _inv_gen_2023: "458000", _inv_gen_2024: "449000",
  },
};

/**
 * User demo: a 15-minute load-profile series (lazy-loaded, time-series chart)
 * PLUS a couple of annual years — the one demo carrying BOTH energy shapes, so
 * the Annual | Time series toggle shows on the demo data out of the box.
 * Light metadata otherwise — the shape an end user produces. Self-operated, so
 * the agent-link → agent path resolves out of the box.
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
    _pv_capacityKW: "120",
    _pv_commissioningYear: "2021",
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
 * The geocoder is **injected** (the caller passes `geocodeWithRegion`) so this
 * RDF/serialization module does no network I/O of its own — that keeps it free of
 * any `services/sources/` import (rdf↔sources stays acyclic).
 * @operation mutation
 */
export async function seedDemoBuildings(
  gateway: PodGateway,
  webId: string,
  geocode: (
    fields: Record<string, string>,
  ) => Promise<
    { lat: string; long: string; precision: GeocodePrecision; regionAgs?: string } | null
  >,
): Promise<{ seeded: number; total: number }> {
  let seeded = 0;
  for (const demo of DEMO_BUILDINGS) {
    try {
      const coords = await geocode(demo.fields);
      let fields: Record<string, string> = coords
        ? {
          ...demo.fields,
          lat: coords.lat,
          long: coords.long,
          geocodePrecision: coords.precision,
          ...(coords.regionAgs ? { regionAgs: coords.regionAgs } : {}),
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
        gateway,
        uri,
        subjectUri,
        fields,
        series,
      );
      if (demo.planned) {
        // The extra planned (Soll) dataset — its own time-first resource.
        const root = observationsRootForBuilding(uri);
        const fileUri = datasetFileUri(root, demo.planned.year, mintDatasetId());
        await ensureContainer(seriesContainerUri(root, demo.planned.year), gateway);
        const put = await gateway.fetch(fileUri, {
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
        energyLinks.push({
          uri: datasetNodeUri(fileUri),
          granularity: "P1Y",
          scenario: "planned",
        });
      }
      const ttl = serializeBuildingToTurtle(fields, uri, energyLinks, {
        agent: webId,
      });
      await uploadBuilding(gateway, uri, ttl, webId);
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

