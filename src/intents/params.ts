/**
 * The typed **parameter schema** for the invocable intents — the reified
 * node-kind / range / cardinality of each modelled param.
 *
 * A separate module from {@link IntentAffordance} (`affordances.ts`): the lean
 * affordance table records only the `applies` state-guard, while THIS module is
 * the sole source of each intent's param shape — the field-name set plus the RDF
 * shape of each param (IRI reference vs literal, class/datatype range,
 * cardinality). The schema binds against the cores' TS param types via the
 * compile-time {@link ParamKeysMatch} witness (the field-name set, minus
 * runtime-only handles like `signal`). The palette's dialog-routing also keys off
 * this schema's modelled-param count (`hasModelledParams` in `commandPalette.ts`).
 *
 * **Step-4 seam:** the `nodeKind: "iri"` markers tell the future EntityQuery
 * resolver which params (`buildingUri`, `recipients`) need IRI→instance
 * resolution *before* `invoke()`; the `"literal"` ones are passed through.
 */
import {
  FOAF_AGENT,
  LDP_RESOURCE,
  REC_BUILDING,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_GYEAR,
  XSD_STRING,
} from "../services/rdf/vocabularies.ts";
import type { CoreParams, ReadIntentName, WriteIntentName } from "./registry.ts";

/** An RDF node kind: an IRI reference (resolvable to an instance) vs a literal. */
export type NodeKind = "iri" | "literal";

/** How many values a param takes. `one` = required single, `optional` = 0-or-1,
 *  `many` = required list (≥1), `any` = optional list (0+ — an absent/empty list is
 *  valid, e.g. a share's attachment subset where absent means "all"). */
export type Cardinality = "one" | "optional" | "many" | "any";

/** The reified RDF shape of one intent parameter. */
export interface ParamSpec {
  /** IRI reference (resolvable) vs. literal value. */
  readonly nodeKind: NodeKind;
  /** The param's range — a class IRI (for `iri`) or an XSD datatype IRI (for `literal`). */
  readonly range: string;
  /** How many values the param takes. */
  readonly cardinality: Cardinality;
}

/** A param schema: field name → its reified RDF shape. */
export type ParamSchema = Readonly<Record<string, ParamSpec>>;

/**
 * Reified param schemas keyed by the catalog intent `name`. Only the invocable
 * intents (those with an extracted core) are populated; Step 5 adds one entry per
 * newly-extracted core. Runtime-only handles (`signal`) are NOT modelled here —
 * they are an abort affordance, not an RDF param.
 */
