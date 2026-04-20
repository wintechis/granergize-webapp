import type { Quad } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import type { EnergyType } from "../../../types/types.ts";
import { getPropertyCategory } from "./propertyUtils.ts";
import { RDF_TYPE, SOSA_NS, TIME_NS, USERVOC_NS } from "./vocabularies.ts";

const { namedNode } = DataFactory;

export function parseEnergyData(
  id: string,
  uri: string,
  quads: Quad[],
): EnergyType {
  const energyData: EnergyType = {
    id: parseInt(id),
    uri: uri,
    energyNeed: {},
    energyGeneration: {},
    energyStorage: {},
    energyDistribution: {},
    energyTransfer: {},
    energyUsage: {},
    environmentalFactor: {},
  };

  const store = new Store();
  store.addQuads(quads);

  // ── User-role: uservoc:EnergyConsumptionReading ──────────────────────────
  const userReadingQuads = store.getQuads(
    null,
    namedNode(RDF_TYPE),
    namedNode(`${USERVOC_NS}EnergyConsumptionReading`),
    null,
  ) as Quad[];

  if (userReadingQuads.length > 0) {
    const readings: Array<{ begin: string; value: number }> = [];

    userReadingQuads.forEach((obs) => {
      // sosa:hasResult - blank node - sosa:hasSimpleResult
      const resultQuads = store.getQuads(
        obs.subject,
        namedNode(`${SOSA_NS}hasResult`),
        null,
        null,
      );
      if (resultQuads.length === 0) return;

      const valueQuads = store.getQuads(
        resultQuads[0].object,
        namedNode(`${SOSA_NS}hasSimpleResult`),
        null,
        null,
      );
      if (valueQuads.length === 0) return;
      const value = parseFloat(valueQuads[0].object.value);

      // sosa:phenomenonTime - blank node - time:hasBeginning
      const timeQuads = store.getQuads(
        obs.subject,
        namedNode(`${SOSA_NS}phenomenonTime`),
        null,
        null,
      );
      if (timeQuads.length === 0) return;

      const beginQuads = store.getQuads(
        timeQuads[0].object,
        namedNode(`${TIME_NS}hasBeginning`),
        null,
        null,
      );
      if (beginQuads.length === 0) return;

      readings.push({ begin: beginQuads[0].object.value, value });
    });

    // Sort chronologically
    readings.sort((a, b) => a.begin.localeCompare(b.begin));
    energyData.timeSeries = { electricityConsumption: readings };
    return energyData;
  }

  // ── Dummy / Benchmark / Investor role: sosa:Observation ─────────────────
  const observationQuads = store.getQuads(
    null,
    namedNode(RDF_TYPE),
    namedNode(`${SOSA_NS}Observation`),
    null,
  ) as Quad[];

  observationQuads.forEach((obs) => {
    const propertyQuads = store.getQuads(
      obs.subject,
      namedNode(`${SOSA_NS}observedProperty`),
      null,
      null,
    );
    if (propertyQuads.length === 0) return;

    const property = propertyQuads[0].object.value
      .split("#")[1]
      .replace(/^[A-Z]/, (c: string) => c.toLowerCase());

    const resultQuads = store.getQuads(
      obs.subject,
      namedNode(`${SOSA_NS}hasResult`),
      null,
      null,
    );
    if (resultQuads.length === 0) return;

    const valueQuads = store.getQuads(
      resultQuads[0].object,
      namedNode(`${SOSA_NS}hasSimpleResult`),
      null,
      null,
    );
    if (valueQuads.length === 0) return;

    const value = parseFloat(valueQuads[0].object.value);
    const category = getPropertyCategory(property);
    if (category && property) {
      energyData[category][property] = value;
    }
  });

  return energyData;
}
