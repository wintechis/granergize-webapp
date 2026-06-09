/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  annualEnergyKwh,
  categorise,
  energyIntensity,
  referenceArea,
} from "./energyCategory.ts";
import { BuildingType, EnergyType } from "../../types.ts";

// A minimal EnergyType carrying only the energyNeed section the metric reads;
// the other sections are irrelevant to the categorisation and left empty.
function energy(need: Record<string, number>): EnergyType {
  return {
    id: 1,
    uri: "urn:e",
    energyNeed: need,
    energyGeneration: {},
    energyStorage: {},
    energyDistribution: {},
    energyTransfer: {},
    energyUsage: {},
    environmentalFactor: {},
  } as EnergyType;
}

function building(fields: Partial<BuildingType>): BuildingType {
  return { id: 1, uri: "urn:b", ...fields } as BuildingType;
}

Deno.test("annualEnergyKwh: sums the energyNeed carriers, ignores non-numbers", () => {
  assert.equal(annualEnergyKwh(energy({ gas: 100, electricity: 50 })), 150);
  // An undefined carrier contributes nothing.
  assert.equal(
    annualEnergyKwh(energy({ gas: 100, electricity: undefined as unknown as number })),
    100,
  );
  assert.equal(annualEnergyKwh(energy({})), 0);
});

Deno.test("referenceArea: hall-area first, then building, then office", () => {
  assert.equal(referenceArea(building({ hallArea: 5, buildingArea: 9, officeArea: 3 })), 5);
  assert.equal(referenceArea(building({ buildingArea: 9, officeArea: 3 })), 9);
  assert.equal(referenceArea(building({ officeArea: 3 })), 3);
  assert.equal(referenceArea(building({})), null);
});

Deno.test("energyIntensity: kWh / reference area; null when incomputable", () => {
  // 1000 kWh over a 100 m² hall → 10 kWh/m².
  assert.equal(
    energyIntensity(building({ hallArea: 100 }), energy({ gas: 1000 })),
    10,
  );
  // No energy record at all.
  assert.equal(energyIntensity(building({ hallArea: 100 }), undefined), null);
  // No usable area.
  assert.equal(energyIntensity(building({}), energy({ gas: 1000 })), null);
  // Zero / no energy figure.
  assert.equal(energyIntensity(building({ hallArea: 100 }), energy({})), null);
  // Non-positive area is ignored.
  assert.equal(energyIntensity(building({ hallArea: 0 }), energy({ gas: 1000 })), null);
});

Deno.test("categorise: terciles over 3+ peers — low intensity = efficient", () => {
  const peers = [10, 20, 30, 40, 50, 60];
  assert.equal(categorise(10, peers), "efficient");
  assert.equal(categorise(35, peers), "typical");
  assert.equal(categorise(60, peers), "inefficient");
});

Deno.test("categorise: fewer than 3 peers falls back to the mean split", () => {
  // Two buildings: the cheaper one is efficient, the dearer inefficient — the
  // exact case the Vertriebsoptimierung spec seeds.
  const peers = [10, 30];
  assert.equal(categorise(10, peers), "efficient");
  assert.equal(categorise(30, peers), "inefficient");
  // A single building compared only to itself reads as typical.
  assert.equal(categorise(10, [10]), "typical");
});

Deno.test("categorise: missing intensity → none", () => {
  assert.equal(categorise(null, [10, 20, 30]), "none");
  assert.equal(categorise(Number.NaN, [10, 20, 30]), "none");
  // No peers at all → typical (nothing to compare against).
  assert.equal(categorise(10, []), "typical");
});
