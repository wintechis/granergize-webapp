import type { Quad } from "@rdfjs/types";
import type {
  AttachmentRef,
  BuildingType,
  EnergyDatasetRef,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../../types.ts";
import {
  investorLocalNameLabels,
  iriPropertyMap,
  objectPropertyMap,
  parsingFunctions,
  predicateMap,
} from "./config/buildingConfig.ts";
import {
  DCTERMS_CREATED,
  GEO_LAT,
  GEO_LOCATION,
  GEO_LONG,
  GRAN_GEOCODE_PRECISION,
  GRAN_HAS_ATTACHMENT,
  GRAN_NS,
  INVESTOR_NS,
  IRI_TO_GEOCODE_PRECISION,
  PROV_AGENT,
  PROV_HAD_ROLE,
  PROV_QUALIFIED_ATTRIBUTION,
  RDF_TYPE,
  REC_BUILDING,
  SCHEMA_CONTENT_SIZE,
  SCHEMA_ENCODING_FORMAT,
  SCHEMA_NAME,
} from "./vocabularies.ts";
import { parseDatasetSlug } from "./energyDataset.ts";
import { IRI_TO_PROVENANCE } from "../../constants/roles.ts";

/**
 * Extract building ID from a NamedNode IRI using *strict* patterns.
 *
 * Keep this strict because we use it during building creation (Pass 1) and
 * we don't want to accidentally treat arbitrary named nodes as buildings.
 */
function hashIri(iri: string): string {
  let h = 0;
  for (let i = 0; i < iri.length; i++) {
    h = (Math.imul(31, h) + iri.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function extractBuildingIdStrict(iri: string): string | null {
  const fragment = iri.split("#")[1];
  if (fragment) {
    const id = fragment.replace(/^building-/, "");
    // Generic fragment names (e.g. "building1") are not unique across files.
    // Incorporate the document URL to avoid collisions when multiple files use the same fragment.
    if (/^building\d*$/.test(id)) {
      return `${id}_${hashIri(iri.split("#")[0])}`;
    }
    return id;
  }

  // Canonical pattern: .../buildings/<id>
  const canonicalMatch = iri.match(/\/buildings\/([^/#]+)$/);
  if (canonicalMatch) {
    return canonicalMatch[1];
  }

  // Investor file/subject patterns: .../building-<id> or .../building-<id>.ttl
  const investorMatch = iri.match(/\/building-([^/#]+?)(?:\.ttl)?$/);
  if (investorMatch) {
    return investorMatch[1];
  }

  return null;
}

/** Get the local name (after # or last /) from an IRI */
function localName(iri: string): string {
  const hash = iri.split("#")[1];
  if (hash) return hash;
  const parts = iri.split("/");
  return parts[parts.length - 1];
}

export function parseBuildings(quads: Quad[]): Map<string, BuildingType> {
  const buildings = new Map<string, BuildingType>();
  /** building ID → its `gran:hasEnergyDataset` link URLs (unified energy model). */
  const energyDatasetLinks = new Map<string, string[]>();
  /** blank node ID - building ID for operating costs */
  const opCostBuildingMap = new Map<string, string>();
  /** blank node ID - building ID for certifications */
  const certBuildingMap = new Map<string, string>();
  /** blank node ID - building ID for the PROV qualified attribution */
  const provBuildingMap = new Map<string, string>();
  /** blank node ID - building ID for the geo:Point (coordinates + precision) */
  const geoPointBuildingMap = new Map<string, string>();
  /** building ID → its gran:hasAttachment file URLs */
  const attachmentLinks = new Map<string, string[]>();
  /** attachment file URL → building ID (the file IRI is the metadata subject) */
  const attachmentUrlBuilding = new Map<string, string>();

  // ── Pass 1: Create buildings from named-node subjects ─────────────────────
  quads.forEach((quad: Quad) => {
    if (quad.subject.termType === "BlankNode") return;

    const buildingId = extractBuildingIdStrict(quad.subject.value);
    if (!buildingId) return;

    if (!buildings.has(buildingId)) {
      const numericId = /^\d+$/.test(buildingId)
        ? parseInt(buildingId)
        : buildingId
          .split("")
          .reduce(
            (h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0,
            0,
          ) >>> 0;
      buildings.set(buildingId, {
        id: numericId,
        // Use the RDF subject as the building URI so it links correctly with observations.
        // Store the source file URL separately for ownership checks.
        uri: quad.subject.value,
        sourceUri: quad.graph.value,
        type: REC_BUILDING,
        certifications: [],
      });
    }

    const building = buildings.get(buildingId)!;
    const pred = quad.predicate.value;
    const obj = quad.object;

    // Unified energy model: gran:hasEnergyDataset links (one per dataset
    // resource). The slug is self-describing, so refs are derived in post-processing.
    if (pred === `${GRAN_NS}hasEnergyDataset`) {
      if (obj.termType === "NamedNode") {
        const links = energyDatasetLinks.get(buildingId) ?? [];
        links.push(obj.value);
        energyDatasetLinks.set(buildingId, links);
      }
      return;
    }

    // Building file attachments: gran:hasAttachment → a file IRI. The file IRI is
    // itself the subject of the schema.org media metadata, collected separately
    // below (NamedNode subject, so both passes otherwise skip it).
    if (pred === GRAN_HAS_ATTACHMENT) {
      if (obj.termType === "NamedNode") {
        const links = attachmentLinks.get(buildingId) ?? [];
        links.push(obj.value);
        attachmentLinks.set(buildingId, links);
        attachmentUrlBuilding.set(obj.value, buildingId);
      }
      return;
    }

    // Investor operating costs blank-node
    if (pred === `${INVESTOR_NS}hasOperatingCosts`) {
      if (obj.termType === "BlankNode") {
        opCostBuildingMap.set(obj.value, buildingId);
      }
      return;
    }

    // Investor certification blank-node
    if (pred === `${INVESTOR_NS}hasBuildingCertification`) {
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

    // Object properties mapping to local-name labels (shiftRegime, tenancyType, etc.)
    if (
      obj.termType === "NamedNode" &&
      Object.prototype.hasOwnProperty.call(objectPropertyMap, pred)
    ) {
      const propertyName = objectPropertyMap[pred];
      const ln = localName(obj.value);
      building[propertyName] = investorLocalNameLabels[ln] ?? ln;
      return;
    }

    // Agent/IRI-reference properties (e.g. operatedBy → a WebID). The object is a
    // NamedNode; tolerate a legacy xsd:string literal (old Pods stored operatedBy
    // as a string) — obj.value yields the IRI/text either way.
    if (Object.prototype.hasOwnProperty.call(iriPropertyMap, pred)) {
      building[iriPropertyMap[pred]] = obj.value;
      return;
    }

    // Regular datatype properties
    if (Object.prototype.hasOwnProperty.call(predicateMap, pred)) {
      const propertyName = predicateMap[pred];
      const parseFn = parsingFunctions[propertyName as string];
      if (parseFn) {
        building[propertyName] = parseFn(obj.value);
      } else {
        building[propertyName] = obj.value;
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
    { agent?: string; category?: BuildingType["provenance"] }
  >();
  const geoData = new Map<
    string,
    { lat?: number; long?: number; precision?: BuildingType["geocodePrecision"] }
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
      const ln = localName(objVal);
      if (pred === `${INVESTOR_NS}wasteDisposal`) {
        oc.wasteDisposal = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}insurance`) {
        oc.insurance = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}operationInspectionAndMaintenance`) {
        oc.operationInspectionAndMaintenance = objVal.toLowerCase() === "true";
      } else if (pred === `${INVESTOR_NS}routineCleaningOffice`) {
        oc.routineCleaningOffice = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}routineCleaningWarehouse`) {
        oc.routineCleaningWarehouse = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}glassCleaning`) {
        oc.glassCleaning = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}exteriorMaintenance`) {
        oc.exteriorMaintenance = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}security`) {
        oc.security = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}propertyManagement`) {
        oc.propertyManagement = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}caretaker`) {
        oc.caretaker = investorLocalNameLabels[ln] ?? ln;
      } else if (pred === `${INVESTOR_NS}repairAndMaintenance`) {
        oc.repairAndMaintenance = investorLocalNameLabels[ln] ?? ln;
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
      } else if (pred === `${INVESTOR_NS}certificationLevel`) {
        cd.level = objVal;
      } else if (pred === `${INVESTOR_NS}certificationScope`) {
        cd.scope = localName(objVal);
      }
      return;
    }

    // ── PROV qualified-attribution blank node (provenance) ──
    if (provBuildingMap.has(bId)) {
      if (!provData.has(bId)) provData.set(bId, {});
      const pd = provData.get(bId)!;
      if (pred === PROV_AGENT) {
        pd.agent = objVal;
      } else if (pred === PROV_HAD_ROLE) {
        pd.category = IRI_TO_PROVENANCE[objVal];
      }
      return;
    }
  });

  // ── Attachment metadata: the file IRI is the subject (a NamedNode), so the two
  // passes above (named-building subjects / blank nodes) skip it. Gather the
  // schema.org / dcterms metadata for each known attachment URL here. ──
  const attachmentData = new Map<
    string,
    { filename?: string; mediaType?: string; size?: number; uploadDate?: string }
  >();
  if (attachmentUrlBuilding.size > 0) {
    quads.forEach((quad: Quad) => {
      if (quad.subject.termType !== "NamedNode") return;
      const url = quad.subject.value;
      if (!attachmentUrlBuilding.has(url)) return;
      if (!attachmentData.has(url)) attachmentData.set(url, {});
      const ad = attachmentData.get(url)!;
      const pred = quad.predicate.value;
      if (pred === SCHEMA_NAME) ad.filename = quad.object.value;
      else if (pred === SCHEMA_ENCODING_FORMAT) ad.mediaType = quad.object.value;
      else if (pred === SCHEMA_CONTENT_SIZE) {
        ad.size = parseInt(quad.object.value, 10);
      } else if (pred === DCTERMS_CREATED) ad.uploadDate = quad.object.value;
    });
  }

  // ── Post-processing ────────────────────────────────────────────────────────

  // Unified energy model: derive dataset refs from the gran:hasEnergyDataset
  // link slugs (no fetch — year/granularity/scenario come from the slug).
  for (const [buildingId, links] of energyDatasetLinks.entries()) {
    const building = buildings.get(buildingId);
    if (!building) continue;
    building.energyDatasets = links
      .map((url) => parseDatasetSlug(url))
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
        level: cd.level,
        scope: cd.scope,
      });
    }
  }

  // Attachments (gran:hasAttachment → file IRI + schema.org metadata). The energy
  // certificate is flagged. A legacy cert linked only via gran:hasEnergyCertificate
  // (no gran:hasAttachment — e.g. still in the old shared certificates/ folder) is
  // synthesized below so it still lists.
  const certUrlOf = (b: BuildingType): string | undefined =>
    typeof b.energyCertificate === "string" && b.energyCertificate
      ? b.energyCertificate
      : undefined;
  for (const [buildingId, urls] of attachmentLinks.entries()) {
    const building = buildings.get(buildingId);
    if (!building) continue;
    const list = (building.attachments as AttachmentRef[] | undefined) ?? [];
    const certUrl = certUrlOf(building);
    for (const url of urls) {
      const ad = attachmentData.get(url) ?? {};
      list.push({
        url,
        filename: ad.filename ?? decodeURIComponent(url.split("/").pop() ?? url),
        mediaType: ad.mediaType ?? "application/octet-stream",
        size: ad.size ?? 0,
        uploadDate: ad.uploadDate ?? "",
        ...(certUrl === url ? { isEnergyCertificate: true } : {}),
      });
    }
    building.attachments = list;
  }
  for (const building of buildings.values()) {
    const certUrl = certUrlOf(building);
    if (!certUrl) continue;
    const list = (building.attachments as AttachmentRef[] | undefined) ?? [];
    if (!list.some((a) => a.url === certUrl)) {
      list.push({
        url: certUrl,
        filename: decodeURIComponent(certUrl.split("/").pop() ?? certUrl),
        mediaType: "application/pdf",
        size: 0,
        uploadDate: "",
        isEnergyCertificate: true,
      });
      building.attachments = list;
    }
  }

  // Provenance (PROV qualified attribution)
  for (const [blankId, buildingId] of provBuildingMap.entries()) {
    const building = buildings.get(buildingId);
    const pd = provData.get(blankId);
    if (building && pd) {
      if (pd.category) building.provenance = pd.category;
      if (pd.agent) building.attributedTo = pd.agent;
    }
  }

  // Coordinates (geo:Point). Preferred over any legacy flat geo:lat/long read in
  // pass 1, so a building that carries both reflects the current point model.
  for (const [blankId, buildingId] of geoPointBuildingMap.entries()) {
    const building = buildings.get(buildingId);
    const gd = geoData.get(blankId);
    if (building && gd) {
      if (gd.lat !== undefined && !Number.isNaN(gd.lat)) building.lat = gd.lat;
      if (gd.long !== undefined && !Number.isNaN(gd.long)) building.long = gd.long;
      if (gd.precision) building.geocodePrecision = gd.precision;
    }
  }

  return buildings;
}
