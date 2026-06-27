/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { buildEnergyMatrix } from "./energyMatrix.ts";
import { type EnergyByBuildingYear } from "./energyTimeCut.ts";
import { type AnnualMetrics } from "../energy/energyDataset.ts";
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

Deno.test("buildEnergyMatrix: year columns are the ascending union of reachable years", () => {
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "b", hallArea: 100 }),
  ];
  const c = cube({
    a: { 2021: { electricityConsumption: 1 }, 2023: { electricityConsumption: 1 } },
    b: { 2022: { electricityConsumption: 1 } },
  });
  const m = buildEnergyMatrix(buildings, c);
  assert.deepEqual(m.years, [2021, 2022, 2023]);
});

Deno.test("buildEnergyMatrix: rows preserve building order, one cell per column", () => {
  const buildings = [
    building({ id: "b", hallArea: 100 }),
    building({ id: "a", hallArea: 100 }),
  ];
  const c = cube({
    a: { 2022: { electricityConsumption: 1 } },
    b: { 2022: { electricityConsumption: 1 } },
  });
  const m = buildEnergyMatrix(buildings, c);
  assert.deepEqual(m.rows.map((r) => r.building.id), ["b", "a"]);
  for (const row of m.rows) {
    assert.equal(row.cells.length, m.years.length);
    assert.deepEqual(row.cells.map((cell) => cell.year), m.years);
  }
});

Deno.test("buildEnergyMatrix: a year a building lacks is a GAP (null value, 'none' tier)", () => {
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "b", hallArea: 100 }),
  ];
  // a has only 2021, b has only 2022 → each has one gap cell.
  const c = cube({
    a: { 2021: { electricityConsumption: 1000 } },
    b: { 2022: { electricityConsumption: 2000 } },
  });
  const m = buildEnergyMatrix(buildings, c);
  assert.deepEqual(m.years, [2021, 2022]);

  const a = m.rows.find((r) => r.building.id === "a")!;
  // a: present 2021 (intensity 10), gap 2022.
  assert.equal(a.cells.find((cell) => cell.year === 2021)!.value, 10);
  const a2022 = a.cells.find((cell) => cell.year === 2022)!;
  assert.equal(a2022.value, null);
  assert.equal(a2022.band, "none");
});

Deno.test("buildEnergyMatrix: cell value is the per-year intensity (kWh/m²/a)", () => {
  const buildings = [building({ id: "a", hallArea: 200 })];
  const c = cube({ a: { 2022: { electricityConsumption: 1000 } } });
  const m = buildEnergyMatrix(buildings, c);
  // 1000 kWh / 200 m² = 5.
  assert.equal(m.rows[0].cells[0].value, 5);
});

Deno.test("buildEnergyMatrix: a building with no area / no energy is all gaps but still a row", () => {
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "noarea" }), // present in cube but no area → null intensity
  ];
  const c = cube({
    a: { 2022: { electricityConsumption: 1000 } },
    noarea: { 2022: { electricityConsumption: 1000 } },
  });
  const m = buildEnergyMatrix(buildings, c);
  const noarea = m.rows.find((r) => r.building.id === "noarea")!;
  assert.equal(noarea.cells[0].value, null);
  assert.equal(noarea.cells[0].band, "none");
});

Deno.test("buildEnergyMatrix: tiers match the per-year map lens (terciles per column)", () => {
  // Three equal-area buildings; the per-year tercile split agrees with yearLens.
  const buildings = [
    building({ id: "lo", hallArea: 100 }),
    building({ id: "mid", hallArea: 100 }),
    building({ id: "hi", hallArea: 100 }),
  ];
  // 2022: lo<mid<hi. 2023: the order inverts.
  const c = cube({
    lo: { 2022: { electricityConsumption: 100 }, 2023: { electricityConsumption: 9000 } },
    mid: { 2022: { electricityConsumption: 500 }, 2023: { electricityConsumption: 500 } },
    hi: { 2022: { electricityConsumption: 9000 }, 2023: { electricityConsumption: 100 } },
  });
  const m = buildEnergyMatrix(buildings, c);

  const tierAt = (id: string, year: number) => {
    const row = m.rows.find((r) => r.building.id === id)!;
    return row.cells.find((cell) => cell.year === year)!.band;
  };
  assert.equal(tierAt("lo", 2022), "efficient");
  assert.equal(tierAt("hi", 2022), "inefficient");
  // Inverted the next year.
  assert.equal(tierAt("lo", 2023), "inefficient");
  assert.equal(tierAt("hi", 2023), "efficient");
});

Deno.test("buildEnergyMatrix: only visible buildings frame the tier peer set", () => {
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "out", hallArea: 100 }),
  ];
  const c = cube({
    a: { 2022: { electricityConsumption: 1000 } },
    out: { 2022: { electricityConsumption: 9000 } },
  });
  // 'out' off-screen → sole visible peer 'a' reads 'typical' (nothing to compare).
  const m = buildEnergyMatrix(buildings, c, new Set(["a"]));
  const a = m.rows.find((r) => r.building.id === "a")!;
  assert.equal(a.cells[0].band, "typical");
});

Deno.test("buildEnergyMatrix: generation framing is magnitude (absolute value, low/mid/high bands)", () => {
  const ids = ["a", "b", "c"];
  const buildings = ids.map((id) => building({ id })); // no area — generation ignores it
  const c = cube({
    a: { 2022: { electricityGeneration: 100 } },
    b: { 2022: { electricityGeneration: 300 } },
    c: { 2022: { electricityGeneration: 500 } },
  });
  const m = buildEnergyMatrix(buildings, c, new Set(ids), "electricityGeneration");
  assert.equal(m.framing, "magnitude");
  const cellOf = (id: string) =>
    m.rows.find((r) => r.building.id === id)!.cells[0];
  // Absolute value (not per-m²) and neutral magnitude bands.
  assert.equal(cellOf("a").value, 100);
  assert.equal(cellOf("a").band, "low");
  assert.equal(cellOf("c").band, "high");
});

Deno.test("buildEnergyMatrix: consumption framing stays tier (default metric)", () => {
  const buildings = [building({ id: "a", hallArea: 100 })];
  const c = cube({ a: { 2022: { electricityConsumption: 1000 } } });
  assert.equal(buildEnergyMatrix(buildings, c).framing, "tier");
});

Deno.test("buildEnergyMatrix: an empty cube yields no columns, empty rows", () => {
  const buildings = [building({ id: "a", hallArea: 100 })];
  const m = buildEnergyMatrix(buildings, new Map());
  assert.deepEqual(m.years, []);
  assert.equal(m.rows.length, 1);
  assert.deepEqual(m.rows[0].cells, []);
});
