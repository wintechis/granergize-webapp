import type { Quad } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import type { EnergyType } from "../../types/types.ts";
import { getPropertyCategory } from "./propertyUtils.ts";

const { namedNode } = DataFactory;

export function parseEnergyData(id: string, quads: Quad[]): EnergyType {
  const energyData: EnergyType = {
    id: parseInt(id),
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

  // Find all observations
  const observationQuads = store.getQuads(
    null,
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    namedNode('http://www.w3.org/ns/sosa/Observation'),
    null
  ) as Quad[];

  observationQuads.forEach((obs) => {
    // Get observed property
    const propertyQuads = store.getQuads(
      obs.subject,
      namedNode('http://www.w3.org/ns/sosa/observedProperty'),
      null,
      null
    );

    if (propertyQuads.length > 0) {
      const property = propertyQuads[0].object.value
        .split('#')[1]
        .replace(/^[A-Z]/, (c: string) => c.toLowerCase());

      // Get result
      const resultQuads = store.getQuads(
        obs.subject,
        namedNode('http://www.w3.org/ns/sosa/hasResult'),
        null,
        null
      );

      if (resultQuads.length > 0) {
        const resultNode = resultQuads[0].object;

        // Get simple result
        const valueQuads = store.getQuads(
          resultNode,
          namedNode('http://www.w3.org/ns/sosa/hasSimpleResult'),
          null,
          null
        );

        if (valueQuads.length > 0) {
          const value = parseFloat(valueQuads[0].object.value);

          // Get the category for the observed property
          const category = getPropertyCategory(property);

          // Save the result
          if (category && property) {
            (energyData[category as keyof EnergyType] as any)[property] = value;
          }
        }
      }
    }
  });

  return energyData;
}