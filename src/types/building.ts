// Building object model — the building record and its node parts (technical systems,
// operating costs, certifications, attachments). The flat fields + the controlled-vocab
// enums are GENERATED from vocab/building.ttl (buildingShape.generated.ts). Reached via
// the `src/types.ts` barrel.
import type {
  BuildingCertificationFields,
  BuildingFlatFields,
  GeoPointFields,
  OperatingCostsFields,
  TechnicalSystemFields,
} from "../services/rdf/buildingShape.generated.ts";
import type { AnnualData, EnergyDatasetRef } from "./consumption.ts";

// Re-export the vocab-derived enums so the rest of the app reaches them via `types.ts`.
export type {
  GeocodePrecision,
  IndoorTemperatureClass,
  ShiftRegime,
  TenancyType,
} from "../services/rdf/buildingShape.generated.ts";

/** The 11 operating-cost categories (free-text values), generated from the
 *  `:OperatingCosts`-domained properties (vocab/building.ttl). */
export type InvestorOperatingCosts = OperatingCostsFields;

export interface InvestorCertification extends BuildingCertificationFields {
  /** The certification standard (BREEAM/DGNB/LEED), from the node's `rdf:type` local name. */
  type: string;
}

/** The kind of energy / heat unit, fixed by the node's `rdf:type` (all ⊑
 * `:TechnicalSystem`). Energy: `:PVSystem` / `:BatteryStorage` / `:CHPSystem`. Heat
 * generation: `:HeatPump` / `:GasBoiler` / `:DistrictHeating` / `:OilBoiler` /
 * `:ElectricBoiler`. The building's one `bldg:hasSystem` list holds both; the UI splits
 * them into the "Energy systems" and "Heat generation" sections (see {@link HEAT_KINDS}). */
export type SystemKind =
  | "pv"
  | "battery"
  | "chp"
  | "heatpump"
  | "gasboiler"
  | "districtheating"
  | "oilboiler"
  | "electricboiler";

/** The heat-generation kinds (the "Heat generation" section); the rest are energy systems.
 * Heat generators carry a thermal nameplate (`thermalCapacityKW`) + `commissioningYear`. */
export const HEAT_KINDS = [
  "heatpump",
  "gasboiler",
  "districtheating",
  "oilboiler",
  "electricboiler",
] as const satisfies readonly SystemKind[];

/** Whether a system kind belongs to the Heat-generation group (vs. Energy systems). */
export const isHeatKind = (k: SystemKind): boolean =>
  (HEAT_KINDS as readonly SystemKind[]).includes(k);

/**
 * One energy unit of the building — the typed mirror of a single `bldg:hasSystem`
 * node. A building may carry SEVERAL (two PV plants, a battery, a CHP, …); each is
 * its own node with a STABLE hash-fragment `id`, so a per-unit observation's
 * `sosa:hasFeatureOfInterest` keeps pointing at the same unit across edits. The unit
 * carries its OWN `rec:operatedBy` (the Anlagenbetreiber, distinct from the building's
 * operator) and `owl:sameAs` the external MaStR Einheit. Which capacity field applies
 * depends on `kind`: PV/CHP electrical → `capacityKW`, battery → `storageCapacityKWh`,
 * CHP heat → `thermalCapacityKW`.
 */
export interface TechnicalSystem extends TechnicalSystemFields {
  /** Stable node fragment local-name — the node IRI is `<buildingFile>#{id}`, and the
   * feature-of-interest a per-unit observation attaches to. */
  id: string;
  kind: SystemKind;
  /** `rdfs:label` — the unit's own name (e.g. the MaStR Anlagenname
   * "PV-1-Anlage 45,36kWp_Halle2"), when the source carries one. */
  label?: string;
  operatedBy?: string; // rec:operatedBy — the UNIT operator's WebID/IRI
  sameAs?: string; // owl:sameAs the external MaStR Einheit IRI
  // capacityKW / storageCapacityKWh / thermalCapacityKW / commissioningYear ← TechnicalSystemFields
}

