/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  barFraction,
  buildSmallMultiples,
} from "./energySmallMultiples.ts";
import { type EnergyByBuildingYear } from "./energyTimeCut.ts";
import { type AnnualMetrics } from "../rdf/energyDataset.ts";
import { BuildingType } from "../../types.ts";

function building(fields: Partial<BuildingType>): BuildingType {
  return { id: "b", uri: "urn:b", ...fields } as BuildingType;
}

/** A per-building cube: { buildingId: { year: { metricKey: value } } }. */
function cube(
  spec: Record<string, Record<number, AnnualMetrics>>,
): EnergyByBuildingYear {
  const out: EnergyByBuildingYear = new Map();
  for (const [id, byYear] of Object.entries(spec)) {
    const m = new Map<number, AnnualMetrics>();
    for (const [y, metrics] of Object.entries(byYear)) {
      m.set(Number(y), metrics);
    }
    out.set(id, m);
  }
  return out;
}

Deno.test("buildSmallMultiples: one panel per year, ascending union of reachable years", () => {
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "b", hallArea: 100 }),
  ];
  const c = cube({
    a: { 2021: { electricityConsumption: 1 }, 2023: { electricityConsumption: 1 } },
    b: { 2022: { electricityConsumption: 1 } },
  });
  const { panels } = buildSmallMultiples(buildings, c);
  assert.deepEqual(panels.map((p) => p.year), [2021, 2022, 2023]);
});

Deno.test("buildSmallMultiples: every panel carries every building in order (a missing year is a null slot)", () => {
  const buildings = [
    building({ id: "b", hallArea: 100 }),
    building({ id: "a", hallArea: 100 }),
  ];
  const c = cube({
    a: { 2022: { electricityConsumption: 1000 } },
    b: { 2021: { electricityConsumption: 2000 } },
  });
  const { panels } = buildSmallMultiples(buildings, c);
  for (const panel of panels) {
    assert.deepEqual(panel.buildings.map((pb) => pb.building.id), ["b", "a"]);
  }
  // a has no 2021 dataset → null slot in the 2021 panel.
  const p2021 = panels.find((p) => p.year === 2021)!;
  assert.equal(p2021.buildings.find((pb) => pb.building.id === "a")!.value, null);
  assert.equal(p2021.buildings.find((pb) => pb.building.id === "a")!.band, "none");
});

Deno.test("buildSmallMultiples: slot value is the per-year intensity (kWh/m²/a)", () => {
  const buildings = [building({ id: "a", hallArea: 200 })];
  const c = cube({ a: { 2022: { electricityConsumption: 1000 } } });
  const { panels } = buildSmallMultiples(buildings, c);
  // 1000 kWh / 200 m² = 5.
  assert.equal(panels[0].buildings[0].value, 5);
});

Deno.test("buildSmallMultiples: the SCALE is pooled across all years (cross-year min/max)", () => {
  const buildings = [building({ id: "a", hallArea: 100 })];
  // intensities: 2021 → 10, 2022 → 50, 2023 → 90.
  const c = cube({
    a: { 2021: { electricityConsumption: 1000 }, 2022: { electricityConsumption: 5000 }, 2023: { electricityConsumption: 9000 } },
  });
  const { scale } = buildSmallMultiples(buildings, c);
  assert.deepEqual(scale, { min: 10, max: 90 });
});

Deno.test("buildSmallMultiples: tier is ONE shared scale across panels — NOT per-year terciles", () => {
  // The same building rises 10 → 50 → 90 over three years. Under a per-year
  // (matrix) scale each year is the sole peer → always 'typical'. Under the
  // shared cross-year scale, the low year reads efficient and the high year
  // inefficient — that's the comparability small multiples must deliver.
  const buildings = [building({ id: "a", hallArea: 100 })];
  const c = cube({
    a: { 2021: { electricityConsumption: 1000 }, 2022: { electricityConsumption: 5000 }, 2023: { electricityConsumption: 9000 } },
  });
  const { panels } = buildSmallMultiples(buildings, c);
  const tierAt = (year: number) =>
    panels.find((p) => p.year === year)!.buildings[0].band;
  assert.equal(tierAt(2021), "efficient");
  assert.equal(tierAt(2023), "inefficient");
  // (2022 is the middle → typical.)
  assert.equal(tierAt(2022), "typical");
});

Deno.test("buildSmallMultiples: a tier means the same colour in every panel (a value re-appearing keeps its tier)", () => {
  // Two buildings; building 'lo' holds intensity 10 in BOTH years, 'hi' holds 90.
  // Under the shared scale 'lo' is efficient and 'hi' inefficient in every panel.
  const buildings = [
    building({ id: "lo", hallArea: 100 }),
    building({ id: "hi", hallArea: 100 }),
    building({ id: "mid", hallArea: 100 }),
  ];
  const c = cube({
    lo: { 2021: { electricityConsumption: 1000 }, 2022: { electricityConsumption: 1000 } },
    hi: { 2021: { electricityConsumption: 9000 }, 2022: { electricityConsumption: 9000 } },
    mid: { 2021: { electricityConsumption: 5000 }, 2022: { electricityConsumption: 5000 } },
  });
  const { panels } = buildSmallMultiples(buildings, c);
  for (const panel of panels) {
    const tier = (id: string) =>
      panel.buildings.find((pb) => pb.building.id === id)!.band;
    assert.equal(tier("lo"), "efficient");
    assert.equal(tier("hi"), "inefficient");
  }
});

Deno.test("buildSmallMultiples: off-screen buildings don't skew the shared scale", () => {
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "out", hallArea: 100 }),
  ];
  // 'a' intensity 10; 'out' intensity 900 but off-screen → excluded from scale.
  const c = cube({
    a: { 2022: { electricityConsumption: 1000 } },
    out: { 2022: { electricityConsumption: 90000 } },
  });
  const { scale } = buildSmallMultiples(buildings, c, new Set(["a"]));
  assert.deepEqual(scale, { min: 10, max: 10 });
});

Deno.test("buildSmallMultiples: an empty cube yields no panels and a null scale", () => {
  const buildings = [building({ id: "a", hallArea: 100 })];
  const sm = buildSmallMultiples(buildings, new Map());
  assert.deepEqual(sm.panels, []);
  assert.equal(sm.scale, null);
});

Deno.test("barFraction: maps a value to 0..1 of the shared scale", () => {
  const scale = { min: 10, max: 90 };
  assert.equal(barFraction(10, scale), 0);
  assert.equal(barFraction(90, scale), 1);
  assert.equal(barFraction(50, scale), 0.5);
});

Deno.test("barFraction: null value or null scale → 0; clamps out-of-range; degenerate scale → 1", () => {
  assert.equal(barFraction(null, { min: 10, max: 90 }), 0);
  assert.equal(barFraction(50, null), 0);
  // A value outside the pooled range (e.g. an off-screen peer when on screen) clamps.
  assert.equal(barFraction(200, { min: 10, max: 90 }), 1);
  assert.equal(barFraction(0, { min: 10, max: 90 }), 0);
  // Single-value view: min === max → every present value reads full.
  assert.equal(barFraction(10, { min: 10, max: 10 }), 1);
});
