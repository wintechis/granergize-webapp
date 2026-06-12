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
}

export interface InvestorOperatingCosts {
  wasteDisposal?: string;
  insurance?: string;
  operationInspectionAndMaintenance?: boolean;
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
  streetAddress?: string;
  buildingArea?: number;
  landArea?: number;
  hasPVSystem?: boolean;
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
   * the building (Vertriebsoptimierung). */
  consultedBy?: string;
  /**
   * Unified energy model: the building's `cons:hasEnergyDataset` links (one per
   * year/granularity/scenario), derived from the link slugs. The actual figures
   * live in separate resources, fetched on demand (charts, export).
   */
  energyDatasets?: EnergyDatasetRef[];
  isShared?: boolean;
  logisticsFunction?: string;
  climateControlType?: string;
  greenLeaseShare?: number; // %
  pvInstallationYear?: number;
  pvCapacityKW?: number;
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
  hasOilBoiler?: boolean;
  hasGasBoiler?: boolean;
  hasElectricBoiler?: boolean;
  hasHeatPump?: boolean;
  hasDistrictHeating?: boolean;
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
  url: string;
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
 * `cons:hasEnergyDataset` link. The link slug (`<year>-<granularity>[-planned]`)
 * is self-describing, so year/granularity/scenario are known without fetching the
 * dataset (used to dispatch load: series lazy, annual prefetched). See
 * `services/rdf/energyDataset.ts`.
 */
export interface EnergyDatasetRef {
  /** The dataset node URL (the linked `…/<slug>.ttl#ds`). */
  url: string;
  year: number;
  granularity: string;
  scenario: Scenario;
}

export type WeatherType = {
  id: string;
  sunshineDuration?: number;
};

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

// Aggregated View types
export type AggregationType = "average" | "sum" | "min" | "max";

export interface AggregatedViewDefinition {
  id: string;
  name: string;
  buildingUris: string[]; // Private - not included in shared snapshots
  aggregationType: AggregationType;
  metrics: string[]; // e.g., ["gas", "electricity", "solar"]
  createdAt: string; // ISO timestamp
  lastComputedAt?: string; // ISO timestamp of last snapshot computation
  period?: string; // "YYYY-MM" — set for user-role electricity views
  /** Marks the view as a benchmark: every (re)compute derives the snapshot's
   * bench:BenchmarkResult typing from this persisted flag, so a refresh can't
   * strip it. The covered year (metricPeriod) is derived from the data at
   * compute time, not stored. */
  benchmark?: boolean;
}

export interface AggregatedViewSnapshot {
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
}

export interface SharedAggregatedView {
  viewUri: string;
  viewId: string;
  sharedWith: string[]; // WebIDs
}
