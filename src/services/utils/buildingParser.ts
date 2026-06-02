import type { Quad } from "@rdfjs/types";
import type {
  BuildingType,
  EnergyMeasurementData,
  InvestorAnnualData,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../../../types/types.ts";
import {
  investorLocalNameLabels,
  objectPropertyMap,
  parsingFunctions,
  predicateMap,
} from "./config/buildingConfig.ts";
import {
  INVESTOR_NS,
  RDF_TYPE,
  SOSA_NS,
  SSN_NS,
  TIME_NS,
} from "./vocabularies.ts";

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

/**
 * Looser extraction used for joining observations (e.g. sosa:hasFeatureOfInterest).
 *
 * Some investor graphs use a second IRI for the same building, e.g.
 *   .../building-312  (rec:Building)
 *   .../312           (feature of interest)
 */
function extractBuildingIdForJoin(iri: string): string | null {
  const strict = extractBuildingIdStrict(iri);
  if (strict) return strict;

  // Common pattern: .../<numericId> (optionally with a trailing slash)
  const numericTail = iri.match(/\/(\d+)\/?$/);
  if (numericTail) return numericTail[1];

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
  /** building ID - blank node IDs that are energy measurement datasets (Dummy/Benchmark role) */
  const energyBlankNodeMap = new Map<string, string>();
  /** blank node ID - building ID for operating costs */
  const opCostBuildingMap = new Map<string, string>();
  /** blank node ID - building ID for certifications */
  const certBuildingMap = new Map<string, string>();

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
        type: "https://w3id.org/rec#Building",
        energyData: [],
        annualData: [],
        certifications: [],
      });
    }

    const building = buildings.get(buildingId)!;
    const pred = quad.predicate.value;
    const obj = quad.object;

    // Energy-dataset blank-node associations (Dummy/Benchmark role)
    if (
      pred.endsWith("hasEnergyMeasurementData") ||
      pred.endsWith("hasEnergyConsumptionDataset")
    ) {
      if (obj.termType === "BlankNode") {
        energyBlankNodeMap.set(obj.value, buildingId);
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

    // Investor annual-data dataset blank-node — just record association; observations
    // are linked directly to the building URI via sosa:hasFeatureOfInterest
    if (pred === `${INVESTOR_NS}hasInvestorAnnualData`) {
      return; // handled entirely in the SOSA observation pass
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

  const energyDataMap = new Map<string, Partial<EnergyMeasurementData>>();
  const opCostData = new Map<string, Partial<InvestorOperatingCosts>>();
  const certData = new Map<
    string,
    { type?: string; level?: string; scope?: string }
  >();

  interface ObsData {
    observedProperty?: string;
    featureOfInterest?: string;
    resultBlank?: string;
    timeBlank?: string;
  }
  const obsData = new Map<string, ObsData>();
  const resultData = new Map<string, { value?: number }>();
  const timeData = new Map<string, { beginning?: string }>();

  quads.forEach((quad: Quad) => {
    if (quad.subject.termType !== "BlankNode") return;

    const bId = quad.subject.value;
    const pred = quad.predicate.value;
    const obj = quad.object;
    const objVal = obj.value;

    // ── Energy measurement dataset (Dummy/Benchmark role) ──
    if (energyBlankNodeMap.has(bId)) {
      if (!energyDataMap.has(bId)) energyDataMap.set(bId, {});
      const ed = energyDataMap.get(bId)!;
      const baseUri = quad.graph.value;
      if (pred.endsWith("measurementYear")) {
        ed.year = parseInt(objVal);
      } else if (pred.endsWith("datasetDate")) {
        ed.year = parseInt(objVal.substring(0, 4));
      } else if (pred.endsWith("datasetLocation")) {
        if (objVal.startsWith("./")) {
          ed.location = `${baseUri}${objVal.substring(2)}`;
        } else if (objVal.startsWith("/")) {
          ed.location = `${baseUri.replace(/\/$/, "")}${objVal}`;
        } else if (!objVal.match(/^https?:\/\//)) {
          ed.location = `${baseUri}${objVal}`;
        } else {
          ed.location = objVal;
        }
      } else if (pred.endsWith("type")) {
        ed.type = objVal;
      } else if (pred.endsWith("granularity")) {
        ed.granularity = objVal;
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

    // ── SOSA Observation blank node ──
    if (
      pred === `${SOSA_NS}observedProperty` ||
      pred === `${SOSA_NS}hasFeatureOfInterest` ||
      pred === `${SOSA_NS}hasResult` ||
      pred === `${SOSA_NS}phenomenonTime`
    ) {
      if (!obsData.has(bId)) obsData.set(bId, {});
      const od = obsData.get(bId)!;
      if (pred === `${SOSA_NS}observedProperty`) od.observedProperty = objVal;
      else if (pred === `${SOSA_NS}hasFeatureOfInterest`) {
        od.featureOfInterest = objVal;
      } else if (
        pred === `${SOSA_NS}hasResult` && obj.termType === "BlankNode"
      ) {
        od.resultBlank = objVal;
      } else if (
        pred === `${SOSA_NS}phenomenonTime` &&
        obj.termType === "BlankNode"
      ) {
        od.timeBlank = objVal;
      }
      return;
    }

    // ── SOSA Result blank node ──
    if (pred === `${SOSA_NS}hasSimpleResult` || pred === `${SSN_NS}hasUnit`) {
      if (!resultData.has(bId)) resultData.set(bId, {});
      if (pred === `${SOSA_NS}hasSimpleResult`) {
        resultData.get(bId)!.value = parseFloat(objVal);
      }
      return;
    }

    // ── Time Interval blank node ──
    if (pred === `${TIME_NS}hasBeginning`) {
      if (!timeData.has(bId)) timeData.set(bId, {});
      timeData.get(bId)!.beginning = objVal;
      return;
    }
  });

  // ── Post-processing ────────────────────────────────────────────────────────

  // Energy measurement data (Dummy/Benchmark role)
  for (const [blankNodeId, buildingId] of energyBlankNodeMap.entries()) {
    const building = buildings.get(buildingId);
    const energyData = energyDataMap.get(blankNodeId);
    if (
      building &&
      energyData &&
      energyData.year &&
      energyData.location &&
      energyData.type
    ) {
      building.energyData = building.energyData || [];
      (building.energyData as EnergyMeasurementData[]).push({
        year: energyData.year,
        location: energyData.location,
        type: energyData.type,
        granularity: energyData.granularity,
      });
    }
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

  // Investor annual data from SOSA observations
  // Keep URI lookup for direct matches and fall back to ID extraction so
  // mixed URI styles (/buildings/<id> vs /granergize/building-<id>) still join.
  const uriBuildingIdMap = new Map<string, string>();
  for (const [id, b] of buildings.entries()) {
    uriBuildingIdMap.set(b.uri as string, id);
  }

  // Group observations by normalized buildingId + year
  const annualByKey = new Map<string, InvestorAnnualData>();

  for (const [, od] of obsData.entries()) {
    if (!od.featureOfInterest || !od.observedProperty) continue;

    const buildingId = uriBuildingIdMap.get(od.featureOfInterest) ||
      extractBuildingIdForJoin(od.featureOfInterest);
    if (!buildingId) continue;
    if (!buildings.has(buildingId)) continue;

    let year: number | undefined;
    if (od.timeBlank) {
      const td = timeData.get(od.timeBlank);
      if (td?.beginning) year = parseInt(td.beginning.substring(0, 4));
    }
    if (!year) continue;

    let value: number | undefined;
    if (od.resultBlank) {
      value = resultData.get(od.resultBlank)?.value;
    }
    if (value === undefined) continue;

    const key = `${buildingId}::${year}`;
    if (!annualByKey.has(key)) annualByKey.set(key, { year });
    const ann = annualByKey.get(key)!;

    const propLocal = localName(od.observedProperty);
    if (propLocal === "AnnualElectricityConsumption") {
      ann.electricityConsumption = value;
    } else if (propLocal === "RenewableSelfGeneratedShare") {
      ann.renewableSelfGeneratedShare = value;
    } else if (propLocal === "AnnualHeatConsumption") {
      ann.heatConsumption = value;
    } else if (propLocal === "AnnualWaterConsumption") {
      ann.waterConsumption = value;
    } else if (propLocal === "AnnualWastewaterConsumption") {
      ann.wastewaterConsumption = value;
    }
  }

  // Attach annual data to buildings, sorted by year
  for (const [key, ann] of annualByKey.entries()) {
    const buildingId = key.split("::")[0];
    const building = buildings.get(buildingId);
    if (!building) continue;
    building.annualData = building.annualData || [];
    (building.annualData as InvestorAnnualData[]).push(ann);
  }
  for (const building of buildings.values()) {
    const ad = building.annualData as InvestorAnnualData[] | undefined;
    if (ad && ad.length > 1) {
      ad.sort((a, b) => a.year - b.year);
    }
  }

  return buildings;
}