export const INTENT_PARAMS = {
  // ── Buildings ──────────────────────────────────────────────────────────────
  AddBuilding: {
    // Opaque field-map array + readings: not IRIs to resolve, placeholder-modelled.
    buildings: { nodeKind: "literal", range: XSD_STRING, cardinality: "many" },
    lastgangReadings: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
  },
  UpdateBuilding: {
    fileUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    subjectUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    // Opaque edited-field map; not an IRI to resolve.
    fields: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
    // Opaque energy-unit list (the per-unit editor's payload); not palette-fillable.
    systems: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
  },
  DeleteBuilding: {
    // Opaque BuildingType instance; not an IRI to resolve.
    building: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
  },
  ToggleVisibility: {
    buildingUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
  },
  // ── Queries ──────────────────────────────────────────────────────────────────
  FindBuildings: {
    // Structured attribute selector (a {and:[{field,op,value}]} object); not an IRI
    // to resolve — modelled as an opaque literal (see selector.ts).
    selector: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
  },
  GetBuilding: {
    id: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
  },
  FindNearbyInstallations: {
    // The building is resolved to its coordinates; kind/radiusKm are literal scope.
    building: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    kind: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
    radiusKm: { nodeKind: "literal", range: XSD_DECIMAL, cardinality: "optional" },
  },
  FindRegionalStatistics: {
    // A Bundesland (name or AGS) literal, or a building resolved to its region.
    region: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
    building: { nodeKind: "iri", range: REC_BUILDING, cardinality: "optional" },
  },
  GetObservationYear: {
    building: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    year: { nodeKind: "literal", range: XSD_GYEAR, cardinality: "one" },
  },
  WhoHasAccess: {
    buildingUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
  },
  // Paramless: SharedWithMe folds the viewer's whole shared-in log.
  SharedWithMe: {},
  // ── Sharing ────────────────────────────────────────────────────────────────
  ShareBuilding: {
    buildingUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    recipients: { nodeKind: "iri", range: FOAF_AGENT, cardinality: "many" },
    includeEnergyData: { nodeKind: "literal", range: XSD_BOOLEAN, cardinality: "one" },
    years: { nodeKind: "literal", range: XSD_GYEAR, cardinality: "many" },
    // Subset of attachment file IRIs to include; absent ⇒ all attachments. Optional
    // list (`any`): a building with no attachments must still be shareable, so an
    // empty value must NOT block the param-form submit.
    attachmentUris: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "any" },
  },
  ShareAggregation: {
    snapshotUri: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "one" },
    recipients: { nodeKind: "iri", range: FOAF_AGENT, cardinality: "many" },
  },
  RevokeBuildingAccess: {
    buildingUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    webId: { nodeKind: "iri", range: FOAF_AGENT, cardinality: "one" },
  },
  // Paramless (collection-wide): the inbox drain / ACL rebuild take no params.
  CheckInbox: {},
  ReissueGrants: {},
  // ── Observations ─────────────────────────────────────────────────────────────
  SaveObservation: {
    fileUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    subjectUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    // Opaque EnergyDataset instance; not an IRI to resolve.
    dataset: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
  },
  DeleteObservation: {
    fileUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    subjectUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    // Opaque (year, granularity, scenario) selector; not an IRI to resolve.
    dataset: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
  },
  // ── Attachments ──────────────────────────────────────────────────────────────
  UploadAttachments: {
    fileUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    subjectUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    // Opaque File[]; not IRIs to resolve.
    files: { nodeKind: "literal", range: XSD_STRING, cardinality: "many" },
  },
  DeleteAttachment: {
    fileUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    subjectUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    uri: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "one" },
  },
  SetEnergyCertificate: {
    fileUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    subjectUri: { nodeKind: "iri", range: REC_BUILDING, cardinality: "one" },
    uri: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "optional" },
  },
  // ── Aggregations ─────────────────────────────────────────────────────────────
  CreateAggregation: {
    name: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
    buildingUris: { nodeKind: "iri", range: REC_BUILDING, cardinality: "many" },
    aggregationType: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
    metrics: { nodeKind: "literal", range: XSD_STRING, cardinality: "many" },
    period: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
    benchmark: { nodeKind: "literal", range: XSD_BOOLEAN, cardinality: "optional" },
    extentLevel: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
  },
  DeleteAggregation: {
    aggregationId: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
  },
  RefreshAggregation: {
    aggregationId: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
  },
  RevokeAggregationAccess: {
    snapshotUri: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "one" },
    webId: { nodeKind: "iri", range: FOAF_AGENT, cardinality: "one" },
  },
  // ── Rooms ──────────────────────────────────────────────────────────────────
  // `roomUri`/`room` are room-container IRIs (resolvable). `input` (AddRoom) is a
  // raw URI OR an invite link (not necessarily an IRI) → literal placeholder.
  // `roles` are membership-role labels (a `UserRole` string, not the IRI it maps
  // to) → literal placeholder. SeedDemoRooms is paramless.
  CreateRoom: {
    // Optional human name for the room (its rdfs:label).
    name: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
  },
  EnterRoom: {
    roomUri: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "one" },
  },
  ExitRoom: {
    roomUri: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "one" },
  },
  DeleteRoom: {
    roomUri: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "one" },
  },
  AddRoom: {
    input: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
  },
  RemoveBookmark: {
    roomUri: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "one" },
  },
  SaveRoles: {
    room: { nodeKind: "iri", range: LDP_RESOURCE, cardinality: "one" },
    roles: { nodeKind: "literal", range: XSD_STRING, cardinality: "many" },
  },
  SeedDemoRooms: {},
  // ── Contacts ─────────────────────────────────────────────────────────────────
  // `contact` is an opaque SavedAgent instance (not an IRI to resolve) → placeholder;
  // `logo` an opaque File (an org contact's logo image, optional); `webId` is a
  // removable contact's WebID → IRI reference. SeedDemoAgents is paramless.
  SaveAgent: {
    contact: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
    logo: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
  },
  RemoveAgent: {
    webId: { nodeKind: "iri", range: FOAF_AGENT, cardinality: "one" },
  },
  SeedDemoAgents: {},
  // ── Organisation ─────────────────────────────────────────────────────────────
  // `org` is an opaque fields object, `logo` an opaque File — neither an IRI to
  // resolve, both placeholder-modelled (the `logo` is a real, optional param).
  SaveOrganisation: {
    org: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
    logo: { nodeKind: "literal", range: XSD_STRING, cardinality: "optional" },
  },
  // ── Account ──────────────────────────────────────────────────────────────────
  // SeedDemoBuildings is paramless (collection-wide; the core reads the WebID off
  // the gateway). RemoveAppData's only param is the runtime-only `signal` → empty.
  // RestoreArchive's `bytes` is an opaque Uint8Array → placeholder.
  SeedDemoBuildings: {},
  RemoveAppData: {},
  RestoreArchive: {
    bytes: { nodeKind: "literal", range: XSD_STRING, cardinality: "one" },
  },
  ExportArchive: {},
  AuditGrants: {},
  CheckObservationLinks: {},
} as const satisfies Record<string, ParamSchema>;

