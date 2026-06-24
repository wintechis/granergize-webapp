export type UserRole =
  | "dummy"
  | "investor"
  | "user"
  | "benchmark_service_provider"
  | "facility_manager"
  | "developer"
  | "consultant_broker"
  | "software_provider"
  | "energy_provider";

export interface AnnualData {
  year: number;
  electricityConsumption?: number; // kWh
  renewableSelfGeneratedShare?: number; // %
  heatConsumption?: number; // kWh
  waterConsumption?: number; // m³
  wastewaterConsumption?: number; // m³
  electricityGeneration?: number; // kWh
}

export interface InvestorOperatingCosts {
  wasteDisposal?: string;
  insurance?: string;
  operationInspectionAndMaintenance?: string;
  routineCleaningOffice?: string;
  routineCleaningWarehouse?: string;
  glassCleaning?: string;
  exteriorMaintenance?: string;
  security?: string;
  propertyManagement?: string;
  caretaker?: string;
  repairAndMaintenance?: string;
}

export interface InvestorCertification {
  type: string; // "BREEAM" | "DGNB" | "LEED"
  level?: string;
  scope?: string;
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
export interface TechnicalSystem {
  /** Stable node fragment local-name — the node IRI is `<buildingFile>#{id}`, and the
   * feature-of-interest a per-unit observation attaches to. */
  id: string;
  kind: SystemKind;
  capacityKW?: number; // :capacityKW (xsd:decimal) — PV/CHP electrical nameplate
  storageCapacityKWh?: number; // :storageCapacityKWh — battery usable energy
  thermalCapacityKW?: number; // :thermalCapacityKW — CHP heat output
  commissioningYear?: number; // :commissioningYear (xsd:gYear)
  operatedBy?: string; // rec:operatedBy — the UNIT operator's WebID/IRI
  sameAs?: string; // owl:sameAs the external MaStR Einheit IRI
}

export interface BuildingType {
  [key: string]:
    | string
    | number
    | boolean
    | EnergyDatasetRef[]
    | AttachmentRef[]
    | AnnualData[]
    | InvestorCertification[]
    | InvestorOperatingCosts
    | TechnicalSystem[]
    | undefined;
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
  customer?: string;
  /** URL of the energy certificate file, if any (`bldg:hasEnergyCertificate`). */
  energyCertificate?: string;
  /**
   * Files attached to the building (`bldg:hasAttachment`), incl. the energy
   * certificate (flagged `isEnergyCertificate`). Stored under the per-building
   * `files/` container on the owner's Pod; downloaded via authed `session.fetch`.
   */
  attachments?: AttachmentRef[];
  lat?: number;
  long?: number;
  /** How precisely lat/long were geocoded (from the geo:Point), when known. */
  geocodePrecision?: "address" | "postcode" | "city";
  locality?: string;
  /** An identifier, not a number (leading zeros: "01067"). */
  postalCode?: string;
  region?: string;
  /** The building's 8-digit Gemeinde AGS, resolved from its coordinates at geocode time
   * (`dcterms:spatial`). Kreis = first 5 digits, Land = first 2. Drives the regional-statistics
   * join and the aggregation spatial coordinate without a per-read reverse-geocode. */
  regionAgs?: string;
  streetAddress?: string;
  buildingArea?: number;
  landArea?: number;
  /** The building's energy units (`bldg:hasSystem` nodes) — PV plants, batteries,
   * CHP. A flat list (several of a kind allowed); each carries a stable `id`. */
  systems?: TechnicalSystem[];
  /** Investor WebID (`bldg:investor`, ranges over foaf:Agent — an agent link like
   * operatedBy, not a free-text label). Legacy literal values tolerated on read. */
  investor?: string;
  officeArea?: number;
  usedAs?: string;
  yearOfConstruction?: number;
  /** An identifier, not a number ("52.10" ≠ 52.1). */
  naceCode?: string;
  operatedBy?: string;
  /** Owner WebID (`rec:ownedBy`, ranges over foaf:Agent — an agent link like
   * operatedBy). Legacy literal values tolerated on read. */
  ownedBy?: string;
  /** Facility-manager WebID (`bldg:facilityManagedBy`) — an agent link, distinct
   * from the operator. */
  facilityManagedBy?: string;
  /** Project-developer WebID (`bldg:developedBy`) — who developed the building. */
  developedBy?: string;
  /** Consultant/broker WebID (`bldg:consultedBy`) — who consults for / markets
   * the building (Vertriebsunterstützung). */
  consultedBy?: string;
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
  logisticsFunction?: string;
  climateControlType?: string;
  greenLeaseShare?: number; // %
  companyName?: string;
  // Investor role fields
  label?: string;
  buildingCode?: string;
  hallArea?: number;
  officeSocialArea?: number;
  buildingHeight?: number;
  numberOfLoadingDocks?: number;
  yearOfRenovation?: number;
  shiftRegime?: string;
  tenancyType?: string;
  leaseType?: string;
  tenantIndustry?: string;
  indoorTemperatureClass?: string;
  // Heat generators (oil/gas/electric boiler, heat pump, district heating) are no longer
  // booleans — they're :TechnicalSystem nodes in `systems` (the "Heat generation" section),
  // carrying thermalCapacityKW + commissioningYear like PV/battery/CHP.
  certifications?: InvestorCertification[];
  annualData?: AnnualData[];
  operatingCosts?: InvestorOperatingCosts;
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

/** Actual readings vs planned (Soll) figures, at the energy-dataset level. */
export type Scenario = "actual" | "planned";

/**
 * A reference to one `cons:EnergyDataset`, derived from a building's
 * `cons:hasEnergyDataset` link. Datasets are time-first under `observations/`
 * (`observations/{year}/{id}.ttl#ds`), so the link path yields the year; the
 * granularity and scenario are read from the triples the building re-states
 * about the dataset node (`cons:granularity`/`cons:scenario`) — so load can be
 * dispatched (series lazy, annual prefetched) without fetching the dataset. See
 * `services/rdf/energyDataset.ts`.
 */
export interface EnergyDatasetRef {
  /** The dataset node IRI (the linked `observations/{year}/{id}.ttl#ds`). */
  uri: string;
  year: number;
  granularity: string;
  scenario: Scenario;
  /** The `sosa:hasFeatureOfInterest` the dataset observes, when a specific unit
   * (a `bldg:hasSystem` node, e.g. `<#pv>`) rather than the building as a whole.
   * Part of a dataset's identity, so a per-unit series doesn't collide with the
   * building's for the same (year, granularity, scenario). */
  featureOfInterest?: string;
}

export type EnergyType = {
  /** The owning building's id (see {@link BuildingType.id}). */
  id: string;
  uri: string;
  /** The annual year the figures cover (the latest accessible actual year). */
  year?: number;
  energyNeed: EnergyNeed;
  energyGeneration: EnergyGeneration;
  energyStorage: EnergyStorage;
  energyDistribution: EnergyDistribution;
  energyTransfer: EnergyTransfer;
  energyUsage: EnergyUsage;
  environmentalFactor: EnvironmentalFactor;
};

export type EnergyCategoryKey =
  | "energyNeed"
  | "energyGeneration"
  | "energyStorage"
  | "energyDistribution"
  | "energyTransfer"
  | "energyUsage"
  | "environmentalFactor";

type EnergyNeed = {
  [key: string]: number | undefined;
  gas?: number;
  electricity?: number;
  gridSupply?: number;
  solar?: number;
  solarSpaceHeating?: number;
  photovoltaic?: number;
  selfConsumption?: number;
  gridFeedIn?: number;
  hallHeatingFromWasteLoss?: number;
  frostProtectionHBWFromWasteLoss?: number;
  ambientHeat?: number;
  ventilationHeat?: number;
  personHeat?: number;
  groundwater?: number;
  woodChips?: number;
};

type EnergyGeneration = {
  [key: string]: number | undefined;
  hallLighting?: number;
  heatGeneration?: number;
  HbwHeat?: number;
  hallHeat?: number;
};

type EnergyStorage = {
  [key: string]: number | undefined;
  forkliftBatteryCharging?: number;
  heatStorage?: number;
};

type EnergyDistribution = {
  [key: string]: number | undefined;
  heatDistribution?: number;
  intralogisticsHallDistribution?: number;
  intralogisticsHbwDistribution?: number;
  hallHeatDistribution?: number;
  HbwHeatDistribution?: number;
};

type EnergyTransfer = {
  [key: string]: number | undefined;
  intralogisticsHallTransfer?: number;
  intralogisticsHbwTransfer?: number;
  hallHeatTransfer?: number;
  HbwHeatTransfer?: number;
  heatTransfer?: number;
  ForkliftTransfer?: number;
};

type EnergyUsage = {
  [key: string]: number | undefined;
  hallSpaceHeating?: number;
  work?: number;
  HbwFrostProtection?: number;
};

type EnvironmentalFactor = {
  [key: string]: number | undefined;
  cold?: number;
};

// Aggregation types
export type AggregationType = "average" | "sum" | "min" | "max";

/**
 * The SPATIAL coordinate of an aggregation — the region its members roll up to, distinct from
 * the ad-hoc `buildingUris` extent. `region` is a NUTS/LAU concept IRI (a `skos:Concept` served
 * by the geo wrappers, e.g. `…/ags/09564`); `level` names which hierarchy level it sits at
 * (e.g. "gemeinde", "kreis") — kept general so a non-administrative hierarchy can be named later.
 * Absent on an aggregation over a heterogeneous building set with no single region — such an
 * aggregation falls back to point/centroid rendering on the map guise (plan-aggregations Slice 1).
 */
export interface SpatialExtent {
  region: string; // skos:Concept IRI (the region node)
  level: string; // hierarchy level / which hierarchy
}

export interface AggregationDefinition {
  id: string;
  name: string;
  buildingUris: string[]; // Private - not included in shared snapshots
  aggregationType: AggregationType;
  metrics: string[]; // e.g., ["gas", "electricity", "solar"]
  createdAt: string; // ISO timestamp
  lastComputedAt?: string; // ISO timestamp of last snapshot computation
  period?: string; // "YYYY-MM" — set for user-role electricity aggregations
  /** Marks the aggregation as a benchmark: every (re)compute derives the snapshot's
   * bench:BenchmarkResult typing from this persisted flag, so a refresh can't
   * strip it. The covered year (metricPeriod) is derived from the data at
   * compute time, not stored. */
  benchmark?: boolean;
  /** The region this aggregation covers, when its members roll up to one. */
  spatialExtent?: SpatialExtent;
}

export interface AggregationSnapshot {
  id: string;
  name: string;
  aggregationType: AggregationType;
  metrics: string[];
  computedAt: string;
  buildingCount: number; // How many buildings were aggregated (privacy-preserving)
  values: Record<string, number>; // metric name -> computed value
  // Benchmark-result fields (set when a benchmark service provider computes this
  // snapshot over the buildings shared to it): the snapshot is additionally typed
  // bench:BenchmarkResult and carries who computed it and which year it covers.
  isBenchmark?: boolean;
  computedBy?: string; // WebID of the computing agent (bench:computedBy)
  metricPeriod?: string; // year the metrics cover (bench:metricPeriod), e.g. "2024"
  /** The region this snapshot covers, when its members roll up to one — recorded IN the
   * snapshot Turtle so a shared snapshot stays self-sufficient (replayable by the recipient). */
  spatialExtent?: SpatialExtent;
}

export interface SharedAggregation {
  aggregationUri: string;
  aggregationId: string;
  sharedWith: string[]; // WebIDs
}
