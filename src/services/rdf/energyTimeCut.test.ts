/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  clampYear,
  defaultYear,
  type EnergyByBuildingYear,
  valuesAtYear,
  selectableYears,
  yearLens,
} from "./energyTimeCut.ts";
import { type AnnualMetrics } from "./energyDataset.ts";
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

Deno.test("selectableYears: union of reachable buildings' years, sorted ascending", () => {
  const c = cube({
    a: { 2021: { electricityConsumption: 1 }, 2023: { electricityConsumption: 1 } },
    b: { 2022: { electricityConsumption: 1 }, 2023: { electricityConsumption: 1 } },
  });
  assert.deepEqual(selectableYears(c), [2021, 2022, 2023]);
});

Deno.test("selectableYears: empty cube yields no years", () => {
  assert.deepEqual(selectableYears(new Map()), []);
});

Deno.test("defaultYear: the latest selectable year, or null when none", () => {
  assert.equal(defaultYear([2020, 2021, 2024]), 2024);
  assert.equal(defaultYear([]), null);
});

Deno.test("clampYear: present year passes through", () => {
  assert.equal(clampYear([2020, 2022, 2024], 2022), 2022);
});

Deno.test("clampYear: absent request defaults to the latest year", () => {
  assert.equal(clampYear([2020, 2022, 2024], null), 2024);
});

Deno.test("clampYear: a non-selectable year snaps to the nearest", () => {
  // 2023 is nearer 2022 (dist 1) than 2024 (dist 1)? tie → earlier (2022).
  assert.equal(clampYear([2020, 2022, 2024], 2023), 2022);
  // clearly nearer the high end
  assert.equal(clampYear([2020, 2022, 2024], 2030), 2024);
  // clearly nearer the low end
  assert.equal(clampYear([2020, 2022, 2024], 2010), 2020);
});

Deno.test("clampYear: no selectable years yields null", () => {
  assert.equal(clampYear([], 2022), null);
  assert.equal(clampYear([], null), null);
});

Deno.test("valuesAtYear: per-year intensity; null where no dataset that year", () => {
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "b", hallArea: 100 }),
  ];
  // a: 1000 kWh in 2022 → 10; b: only 2023.
  const c = cube({
    a: { 2022: { electricityConsumption: 1000 } },
    b: { 2023: { electricityConsumption: 2000 } },
  });
  const at2022 = valuesAtYear(buildings, c, 2022);
  assert.equal(at2022.get("a"), 10);
  // b has no 2022 dataset → null (neutral marker for that cut).
  assert.equal(at2022.get("b"), null);

  const at2023 = valuesAtYear(buildings, c, 2023);
  assert.equal(at2023.get("a"), null);
  assert.equal(at2023.get("b"), 20);
});

Deno.test("valuesAtYear: a null year makes every intensity null", () => {
  const buildings = [building({ id: "a", hallArea: 100 })];
  const c = cube({ a: { 2022: { electricityConsumption: 1000 } } });
  const at = valuesAtYear(buildings, c, null);
  assert.equal(at.get("a"), null);
});

Deno.test("yearLens: re-cuts the cube at a year; recolours as the year changes", () => {
  // Three buildings, same 100 m² area, three carriers → terciles apply.
  const buildings = [
    building({ id: "lo", hallArea: 100 }),
    building({ id: "mid", hallArea: 100 }),
    building({ id: "hi", hallArea: 100 }),
  ];
  const visible = new Set(["lo", "mid", "hi"]);
  // 2022: lo<mid<hi. 2023: the order inverts (lo becomes the worst).
  const c = cube({
    lo: { 2022: { electricityConsumption: 100 }, 2023: { electricityConsumption: 9000 } },
    mid: { 2022: { electricityConsumption: 500 }, 2023: { electricityConsumption: 500 } },
    hi: { 2022: { electricityConsumption: 9000 }, 2023: { electricityConsumption: 100 } },
  });

  const at2022 = yearLens(buildings, visible, c, 2022);
  assert.equal(at2022.band("lo"), "efficient");
  assert.equal(at2022.band("hi"), "inefficient");

  const at2023 = yearLens(buildings, visible, c, 2023);
  // The cut at a different year recolours: lo is now the least efficient.
  assert.equal(at2023.band("lo"), "inefficient");
  assert.equal(at2023.band("hi"), "efficient");
});

Deno.test("yearLens: a building absent that year is 'none'", () => {
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "b", hallArea: 100 }),
  ];
  const visible = new Set(["a", "b"]);
  const c = cube({ a: { 2022: { electricityConsumption: 1000 } } });
  const lens = yearLens(buildings, visible, c, 2022);
  assert.equal(lens.band("b"), "none");
});

Deno.test("yearLens: a selected metric reads its OWN figure, not consumption", () => {
  const buildings = [building({ id: "a", hallArea: 100 })];
  const visible = new Set(["a"]);
  // 'a' carries heat but no electricity that year.
  const c = cube({ a: { 2022: { heatConsumption: 2000 } } });
  // Default (electricity) → no figure → 'none'.
  assert.equal(yearLens(buildings, visible, c, 2022).band("a"), "none");
  // Heat selected → a figure → framed (sole peer → 'typical').
  assert.equal(
    yearLens(buildings, visible, c, 2022, "heatConsumption").band("a"),
    "typical",
  );
});

Deno.test("yearLens: generation is MAGNITUDE-framed (low/mid/high), not an efficiency tier", () => {
  // Five PV producers, area irrelevant for generation. Magnitude terciles → the
  // smallest reads 'low', the largest 'high' — NEVER 'efficient'/'inefficient'.
  const ids = ["a", "b", "c", "d", "e"];
  const buildings = ids.map((id) => building({ id }));
  const visible = new Set(ids);
  const c = cube({
    a: { 2022: { electricityGeneration: 100 } },
    b: { 2022: { electricityGeneration: 200 } },
    c: { 2022: { electricityGeneration: 300 } },
    d: { 2022: { electricityGeneration: 400 } },
    e: { 2022: { electricityGeneration: 500 } },
  });
  const lens = yearLens(buildings, visible, c, 2022, "electricityGeneration");
  assert.equal(lens.framing, "magnitude");
  assert.equal(lens.band("a"), "low");
  assert.equal(lens.band("e"), "high");
  // The value is the ABSOLUTE figure (no per-m² intensity), even with no area.
  assert.equal(lens.values.get("c"), 300);
});

Deno.test("yearLens: only VISIBLE buildings form the peer set", () => {
  // 'out' is off-screen, so the peer set is just {a}; with <3 peers the split is
  // by mean — a sole peer reads 'typical' (nothing to compare against).
  const buildings = [
    building({ id: "a", hallArea: 100 }),
    building({ id: "out", hallArea: 100 }),
  ];
  const visible = new Set(["a"]);
  const c = cube({
    a: { 2022: { electricityConsumption: 1000 } },
    out: { 2022: { electricityConsumption: 9000 } },
  });
  const lens = yearLens(buildings, visible, c, 2022);
  assert.equal(lens.band("a"), "typical");
});