/** A catalog name with a reified param schema. */
export type ParamIntentName = keyof typeof INTENT_PARAMS;

// ── Compile-time key-set witness ──────────────────────────────────────────────
// Lightweight binding to the core arg type: assert the schema's field names equal
// the core's param keys MINUS runtime-only fields (`signal`). Catches a core
// gaining/renaming a param. We do NOT attempt full structural value-typing — TS
// can't express IRI-ness, so the rigour wouldn't pay.

/** Param keys supplied at runtime (callbacks, or a runtime-provided selector like the
 *  building-less delete's `observationUri`), never modelled in the param-form schema. */
type RuntimeOnlyKey = "signal" | "onProgress" | "onUploaded" | "observationUri";

/** The modelled key set of a core's param object (runtime-only keys stripped). */
type ModelledCoreKeys<N extends ParamIntentName> = N extends
  WriteIntentName | ReadIntentName
  ? Exclude<keyof CoreParams<N>, RuntimeOnlyKey>
  : never;

/**
 * `true` iff `INTENT_PARAMS[N]`'s field-name set exactly equals the core's
 * modelled param keys. Used as a type-level assertion below — any mismatch makes
 * the corresponding entry resolve to `false` and breaks the build.
 */
export type ParamKeysMatch<N extends ParamIntentName> =
  [keyof (typeof INTENT_PARAMS)[N]] extends [ModelledCoreKeys<N>]
    ? [ModelledCoreKeys<N>] extends [keyof (typeof INTENT_PARAMS)[N]] ? true
    : false
    : false;

/**
 * Build-time assertion that every populated schema's keys match its core's
 * modelled params. A `false` here is a type error (the build runs the check).
 */
const _paramKeysMatch: {
  [N in ParamIntentName]: ParamKeysMatch<N>;
} = {
  AddBuilding: true,
  UpdateBuilding: true,
  DeleteBuilding: true,
  ToggleVisibility: true,
  FindBuildings: true,
  FindNearbyInstallations: true,
  FindRegionalStatistics: true,
  GetBuilding: true,
  GetObservationYear: true,
  WhoHasAccess: true,
  SharedWithMe: true,
  ShareBuilding: true,
  ShareAggregation: true,
  RevokeBuildingAccess: true,
  CheckInbox: true,
  ReissueGrants: true,
  SaveObservation: true,
  DeleteObservation: true,
  UploadAttachments: true,
  DeleteAttachment: true,
  SetEnergyCertificate: true,
  CreateAggregation: true,
  DeleteAggregation: true,
  RefreshAggregation: true,
  RevokeAggregationAccess: true,
  CreateRoom: true,
  EnterRoom: true,
  ExitRoom: true,
  DeleteRoom: true,
  AddRoom: true,
  RemoveBookmark: true,
  SaveRoles: true,
  SeedDemoRooms: true,
  SaveAgent: true,
  RemoveAgent: true,
  SeedDemoAgents: true,
  SaveOrganisation: true,
  SeedDemoBuildings: true,
  RemoveAppData: true,
  RestoreArchive: true,
  ExportArchive: true,
  AuditGrants: true,
  CheckObservationLinks: true,
};
void _paramKeysMatch;
