// util/parser.ts
import type { Dataset, Quad } from "@rdfjs/types";
import { loadTtl } from "../loader.ts";
import { DataFactory, Store } from "n3";
import type { AgentType, BuildingType, EnergyType } from "../../types/types.ts";

const { namedNode } = DataFactory;

export async function parseEnergyMeasurements() {
  const buildingsQuads = await loadTtl("https://solid.ti.rw.fau.de/private/granergize/buildings.ttl",
    `${Deno.cwd()}/api/localData/buildings.ttl`
  );
  const agentsQuads = await loadTtl("https://solid.ti.rw.fau.de/private/granergize/agents.ttl",
    `${Deno.cwd()}/api/localData/agents.ttl`
  );
  
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
      const energyQuads = await loadTtl(`https://solid.ti.rw.fau.de/private/granergize/data/2023/${buildingId}.ttl`,
        `${Deno.cwd()}/api/localData/data/2022/${buildingId}.ttl`
      );
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
    "energyNeed": {},
    "energyGeneration": {},
    "energyStorage": {},
    "energyDistribution": {},
    "energyTransfer": {},
    "energyUsage": {},
    "environmentalFactor": {},
  };

  const store: Dataset = new Store();
  store.addAll(quads);

  // Find all observation quads
  const observationQuads = store.match(
    null, 
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), 
    namedNode('http://www.w3.org/ns/sosa/Observation')
  );

  // Process each group of observations
 observationQuads.forEach((obs) => {
    // Get observed property
    const propertyQuads = store.match(
        obs.subject, 
        namedNode('http://www.w3.org/ns/sosa/observedProperty'),
        null
    ).toArray();

    if (propertyQuads.length > 0) {
      // replace first letter with lower case to match the property name
        const property = propertyQuads[0].object.value.split('#')[1].replace(/^[A-Z]/, (c) => c.toLowerCase());

        // Get result
        const resultQuads = store.match(
            obs.subject, 
            namedNode('http://www.w3.org/ns/sosa/hasResult'), 
            null
        ).toArray();

        if (resultQuads.length > 0) {
            const resultNode = resultQuads[0].object;
            
            // Get simple result
            const valueQuads = store.match(
                resultNode, 
                namedNode('http://www.w3.org/ns/sosa/hasSimpleResult'), 
                null
            ).toArray();

            
        if (valueQuads.length > 0) {
          const value = parseFloat(valueQuads[0].object.value);


          // Get the category for the observed property
          const category = getPropertyCategory(property);

          // Save the result
          if (category && property) {
            energyData[category as keyof EnergyType][property] = value;
          }
        }
      }
    }
  });

  return energyData;
}


function getPropertyCategory(property: string): string {
  const energyNeedProperties = [
    "gas", "electricity", "gridSupply", "solar", "solarSpaceHeating", "photovoltaic", "selfConsumption",
    "gridFeedIn", "hallHeatingFromWasteLoss", "frostProtectionHbwFromWasteLoss",
    "ambientHeat", "ventilationHeat", "personHeat", "groundwater", "woodChips"
  ];

  const energyGenerationProperties = [
    "hallLighting", "heatGeneration", "hbwHeat", "hallHeat"
  ];

  const energyStorageProperties = [
    "forklistBatteryCharging", "heatStorage"
  ];

  const energyDistributionProperties = [
    "heatDistribution", "intralogisticsHallDistribution", "intralogisticsHbwDistribution",
    "hallHeatDistribution", "hbwHeatDistribution"
  ];

  const energyTransferProperties = [
    "intralogisticsHallTransfer", "intralogisticsHbwTransfer", "hallHeatTransfer",
    "hbwHeatTransfer", "heatTransfer", "forkliftTransfer"
  ];

  const energyUsageProperties = [
    "hallSpaceHeating", "work", "hbwFrostProtection"
  ];

  const environmentalFactorProperties = [
    "cold"
  ];

  if (energyNeedProperties.includes(property)) {
    return "energyNeed";
  } else if (energyGenerationProperties.includes(property)) {
    return "energyGeneration";
  } else if (energyStorageProperties.includes(property)) {
    return "energyStorage";
  } else if (energyDistributionProperties.includes(property)) {
    return "energyDistribution";
  } else if (energyTransferProperties.includes(property)) {
    return "energyTransfer";
  } else if (energyUsageProperties.includes(property)) {
    return "energyUsage";
  } else if (environmentalFactorProperties.includes(property)) {
    return "environmentalFactor";
  } else {
    throw new Error(`Unknown property: ${property}`);
  }
}

export async function parseEnergyMix() {
  const energyConsumptionQuads = await loadTtl("https://solid.ti.rw.fau.de/private/granergize/data/2023/districtsEnergyConsumption.ttl",
    `${Deno.cwd()}/api/localData/data/2022/districtsEnergyConsumption.ttl`
  );
  const energyProductionQuads = await loadTtl("https://solid.ti.rw.fau.de/private/granergize/data/2023/districtsEnergyProduction.ttl",
    `${Deno.cwd()}/api/localData/data/2022/districtsEnergyProduction.ttl`);

  const energyConsumption = {} as Record<string, {value: number, renewableEnergyShare: number}>;
  const energyProduction = {} as Record<string, {hydroShare: number, windShare: number, solarShare: number, biomassShare: number, geothermalShare: number, hydroProduction: number, windProduction: number, solarProduction: number, biomassProduction: number, geothermalProduction: number, totalRenewableProduction: number}>;

  const consumptionStore = new Store();
  consumptionStore.addAll(energyConsumptionQuads);
  const consumptionQuads = consumptionStore.match(null, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#electricityConsumption'), null);
  consumptionQuads.forEach((quad: Quad) => {
    const cityUrl = quad.subject.value;
    const cityId = cityUrl.substring(cityUrl.lastIndexOf('/') + 1);;
    const value = parseFloat(consumptionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#value'), null).toArray()[0].object.value);
    const renewableEnergyShare = parseFloat(consumptionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyShare'), null).toArray()[0].object.value);
    energyConsumption[cityId] = {value, renewableEnergyShare};
  });

  const productionStore = new Store();
  productionStore.addAll(energyProductionQuads);
  const productionQuads = productionStore.match(null, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyProduction'), null);
  productionQuads.forEach((quad: Quad) => {
    const cityUrl = quad.subject.value;
    const cityId = cityUrl.substring(cityUrl.lastIndexOf('/') + 1);
    const hydroShare = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroShare'), null).toArray()[0].object.value);
    const windShare = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windShare'), null).toArray()[0].object.value);
    const solarShare = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarShare'), null).toArray()[0].object.value);
    const biomassShare = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassShare'), null).toArray()[0].object.value);
    const geothermalShare = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalShare'), null).toArray()[0].object.value);
    const hydroProduction = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroProduction'), null).toArray()[0].object.value);
    const windProduction = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windProduction'), null).toArray()[0].object.value);
    const solarProduction = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarProduction'), null).toArray()[0].object.value);
    const biomassProduction = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassProduction'), null).toArray()[0].object.value);
    const geothermalProduction = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalProduction'), null).toArray()[0].object.value);
    const totalRenewableProduction = parseFloat(productionStore.match(quad.object, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#totalRenewableProduction'), null).toArray()[0].object.value);
    energyProduction[cityId] = {hydroShare, windShare, solarShare, biomassShare, geothermalShare, hydroProduction, windProduction, solarProduction, biomassProduction, geothermalProduction, totalRenewableProduction};
  });

  return {
    energyConsumption: energyConsumption,
    energyProduction: energyProduction,
  };
}
