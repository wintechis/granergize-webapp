import type { Quad } from "@rdfjs/types";
import type {
  AttachmentRef,
  Building,
  EnergyDatasetRef,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../../../types.ts";
import { setField } from "../../../types.ts";

/** Raw props collected off one `bldg:hasSystem` node before dispatch on its type. */
interface SystemRaw {
  type?: string;
  label?: string;
  capacityKW?: number;
  storageCapacityKWh?: number;
  thermalCapacityKW?: number;
  commissioningYear?: number;
  operatedBy?: string;
  sameAs?: string;
}
import {
  iriPropertyMap,
  objectPropertyMap,
  parsingFunctions,
  predicateMap,
  OPCOST_FIELDS,
} from "./buildingConfig.ts";
import {
  BUILDING_NS,
  CONSUMPTION_NS,
  DCTERMS_CREATED,
  DCTERMS_SPATIAL,
  GEO_LAT,
  GEO_LOCATION,
  GEO_LONG,
  GRAN_GEOCODE_PRECISION,
  GRAN_HAS_ATTACHMENT,
  IRI_TO_GEOCODE_PRECISION,
  LOCN_ADDRESS,
  LOCN_ADMIN_UNIT_L1,
  LOCN_FULL_ADDRESS,
  LOCN_POST_NAME,
  LOCN_THOROUGHFARE,
  LOD2_ALKIS_ID,
  LOD2_ROOF_TYPE,
  LOD2_STOREYS_ABOVE_GROUND,
  OWL_SAME_AS,
  PROV_AGENT,
  PROV_QUALIFIED_ATTRIBUTION,
  RDF_TYPE,
  RDFS_LABEL,
  REC_BUILDING,
  REC_NS,
  SCHEMA_CONTENT_SIZE,
  SCHEMA_ENCODING_FORMAT,
  SCHEMA_NAME,
  IRI_TO_SYSTEM_KIND,
} from "../vocabularies.ts";
import { Store } from "n3";
import { parseDatasetLink } from "../../energy/energyDataset.ts";
import { buildingIdFor } from "./buildingId.ts";

/** Get the local name (after # or last /) from an IRI */
function localName(iri: string): string {
  const hash = iri.split("#")[1];
  if (hash) return hash;
  const parts = iri.split("/");
  return parts[parts.length - 1];
}

/**
 * Parse buildings out of a quad set. Detection is TYPE-driven: a named-node
 * subject is a building iff it carries `rdf:type rec:Building` — the explicit
 * assertion every producer writes — so arbitrary named nodes (dataset nodes,
 * attachment metadata, profile nodes) are never mistaken for buildings, the
 * job the old strict IRI-pattern matcher used to do. Identity is the subject
 * IRI itself (see buildingId.ts): the map key / `id` is the storage-relative
 * reference when `ownStorageRoot` is given and the subject lives under it,
 * else the absolute IRI verbatim — so foreign documents holding SEVERAL
 * buildings (`<#building-1>`, `<#building-2>`) stay distinct without any
 * uniqueness assumption about their naming.
 */
export function parseBuildings(
  quads: Quad[],
  ownStorageRoot?: string,
): Map<string, Building> {
  const buildings = new Map<string, Building>();
  // ── Pass 0: the building roster — subjects typed rec:Building ─────────────
  const buildingSubjects = new Set<string>();
  for (const quad of quads) {
    if (
      quad.subject.termType === "NamedNode" &&
      quad.predicate.value === RDF_TYPE &&
      quad.object.value === REC_BUILDING
    ) {
      buildingSubjects.add(quad.subject.value);
    }
  }
  /** building ID → its `cons:hasEnergyDataset` link IRIs (unified energy model). */
  const energyDatasetLinks = new Map<string, string[]>();
  /** blank node ID - building ID for operating costs */
  const opCostBuildingMap = new Map<string, string>();
  /** blank node ID - building ID for certifications */
  const certBuildingMap = new Map<string, string>();
  /** blank node ID - building ID for the PROV qualified attribution */
  const provBuildingMap = new Map<string, string>();
  /** blank node ID - building ID for the geo:Point (coordinates + precision) */
  const geoPointBuildingMap = new Map<string, string>();
  /** building ID → its bldg:hasAttachment file IRIs */
  const attachmentLinks = new Map<string, string[]>();
  /** attachment file IRI → building ID (the file IRI is the metadata subject) */
  const attachmentUriBuilding = new Map<string, string>();
  /** PV-system node IRI (`<…#pv>`) → building ID. The node is a NamedNode subject
   * (a hash fragment, not a blank node), so its props are collected separately. */
  const systemNodeBuilding = new Map<string, string>();
  /** LoD2 `locn:Address` node IRI (`<…#lod2-address>`) → building ID. A NamedNode hash
   * fragment (not a blank node), so its `locn:*` props are collected in a separate pass. */
  const lod2AddressNodeBuilding = new Map<string, string>();

  // ── Pass 1: Create buildings from the typed roster ────────────────────────
  quads.forEach((quad: Quad) => {
    if (quad.subject.termType === "BlankNode") return;
    if (!buildingSubjects.has(quad.subject.value)) return;

    // The subject IRI IS the identity; the id is its storage-relative form
    // for own buildings (verbatim part of the IRI, so a label built from it
    // still matches what the user sees in the IRI — heike-5 #1).
    const buildingId = buildingIdFor(quad.subject.value, ownStorageRoot);

    if (!buildings.has(buildingId)) {
      buildings.set(buildingId, {
        id: buildingId,
        // Use the RDF subject as the building URI so it links correctly with observations.
        // Store the source file IRI separately for ownership checks.
        uri: quad.subject.value,
        sourceUri: quad.graph.value,
        type: REC_BUILDING,
        certifications: [],
      });
    }

    const building = buildings.get(buildingId)!;
    const pred = quad.predicate.value;
    const obj = quad.object;

    // Unified energy model: cons:hasEnergyDataset links (one per dataset
    // resource). The slug is self-describing, so refs are derived in post-processing.
    if (pred === `${CONSUMPTION_NS}hasEnergyDataset`) {
      if (obj.termType === "NamedNode") {
        const links = energyDatasetLinks.get(buildingId) ?? [];
        links.push(obj.value);
        energyDatasetLinks.set(buildingId, links);
      }
      return;
    }

    // Building file attachments: bldg:hasAttachment → a file IRI. The file IRI is
    // itself the subject of the schema.org media metadata, collected separately
    // below (NamedNode subject, so both passes otherwise skip it).
    if (pred === GRAN_HAS_ATTACHMENT) {
      if (obj.termType === "NamedNode") {
        const links = attachmentLinks.get(buildingId) ?? [];
        links.push(obj.value);
        attachmentLinks.set(buildingId, links);
        attachmentUriBuilding.set(obj.value, buildingId);
      }
      return;
    }

    // Investor operating costs blank-node
    if (pred === `${BUILDING_NS}hasOperatingCosts`) {
      if (obj.termType === "BlankNode") {
        opCostBuildingMap.set(obj.value, buildingId);
      }
      return;
    }

    // Investor certification blank-node
    if (pred === `${BUILDING_NS}hasBuildingCertification`) {
      if (obj.termType === "BlankNode") {
        certBuildingMap.set(obj.value, buildingId);
      }
      return;
    }

    // PROV qualified attribution blank-node (provenance)
    if (pred === PROV_QUALIFIED_ATTRIBUTION) {
      if (obj.termType === "BlankNode") {
        provBuildingMap.set(obj.value, buildingId);
      }
      return;
    }

    // Coordinates blank-node (geo:Point: lat/long + geocode precision)
    if (pred === GEO_LOCATION) {
      if (obj.termType === "BlankNode") {
        geoPointBuildingMap.set(obj.value, buildingId);
      }
      return;
    }

    // Region: dcterms:spatial → the LAU/NUTS `skos:Concept` IRI, kept verbatim. The
    // bare AGS join key is the concept's own `dcterms:identifier`, resolved on demand
    // by dereferencing it (regionGeometry.fetchRegionAgs) — not stored in this file.
    if (pred === DCTERMS_SPATIAL) {
      building.regionConceptIri = obj.value;
      return;
    }

    // ── LoD2-BY (LDBV) baked metadata (all optional) ──
    // The authoritative cadastre-derived scalars written straight onto the building
    // subject; read-only, shown beside the app's own master data.
    if (pred === LOD2_ALKIS_ID) {
      building.lod2AlkisId = obj.value;
      return;
    }
    if (pred === LOD2_ROOF_TYPE) {
      building.lod2RoofType = obj.value; // raw AdV code (e.g. "1000" = flat)
      return;
    }
    if (pred === LOD2_STOREYS_ABOVE_GROUND) {
      building.lod2Storeys = parseInt(obj.value, 10);
      return;
    }
    // The LoD2 record date (dcterms:created ON THE BUILDING — the attachment upload
    // date uses the same predicate, but on the file IRI subject, gathered separately).
    if (pred === DCTERMS_CREATED) {
      building.lod2CreationDate = obj.value;
      return;
    }
    // The LoD2 postal address node (`<#lod2-address>`, typed locn:Address) — a NamedNode
    // hash fragment whose locn:* props are collected in a separate pass below.
    if (pred === LOCN_ADDRESS) {
      if (obj.termType === "NamedNode") {
        lod2AddressNodeBuilding.set(obj.value, buildingId);
      }
      return;
    }

    // Technical-system node (bldg:hasSystem → a `<#pv>`/`<#battery>`/`<#chp>` IRI).
    // A building can carry several; each is a NamedNode hash fragment whose props —
    // including its rdf:type, which decides which system it is — are collected in a
    // separate pass below and dispatched there.
    if (pred === `${BUILDING_NS}hasSystem`) {
      if (obj.termType === "NamedNode") {
        systemNodeBuilding.set(obj.value, buildingId);
      }
      return;
    }

    // Object properties mapping to local-name labels (shiftRegime, tenancyType, etc.)
    if (
      obj.termType === "NamedNode" &&
      Object.prototype.hasOwnProperty.call(objectPropertyMap, pred)
    ) {
      const propertyName = objectPropertyMap[pred];
      const ln = localName(obj.value);
      setField(building, propertyName, ln);
      return;
    }

    // Agent/IRI-reference properties (e.g. operatedBy → a WebID). The object is a
    // NamedNode; tolerate a legacy xsd:string literal (old Pods stored operatedBy
    // as a string) — obj.value yields the IRI/text either way.
    if (Object.prototype.hasOwnProperty.call(iriPropertyMap, pred)) {
      setField(building, iriPropertyMap[pred], obj.value);
      return;
    }

    // Regular datatype properties
    if (Object.prototype.hasOwnProperty.call(predicateMap, pred)) {
      const propertyName = predicateMap[pred];
      const parseFn = parsingFunctions[propertyName as string];
      if (parseFn) {
        setField(building, propertyName, parseFn(obj.value));
      } else {
        setField(building, propertyName, obj.value);
      }
    }
  });

  // ── Pass 2: Collect blank-node data ───────────────────────────────────────

  const opCostData = new Map<string, Partial<InvestorOperatingCosts>>();
  const certData = new Map<
    string,
    { type?: string; level?: string; scope?: string }
  >();
  const provData = new Map<
    string,
    { agent?: string }
  >();
  const geoData = new Map<
    string,
    { lat?: number; long?: number; precision?: Building["geocodePrecision"] }
  >();

  quads.forEach((quad: Quad) => {
    if (quad.subject.termType !== "BlankNode") return;

    const bId = quad.subject.value;
    const pred = quad.predicate.value;
    const obj = quad.object;
    const objVal = obj.value;

    // ── geo:Point blank node (coordinates + geocode precision) ──
    if (geoPointBuildingMap.has(bId)) {
      if (!geoData.has(bId)) geoData.set(bId, {});
      const gd = geoData.get(bId)!;
      if (pred === GEO_LAT) gd.lat = parseFloat(objVal);
      else if (pred === GEO_LONG) gd.long = parseFloat(objVal);
      else if (pred === GRAN_GEOCODE_PRECISION) {
        gd.precision = IRI_TO_GEOCODE_PRECISION[objVal];
      }
      return;
    }

    // ── Operating costs blank node ──
    if (opCostBuildingMap.has(bId)) {
      if (!opCostData.has(bId)) opCostData.set(bId, {});
      const oc = opCostData.get(bId)!;
      // Derived from the SAME table the serializer writes from (the field name
      // IS the predicate local name), so a field added to OPCOST_FIELDS
      // round-trips without touching this parser.
      if (pred.startsWith(BUILDING_NS)) {
        const key = pred.slice(
          BUILDING_NS.length,
        ) as (typeof OPCOST_FIELDS)[number];
        if ((OPCOST_FIELDS as readonly string[]).includes(key)) {
          oc[key] = localName(objVal);
        }
      }
      return;
    }

    // ── Certification blank node ──
    if (certBuildingMap.has(bId)) {
      if (!certData.has(bId)) certData.set(bId, {});
      const cd = certData.get(bId)!;
      if (pred === RDF_TYPE) {
        const ln = localName(objVal);
        if (ln.endsWith("Certification") && ln !== "BuildingCertification") {
          cd.type = ln.replace("Certification", "");
        }
      } else if (pred === `${BUILDING_NS}certificationLevel`) {
        cd.level = objVal;
      } else if (pred === `${BUILDING_NS}certificationScope`) {
        // The scope is written as a plain literal (like the level) — reading it
        // through localName() truncated any value containing '/' or '#'.
        cd.scope = objVal;
      }
      return;
    }

    // ── PROV qualified-attribution blank node (who produced the data) ──
    // Only the agent is read; a legacy `prov:hadRole` category is ignored (roles
    // live only in data rooms now).
    if (provBuildingMap.has(bId)) {
      if (!provData.has(bId)) provData.set(bId, {});
      const pd = provData.get(bId)!;
      if (pred === PROV_AGENT) {
        pd.agent = objVal;
      }
      return;
    }
  });

  // ── Attachment metadata: the file IRI is the subject (a NamedNode), so the two
  // passes above (named-building subjects / blank nodes) skip it. Gather the
  // schema.org / dcterms metadata for each known attachment IRI here. ──
  const attachmentData = new Map<
    string,
    { filename?: string; mediaType?: string; size?: number; uploadDate?: string }
  >();
  if (attachmentUriBuilding.size > 0) {
    quads.forEach((quad: Quad) => {
      if (quad.subject.termType !== "NamedNode") return;
      const uri = quad.subject.value;
      if (!attachmentUriBuilding.has(uri)) return;
      if (!attachmentData.has(uri)) attachmentData.set(uri, {});
      const ad = attachmentData.get(uri)!;
      const pred = quad.predicate.value;
      if (pred === SCHEMA_NAME) ad.filename = quad.object.value;
      else if (pred === SCHEMA_ENCODING_FORMAT) ad.mediaType = quad.object.value;
      else if (pred === SCHEMA_CONTENT_SIZE) {
        ad.size = parseInt(quad.object.value, 10);
      } else if (pred === DCTERMS_CREATED) ad.uploadDate = quad.object.value;
    });
  }

  // ── Technical-system nodes: each `<#pv>`/`<#battery>`/`<#chp>` NamedNode's props
  // (rdf:type + capacity/year/operatedBy/sameAs) hang off the node subject, which the
  // passes above skip. Gather them here; dispatch on rdf:type in post-processing. ──
  const systemData = new Map<string, SystemRaw>();
  if (systemNodeBuilding.size > 0) {
    quads.forEach((quad: Quad) => {
      if (quad.subject.termType !== "NamedNode") return;
      const node = quad.subject.value;
      if (!systemNodeBuilding.has(node)) return;
      if (!systemData.has(node)) systemData.set(node, {});
      const s = systemData.get(node)!;
      const pred = quad.predicate.value;
      const v = quad.object.value;
      if (pred === RDF_TYPE) s.type = v;
      else if (pred === RDFS_LABEL) s.label = v;
      else if (pred === `${BUILDING_NS}capacityKW`) s.capacityKW = parseFloat(v);
      else if (pred === `${BUILDING_NS}storageCapacityKWh`) {
        s.storageCapacityKWh = parseFloat(v);
      } else if (pred === `${BUILDING_NS}thermalCapacityKW`) {
        s.thermalCapacityKW = parseFloat(v);
      } else if (pred === `${BUILDING_NS}commissioningYear`) {
        s.commissioningYear = parseInt(v, 10);
      } else if (pred === `${REC_NS}operatedBy`) s.operatedBy = v;
      else if (pred === OWL_SAME_AS) s.sameAs = v;
    });
  }

  // ── LoD2 address nodes: the `<#lod2-address>` NamedNode's locn:* props hang off the
  // node subject (which the passes above skip). Gather them here; attach in post-processing. ──
  const lod2AddressData = new Map<string, NonNullable<Building["lod2Address"]>>();
  if (lod2AddressNodeBuilding.size > 0) {
    quads.forEach((quad: Quad) => {
      if (quad.subject.termType !== "NamedNode") return;
      const node = quad.subject.value;
      if (!lod2AddressNodeBuilding.has(node)) return;
      if (!lod2AddressData.has(node)) lod2AddressData.set(node, {});
      const a = lod2AddressData.get(node)!;
      const pred = quad.predicate.value;
      const v = quad.object.value;
      if (pred === LOCN_THOROUGHFARE) a.thoroughfare = v;
      else if (pred === LOCN_POST_NAME) a.postName = v;
      else if (pred === LOCN_ADMIN_UNIT_L1) a.adminUnitL1 = v;
      else if (pred === LOCN_FULL_ADDRESS) a.fullAddress = v;
    });
  }

  // ── Post-processing ────────────────────────────────────────────────────────

  // Unified energy model: derive dataset refs from the cons:hasEnergyDataset
  // links (no fetch — year comes from the time-first path; granularity/scenario
  // from the triples the building re-states about each dataset node).
  const linkStore = new Store(quads);
  for (const [buildingId, links] of energyDatasetLinks.entries()) {
    const building = buildings.get(buildingId);
    if (!building) continue;
    building.energyDatasets = links
      .map((uri) => parseDatasetLink(uri, linkStore))
      .filter((r): r is EnergyDatasetRef => r !== null);
  }

  // Operating costs
  for (const [blankId, buildingId] of opCostBuildingMap.entries()) {
    const building = buildings.get(buildingId);
    const oc = opCostData.get(blankId);
    if (building && oc) {
      building.operatingCosts = oc as InvestorOperatingCosts;
    }
  }

  // Certifications
  for (const [blankId, buildingId] of certBuildingMap.entries()) {
    const building = buildings.get(buildingId);
    const cd = certData.get(blankId);
    if (building && cd?.type) {
      building.certifications = building.certifications || [];
      (building.certifications as InvestorCertification[]).push({
        type: cd.type,
        certificationLevel: cd.level,
        certificationScope: cd.scope,
      });
    }
  }

  // Attachments (bldg:hasAttachment → file IRI + schema.org metadata). The energy
  // certificate (a real attachment also pointed at by bldg:hasEnergyCertificate) is
  // flagged.
  const certUriOf = (b: Building): string | undefined =>
    typeof b.energyCertificate === "string" && b.energyCertificate
      ? b.energyCertificate
      : undefined;
  for (const [buildingId, urls] of attachmentLinks.entries()) {
    const building = buildings.get(buildingId);
    if (!building) continue;
    const list = (building.attachments as AttachmentRef[] | undefined) ?? [];
    const certUri = certUriOf(building);
    for (const uri of urls) {
      const ad = attachmentData.get(uri) ?? {};
      list.push({
        uri,
        filename: ad.filename ?? decodeURIComponent(uri.split("/").pop() ?? uri),
        mediaType: ad.mediaType ?? "application/octet-stream",
        size: ad.size ?? 0,
        uploadDate: ad.uploadDate ?? "",
        ...(certUri === uri ? { isEnergyCertificate: true } : {}),
      });
    }
    building.attachments = list;
  }

  // Provenance (PROV qualified attribution) — the producing agent only.
  for (const [blankId, buildingId] of provBuildingMap.entries()) {
    const building = buildings.get(buildingId);
    const pd = provData.get(blankId);
    if (building && pd) {
      if (pd.agent) building.attributedTo = pd.agent;
    }
  }

  // Coordinates: read from the geo:Point blank node (the only place they live).
  for (const [blankId, buildingId] of geoPointBuildingMap.entries()) {
    const building = buildings.get(buildingId);
    const gd = geoData.get(blankId);
    if (building && gd) {
      if (gd.lat !== undefined && !Number.isNaN(gd.lat)) building.lat = gd.lat;
      if (gd.long !== undefined && !Number.isNaN(gd.long)) building.long = gd.long;
      if (gd.precision) building.geocodePrecision = gd.precision;
    }
  }

  // LoD2 address: attach the baked `locn:Address` node's parts, when any were read.
  for (const [node, buildingId] of lod2AddressNodeBuilding.entries()) {
    const building = buildings.get(buildingId);
    const a = lod2AddressData.get(node);
    if (building && a && Object.keys(a).length > 0) building.lod2Address = a;
  }

  // Technical-system nodes: collect each into the building's `systems` list, its kind
  // from rdf:type. An UNTYPED node defaults to PV (tolerates a legacy `<#pv>`); a KNOWN
  // type maps to its kind; an UNRECOGNISED type is SKIPPED rather than silently
  // masquerading as PV (IRI_TO_SYSTEM_KIND is the derived inverse of the ONE
  // Record<SystemKind, IRI> table the serializer types nodes from, so every
  // valid type maps and the two sides cannot drift).
  // The id is the node's hash fragment (the per-unit observation feature-of-interest);
  // each node carries only its own predicates, so the leftover props match TechnicalSystem.
  for (const [node, buildingId] of systemNodeBuilding.entries()) {
    const building = buildings.get(buildingId);
    if (!building) continue;
    const { type, ...props } = systemData.get(node) ?? {};
    const kind = type ? IRI_TO_SYSTEM_KIND[type] : "pv";
    if (!kind) continue; // typed with an unrecognised class → not a known system
    const id = node.split("#")[1] ?? node;
    (building.systems ??= []).push({ id, kind, ...props });
  }
  // Stable order (kind, then id) so the list/FoI options don't reshuffle per load.
  for (const building of buildings.values()) {
    building.systems?.sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
    );
  }

  return buildings;
}
