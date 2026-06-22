/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { buildOverYears } from "./energyOverYears.ts";
import type { BuildingType } from "../../types.ts";
import type { EnergyByBuildingYear } from "./energyTimeCut.ts";

const bld = (id: string): BuildingType =>
  ({ id, uri: id } as unknown as BuildingType);

Deno.test("buildOverYears: sorted year union, per-building lines, missing → null", () => {
  const energy: EnergyByBuildingYear = new Map([
    ["b1", new Map([[2024, { electricityConsumption: 120 }], [
      2022,
      { electricityConsumption: 100 },
    ]])],
    ["b2", new Map([[2023, { electricityConsumption: 80 }]])],
  ]);
  const { years, data, series } = buildOverYears(
    [bld("b1"), bld("b2")],
    energy,
    "electricityConsumption",
  );

  // The x-axis is the ascending union of every building's years.
  assert.deepEqual(years, [2022, 2023, 2024]);
  // One series per building, in input order, with sanitized dataKeys.
  assert.equal(series.length, 2);
  assert.deepEqual(series.map((s) => s.key), ["b0", "b1"]);
  // 2022: b1 has 100, b2 has no figure → null (the line bridges the gap).
  const y2022 = data.find((r) => r.year === 2022)!;
  assert.equal(y2022.b0, 100);
  assert.equal(y2022.b1, null);
  // 2023: only b2; 2024: only b1.
  const y2023 = data.find((r) => r.year === 2023)!;
  assert.equal(y2023.b0, null);
  assert.equal(y2023.b1, 80);
  assert.equal(data.find((r) => r.year === 2024)!.b0, 120);
});

Deno.test("buildOverYears: reads the SELECTED metric (raw figure, not intensity)", () => {
  const energy: EnergyByBuildingYear = new Map([
    ["b1", new Map([[2024, { electricityConsumption: 120, heatConsumption: 50 }]])],
  ]);
  const elec = buildOverYears([bld("b1")], energy, "electricityConsumption");
  const heat = buildOverYears([bld("b1")], energy, "heatConsumption");
  assert.equal(elec.data[0].b0, 120);
  assert.equal(heat.data[0].b0, 50);
});

Deno.test("buildOverYears: empty set → no years, no rows", () => {
  const empty = buildOverYears([], new Map(), "electricityConsumption");
  assert.deepEqual(empty.years, []);
  assert.deepEqual(empty.data, []);
  assert.deepEqual(empty.series, []);
});