// The flat building fields (customer, areas, agents, the controlled-vocab enums, …) and the
// geo:Point's geocodePrecision are GENERATED from vocab/building.ttl — see BuildingFlatFields /
// GeoPointFields (`buildingShape.generated.ts`). Building adds only the structured node
// collections + the app-runtime fields below. Dynamic field access goes through the typed
// `setField` helper (no loose index signature).
export interface Building extends BuildingFlatFields, GeoPointFields {
  /** The building's identifier IS its subject IRI (see buildingId.ts):
   * storage-root-relative for the user's own buildings
   * (`granergize/buildings/<file>.ttl#it`), the full absolute IRI for
   * foreign/shared ones. Contains `/` and `#` — route builders must
   * `encodeURIComponent` it. */
  id: string;
  uri: string;
  sourceUri?: string;
  /** Provenance: the WebID the data was attributed to (`prov:agent`). Records only
   * WHO produced the building — there is no producing-role category (roles live only
   * in data rooms). Never drives parsing/loading/rendering. */
  attributedTo?: string;
  type: string;
  /**
   * Files attached to the building (`bldg:hasAttachment`), incl. the energy
   * certificate (flagged `isEnergyCertificate`). Stored under the per-building
   * `files/` container on the owner's Pod; downloaded via authed `session.fetch`.
   */
  attachments?: AttachmentRef[];
  /** Latitude/longitude on the building's `geo:Point` (external `geo:lat`/`geo:long`;
   * `geocodePrecision` is the vocab-derived field from `GeoPointFields`). */
  lat?: number;
  long?: number;
  /** The region's authoritative LAU/NUTS `skos:Concept` IRI — the `dcterms:spatial`
   * object, parsed verbatim. The canonical stored reference; the bare AGS join key is
   * the concept's own `dcterms:identifier`, read by dereferencing it (see
   * `regionGeometry.fetchRegionAgs`), so it generalises to NUTS concepts (whose IRI is
   * a NUTS code, not an AGS). */
  regionConceptIri?: string;
  /** The building's 8-digit Gemeinde AGS. Set at geocode time (drives serialization of
   * the LAU concept IRI) and, on a loaded building, resolved on demand from
   * `regionConceptIri`. Kreis = first 5 digits, Land = first 2 — the regional-statistics
   * / choropleth join key. */
  regionAgs?: string;
  /** The building's energy units (`bldg:hasSystem` nodes) — PV plants, batteries,
   * CHP. A flat list (several of a kind allowed); each carries a stable `id`. */
  systems?: TechnicalSystem[];
  /**
   * Unified energy model: the building's `cons:hasEnergyDataset` links (one per
   * year/granularity/scenario), derived from the link slugs. The actual figures
   * live in separate resources, fetched on demand (charts, export).
   */
  energyDatasets?: EnergyDatasetRef[];
  isShared?: boolean;
  /** Source tier: a public open-data building (LoD2 / `linked-lod2-by`), NOT a Pod
   *  resource — read-only (no share/edit/delete), shown under the finder's `open`
   *  tier. `isShared` and `isOpen` are mutually exclusive; neither set → owned
   *  (`mine`). */
  isOpen?: boolean;
  /** Open-tier only: the LoD2 installable rooftop-PV capacity [kWp] (display-only). */
  openKwp?: number;
  certifications?: InvestorCertification[];
  annualData?: AnnualData[];
  operatingCosts?: InvestorOperatingCosts;
  /** LoD2-BY (LDBV) authoritative building metadata BAKED into the imported building's
   *  Turtle (all optional — present only where the pipeline had it). Read-only: shown
   *  beside the app's own master data, never edited/serialized. `lod2AlkisId` = the ALKIS
   *  building id, `lod2RoofType` = the raw AdV roof-shape code (e.g. "1000" = flat),
   *  `lod2Storeys` = storeys above ground, `lod2CreationDate` = the LoD2 record date. */
  lod2AlkisId?: string;
  lod2RoofType?: string;
  lod2Storeys?: number;
  lod2CreationDate?: string;
  /** The building's authoritative LoD2-BY postal address (`locn:address` → `locn:Address`).
   *  Baked into the record so it survives offline / outside the live LoD2 coverage. */
  lod2Address?: {
    thoroughfare?: string;
    postName?: string;
    adminUnitL1?: string;
    fullAddress?: string;
  };
}

/** Typed dynamic write of a building field — the single place the dynamic-key cast
 *  lives, now that `Building` carries no loose index signature. Used by the parser
 *  to assign a parsed RDF value to the field its predicate maps to. */
export function setField(b: Building, field: keyof Building, value: unknown): void {
  (b as unknown as Record<string, unknown>)[field] = value;
}

/**
 * A file attached to a building (`bldg:hasAttachment`), described by schema.org
 * `MediaObject` metadata in the building TTL. The binary lives under the
 * per-building `files/` container; fetch it with an authenticated `session.fetch`.
 */
export interface AttachmentRef {
  /** The file's IRI on the Pod (also the RDF subject of its metadata). */
  uri: string;
  /** Original filename, for display/download (`schema:name`). */
  filename: string;
  /** IANA media type (`schema:encodingFormat`), e.g. `application/pdf`. */
  mediaType: string;
  /** Size in bytes (`schema:contentSize`); 0 if unknown. */
  size: number;
  /** ISO-8601 upload time (`dcterms:created`). */
  uploadDate: string;
  /** True when this file is the building's energy certificate. */
  isEnergyCertificate?: boolean;
}
