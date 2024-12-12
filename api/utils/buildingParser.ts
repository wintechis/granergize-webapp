import type { Quad } from "@rdfjs/types";
import type { BuildingType } from "../../types/types.ts";
import { predicateMap, parsingFunctions } from "./config/buildingConfig.ts";

export function parseBuildings(quads: Quad[]): Map<string, BuildingType> {
  const buildings = new Map<string, BuildingType>();

  quads.forEach((quad: Quad) => {
    const buildingId = quad.subject.value.split("#")[1];
    if (!buildings.has(buildingId)) {
      buildings.set(buildingId, {
        id: parseInt(buildingId),
        type: "https://w3id.org/rec#building",
      });
    }

    const building = buildings.get(buildingId)!;
    const pred = quad.predicate.value;
    const obj = quad.object.value;

    if (Object.prototype.hasOwnProperty.call(predicateMap, pred)) {
      const propertyName = predicateMap[pred];
      const parseFn = parsingFunctions[propertyName];

      if (parseFn) {
        (building as any)[propertyName] = parseFn(obj);
      } else {
        (building as any)[propertyName] = obj;
      }
    }
  });

  return buildings;
}