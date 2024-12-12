// parser.ts
import { loadTtl } from "../loader.ts";
import { parseBuildings } from "./buildingParser.ts";
import { parseAgents } from "./agentParser.ts";
import { parseEnergyData } from "./energyDataParser.ts";
import type { EnergyType } from "../../types/types.ts";
import { DataFactory, Store } from "n3";
import type { Quad } from "@rdfjs/types";

const { namedNode } = DataFactory;

export async function parseEnergyMeasurements() {
  const buildingsQuads = await loadTtl(
    "https://solid.ti.rw.fau.de/private/granergize/buildings.ttl",
    `${Deno.cwd()}/api/localData/buildings.ttl`
  );

  const agentsQuads = await loadTtl(
    "https://solid.ti.rw.fau.de/private/granergize/agents.ttl",
    `${Deno.cwd()}/api/localData/agents.ttl`
  );

  const buildings = parseBuildings(buildingsQuads);
  const agents = parseAgents(agentsQuads);
  const energyData = new Map<number, EnergyType>();

  // Load energy data
  for (const [buildingId, _building] of buildings) {
    try {
      const energyQuads = await loadTtl(
        `https://solid.ti.rw.fau.de/private/granergize/data/2023/${buildingId}.ttl`,
        `${Deno.cwd()}/api/localData/data/2022/${buildingId}.ttl`
      );
      energyData.set(parseInt(buildingId), parseEnergyData(buildingId, energyQuads));
    } catch (error: unknown) {
      throw new Error(`Failed to load energy data for building ${buildingId}: ${error}`);
    }
  }

  return {
    buildings: Array.from(buildings.values()),
    agents: Array.from(agents.values()),
    energyNeed: Array.from(energyData.values()),
  };
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