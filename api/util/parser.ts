// util/parser.ts
import type { Quad } from "@rdfjs/types";
import { loadTTLFile } from "../loader.ts";
import type { AgentType, BuildingType, EnergyType } from "../../types/types.ts";

export async function parseRDFData() {
  const buildingsQuads = await loadTTLFile("https://solid.ti.rw.fau.de/private/granergize/buildings.ttl");
  const agentsQuads = await loadTTLFile("https://solid.ti.rw.fau.de/private/granergize/agents.ttl");
  
  const buildings = new Map<string, BuildingType>();
  const agents = new Map<string, AgentType>();
  const energyData = new Map<number, EnergyType>();

  // Parse agents
  agentsQuads.forEach((quad: Quad) => {
    if (quad.predicate.value === "https://schema.org/name") {
      const id = quad.subject.value.split("#")[1];
      agents.set(id, {
        id,
        type: "https://w3id.org/rec#agent",
        name: quad.object.value,
      });
    }
  });

  // Parse buildings
  buildingsQuads.forEach((quad: Quad) => {
    const buildingId = quad.subject.value.split("#")[1];
    if (!buildings.has(buildingId)) {
      buildings.set(buildingId, {
        id: parseInt(buildingId),
        type: "https://w3id.org/rec#building",
      } as BuildingType);
    }

    const building = buildings.get(buildingId)!;
    const pred = quad.predicate.value;
    const obj = quad.object.value;

    switch (pred) {
      case "http://schema.org/customer":
        building.customer = obj;
        break;
      case "http://www.w3.org/2003/01/geo/wgs84_pos#lat":
        building.lat = parseFloat(obj);
        break;
      case "http://www.w3.org/2003/01/geo/wgs84_pos#long":
        building.long = parseFloat(obj);
        break;
      case "http://www.w3.org/2006/vcard/ns#locality":
        building.locality = obj;
        break;
      case "http://www.w3.org/2006/vcard/ns#postal-code":
        building["postal code"] = parseInt(obj);
        break;
      case "http://www.w3.org/2006/vcard/ns#region":
        building.region = obj;
        break;
      case "http://www.w3.org/2006/vcard/ns#street-address":
        building["street address"] = obj;
        break;
      case "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasBuildingArea":
        building["building area"] = parseInt(obj);
        break;
      case "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasLandArea":
        building["land area"] = parseInt(obj);
        break;
      case "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasPVSystem":
        building["has pv system"] = obj.toLowerCase() === "true";
        break;
      case "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#investor":
        building.investor = obj;
        break;
      case "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#officeArea":
        building["office area"] = parseInt(obj);
        break;
      case "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#usedAs":
        building["used as"] = obj;
        break;
      case "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#yearOfConstruction":
        building["year of construction"] = parseInt(obj);
        break;
      case "https://w3id.org/rec#nace-code":
        building["nace code"] = parseFloat(obj);
        break;
      case "https://w3id.org/rec#operatedBy":
        building["operated by"] = obj;
        break;
    }
  });

  // Load energy data
  for (const [buildingId, _building] of buildings) {
    try {
      const energyQuads = await loadTTLFile(`https://solid.ti.rw.fau.de/private/granergize/data/2024/${buildingId}.ttl`);
      energyData.set(parseInt(buildingId), parseEnergyData(buildingId, energyQuads));
    } catch (error: unknown) {
      throw new Error(`Failed to load energy data for building ${buildingId}:
        ${error}`);
    }
  }

  return {
    buildings: Array.from(buildings.values()),
    agents: Array.from(agents.values()),
    energyNeed: Array.from(energyData.values()),
  };
}

function parseEnergyData(id: string, quads: Array<Quad>): EnergyType {

  const energyData: EnergyType = {
    id: parseInt(id),
    "energy need": {},
    "energy generation": {},
    "energy storage": {},
    "energy distribution": {},
    "energy transfer": {},
    "energy usage": {},
    "environmental factor": {},
  };

  quads.forEach((quad) => {

    const pred = quad.predicate.value;

    // Handle different energy categories
    if (pred.includes('hasEnergyNeed')) {
      // Get the energy type from the blank node
      const blankNode = quad.object;
      const typeQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('type')
      );
      const amountQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('energyAmount')
      );

      if (typeQuad && amountQuad) {
        const type = typeQuad.object.value.split('#')[1].toLowerCase();
        const amount = parseFloat(amountQuad.object.value);
        energyData["energy need"][type] = amount;
      }
    }
    else if (pred.includes('hasEnergyGeneration')) {
      const blankNode = quad.object;
      const typeQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('type')
      );
      const amountQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('energyAmount')
      );

      if (typeQuad && amountQuad) {
        const type = typeQuad.object.value.split('#')[1].toLowerCase();
        const amount = parseFloat(amountQuad.object.value);
        energyData["energy generation"][type] = amount;
      }
    }
    else if (pred.includes('hasEnergyStorage')) {
      const blankNode = quad.object;
      const typeQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('type')
      );
      const amountQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('energyAmount')
      );

      if (typeQuad && amountQuad) {
        const type = typeQuad.object.value.split('#')[1].toLowerCase();
        const amount = parseFloat(amountQuad.object.value);
        energyData["energy storage"][type] = amount;
      }
    }
    else if (pred.includes('hasEnergyDistribution')) {
      const blankNode = quad.object;
      const typeQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('type')
      );
      const amountQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('energyAmount')
      );

      if (typeQuad && amountQuad) {
        const type = typeQuad.object.value.split('#')[1].toLowerCase();
        const amount = parseFloat(amountQuad.object.value);
        energyData["energy distribution"][type] = amount;
      }
    }
    else if (pred.includes('hasEnergyTransfer')) {
      const blankNode = quad.object;
      const typeQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('type')
      );
      const amountQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('energyAmount')
      );

      if (typeQuad && amountQuad) {
        const type = typeQuad.object.value.split('#')[1].toLowerCase();
        const amount = parseFloat(amountQuad.object.value);
        energyData["energy transfer"][type] = amount;
      }
    }
    else if (pred.includes('hasEnergyUsage')) {
      const blankNode = quad.object;
      const typeQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('type')
      );
      const amountQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('energyAmount')
      );

      if (typeQuad && amountQuad) {
        const type = typeQuad.object.value.split('#')[1].toLowerCase();
        const amount = parseFloat(amountQuad.object.value);
        energyData["energy usage"][type] = amount;
      }
    }
    else if (pred.includes('hasEnvironmentalFactor')) {
      const blankNode = quad.object;
      const typeQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('type')
      );
      const tempQuad = quads.find(q => 
        q.subject.equals(blankNode) && 
        q.predicate.value.includes('temperature')
      );

      if (typeQuad && tempQuad) {
        const type = typeQuad.object.value.split('#')[1].toLowerCase();
        const amount = parseFloat(tempQuad.object.value);
        energyData["environmental factor"][type] = amount;
      }
    }
  });

  return energyData;
}