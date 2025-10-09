import type { Quad } from "@rdfjs/types";
import type { BuildingType, EnergyMeasurementData } from "../../../types/types.ts";
import { predicateMap, parsingFunctions } from "./config/buildingConfig.ts";

export function parseBuildings(quads: Quad[]): Map<string, BuildingType> {
  const buildings = new Map<string, BuildingType>();
  const blankNodeMap = new Map<string, string>(); // Maps blank node IDs to building IDs


  // First pass: Create buildings and map blank nodes to buildings
  quads.forEach((quad: Quad) => {
    // Skip blank nodes as subjects in the first pass
    if (quad.subject.termType === 'BlankNode') return;

    const buildingId = quad.subject.value.split("#")[1];
    const uri = quad.graph.value;

    if (!buildings.has(buildingId)) {
      buildings.set(buildingId, {
        id: parseInt(buildingId),
        uri: uri,
        type: "https://w3id.org/rec#building",
        energyData: [] // Add array to store energy data
      });
    }

    const building = buildings.get(buildingId)!;
    const pred = quad.predicate.value;
    const obj = quad.object;

    // Handle hasEnergyMeasurementData predicate specifically
    if (pred.endsWith('hasEnergyMeasurementData')) {
      if (obj.termType === 'BlankNode') {
        // Map this blank node to the current building
        blankNodeMap.set(obj.value, buildingId);
      }
      return; // Skip normal property assignment for blank nodes
    }

    // Regular property handling (as before)
    if (Object.prototype.hasOwnProperty.call(predicateMap, pred)) {
      const propertyName = predicateMap[pred];
      const parseFn = parsingFunctions[propertyName];

      if (parseFn) {
        building[propertyName] = parseFn(obj.value);
      } else {
        building[propertyName] = obj.value;
      }
    }
  });

  // Second pass: Process blank node data
  const energyDataMap = new Map<string, Partial<EnergyMeasurementData>>();
  
  quads.forEach((quad: Quad) => {
    if (quad.subject.termType === 'BlankNode') {
      const blankNodeId = quad.subject.value;
      const buildingId = blankNodeMap.get(blankNodeId);
      
      if (!buildingId) return; // Skip if not related to a building
      
      // Initialize energy data object for this blank node if not exists
      if (!energyDataMap.has(blankNodeId)) {
        energyDataMap.set(blankNodeId, {});
      }
      
      const energyData = energyDataMap.get(blankNodeId)!;
      const pred = quad.predicate.value;
      const objValue = quad.object.value;
      const baseUri = quad.graph.value
      
      // Parse blank node predicates
      if (pred.endsWith('measurementYear')) {
        energyData.year = parseInt(objValue);
      } else if (pred.endsWith('datasetLocation')) {
        // Convert relative path to absolute URI if needed
        if (objValue.startsWith('./')) {
          // Remove './' prefix and construct full URI
          const relativePath = objValue.substring(2);
          energyData.location = `${baseUri}${relativePath}`;
        } else if (objValue.startsWith('/')) {
          // Handle absolute path within domain
          energyData.location = `${baseUri.replace(/\/$/, '')}${objValue}`;
        } else if (!objValue.match(/^https?:\/\//)) {
          // Handle any other non-URL format
          energyData.location = `${baseUri}${objValue}`;
        } else {
          // Already a full URL
          energyData.location = objValue;
        }
      } else if (pred.endsWith('type')) {
        energyData.type = objValue;
      }
    }
  });
  
  // Add energy data to respective buildings
  for (const [blankNodeId, buildingId] of blankNodeMap.entries()) {
    const building = buildings.get(buildingId);
    const energyData = energyDataMap.get(blankNodeId);
    
    if (building && energyData && energyData.year && energyData.location && energyData.type) {
      building.energyData = building.energyData || [];
      building.energyData.push({
        year: energyData.year,
        location: energyData.location,
        type: energyData.type
      });
    }
  }

  return buildings;
}