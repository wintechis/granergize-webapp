import { loadTtl } from "../loader.ts";
import { DataFactory, Store, Term } from "n3";
import type { Quad } from "@rdfjs/types";

const { namedNode } = DataFactory;

export async function parseEnergyMix() {
  const energyConsumptionQuads = await loadTtl(null,
    `${Deno.cwd()}/api/localData/data/2022/districtsEnergyConsumption.ttl`
  );
  const energyProductionQuads = await loadTtl(null,
    `${Deno.cwd()}/api/localData/data/2022/districtsEnergyProduction.ttl`);

  const energyConsumption = {} as Record<string, {value: number, renewableEnergyShare: number}>;
  const energyProduction = {} as Record<string, {hydroShare: number, windShare: number, solarShare: number, biomassShare: number, geothermalShare: number, hydroProduction: number, windProduction: number, solarProduction: number, biomassProduction: number, geothermalProduction: number, totalRenewableProduction: number}>;

  const consumptionStore = new Store();
  consumptionStore.addAll(energyConsumptionQuads);
  const consumptionQuads = consumptionStore.match(null, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#electricityConsumption'), null);
  consumptionQuads.forEach((quad: Quad) => {
    const cityUrl = quad.subject.value;
    const cityId = cityUrl.substring(cityUrl.lastIndexOf('/') + 1);
    const value = parseFloat(consumptionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#value'), null).toArray()[0].object.value);
    const renewableEnergyShare = parseFloat(consumptionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyShare'), null).toArray()[0].object.value);
    energyConsumption[cityId] = {value, renewableEnergyShare};
  });

  const productionStore = new Store();
  productionStore.addAll(energyProductionQuads);
  const productionQuads = productionStore.match(null, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyProduction'), null);
  productionQuads.forEach((quad: Quad) => {
    const cityUrl = quad.subject.value;
    const cityId = cityUrl.substring(cityUrl.lastIndexOf('/') + 1);
    const hydroShare = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroShare'), null).toArray()[0].object.value);
    const windShare = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windShare'), null).toArray()[0].object.value);
    const solarShare = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarShare'), null).toArray()[0].object.value);
    const biomassShare = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassShare'), null).toArray()[0].object.value);
    const geothermalShare = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalShare'), null).toArray()[0].object.value);
    const hydroProduction = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroProduction'), null).toArray()[0].object.value);
    const windProduction = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windProduction'), null).toArray()[0].object.value);
    const solarProduction = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarProduction'), null).toArray()[0].object.value);
    const biomassProduction = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassProduction'), null).toArray()[0].object.value);
    const geothermalProduction = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalProduction'), null).toArray()[0].object.value);
    const totalRenewableProduction = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#totalRenewableProduction'), null).toArray()[0].object.value);
    energyProduction[cityId] = {hydroShare, windShare, solarShare, biomassShare, geothermalShare, hydroProduction, windProduction, solarProduction, biomassProduction, geothermalProduction, totalRenewableProduction};
  });

  return {
    energyConsumption: energyConsumption,
    energyProduction: energyProduction,
  };
}