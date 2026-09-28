/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Building } from "../../types.ts";
import type { AnnualMetrics } from "../energy/energyDataset.ts";
import type { EnergyByBuildingYear } from "../energy/energyTimeCut.ts";
import {
  buildPivot,
  BUND_KEY,
  finerLevel,
  prefixValidAt,
  scopeLabel,
  UNASSIGNED_KEY,
  withinRegion,
} from "./pivot.ts";
import {
  DEFAULT_ROWS,
  inToParams,
  resolveIn,
  resolveRows,
  rowsToParams,
} from "./observationsAxes.ts";

/** A building with a reference area (so a consumption metric yields an intensity). */
const b = (id: string, ags?: string, extra: Partial<Building> = {}): Building =>
  ({
    id,
    uri: id,
    type: "Building",
    label: id.toUpperCase(),
    buildingArea: 100,
    ...(ags ? { regionAgs: ags } : {}),
    ...extra,
  }) as Building;

/** `{ buildingId: { year: kWh } }` → the annual cube. */
const cube = (spec: Record<string, Record<number, number>>): EnergyByBuildingYear => {
  const out: EnergyByBuildingYear = new Map();
  for (const [id, byYear] of Object.entries(spec)) {
    const m = new Map<number, AnnualMetrics>();
    for (const [year, kwh] of Object.entries(byYear)) {
      m.set(Number(year), { electricityConsumption: kwh } as AnnualMetrics);
    }
    out.set(id, m);
  }
  return out;
};

const p = (q: string) => new URLSearchParams(q);

Deno.test("buildPivot: building rows carry the underlying per-m² values", () => {
  const grid = buildPivot(
    [b("b1"), b("b2")],
    cube({ b1: { 2022: 10000, 2023: 12000 }, b2: { 2023: 8000 } }),
  );
  assert.deepEqual(grid.years, [2022, 2023]);
  assert.equal(grid.level, "building");
  assert.equal(grid.framing, "tier");
  const [r1, r2] = grid.rows;
  assert.equal(r1.key, "b1");
  assert.equal(r1.label, "B1");
  assert.equal(r1.building?.id, "b1");
  // 10000 kWh over the 100 m² reference area.
  assert.deepEqual(r1.cells.map((c) => c.value), [100, 120]);
  assert.deepEqual(r1.cells.map((c) => c.n), [1, 1]);
  // A missing year is a gap, not a zero.
  assert.equal(r2.cells[0].value, null);
  assert.equal(r2.cells[0].n, 0);
  assert.equal(r2.cells[0].band, "none");
  assert.equal(r2.cells[1].value, 80);
});

Deno.test("buildPivot: region rows group by AGS prefix, per level", () => {
  const buildings = [
    b("b1", "09564000"), // Nürnberg  — Kreis 09564, Land 09
    b("b2", "09562000"), // Fürth     — Kreis 09562, Land 09
    b("b3", "05315000"), // Köln      — Kreis 05315, Land 05
  ];
  const energy = cube({ b1: { 2023: 10000 }, b2: { 2023: 20000 }, b3: { 2023: 30000 } });

  const gemeinde = buildPivot(buildings, energy, "electricityConsumption", "gemeinde");
  assert.deepEqual(gemeinde.rows.map((r) => r.key), ["05315000", "09562000", "09564000"]);
  assert.deepEqual(gemeinde.rows.map((r) => r.members), [1, 1, 1]);

  const kreis = buildPivot(buildings, energy, "electricityConsumption", "kreis");
  assert.deepEqual(kreis.rows.map((r) => r.key), ["05315", "09562", "09564"]);

  const land = buildPivot(buildings, energy, "electricityConsumption", "land");
  assert.deepEqual(land.rows.map((r) => r.key), ["05", "09"]);
  assert.deepEqual(land.rows.map((r) => r.members), [1, 2]);
  // A region row is a roll-up, not a resource — no building to drill into.
  assert.equal(land.rows[0].building, undefined);
});

Deno.test("buildPivot: a region cell is the Ø over the members that carry a value, with n", () => {
  const buildings = [b("b1", "09564000"), b("b2", "09562000"), b("b3", "09563000")];
  const grid = buildPivot(
    buildings,
    // b3 has no 2023 figure, so it must not dilute the Ø (and n says so).
    cube({ b1: { 2023: 10000 }, b2: { 2023: 20000 }, b3: { 2022: 30000 } }),
    "electricityConsumption",
    "land",
  );
  assert.deepEqual(grid.years, [2022, 2023]);
  const [row] = grid.rows;
  assert.equal(row.key, "09");
  assert.equal(row.members, 3);
  // 2022: only b3 (300); 2023: mean of b1 (100) and b2 (200).
  assert.deepEqual(row.cells.map((c) => c.value), [300, 150]);
  assert.deepEqual(row.cells.map((c) => c.n), [1, 2]);
});

Deno.test("buildPivot: buildings without a usable AGS form one labelled bucket", () => {
  const grid = buildPivot(
    [b("b1", "09564000"), b("b2"), b("b3", "09")],
    cube({ b1: { 2023: 10000 }, b2: { 2023: 20000 }, b3: { 2023: 30000 } }),
    "electricityConsumption",
    "gemeinde",
  );
  // b3's 2-digit AGS is too short for a Gemeinde row — bucketed, not dropped.
  const bucket = grid.rows.find((r) => r.key === UNASSIGNED_KEY);
  assert.ok(bucket, "the unassigned bucket exists");
  assert.equal(bucket.members, 2);
  assert.equal(bucket.label, "", "the renderer supplies its wording");
  assert.equal(bucket.cells[0].value, 250); // Ø of 200 and 300
  // …and it sorts last.
  assert.equal(grid.rows[grid.rows.length - 1].key, UNASSIGNED_KEY);
});

Deno.test("buildPivot: a region row prefers a member's region name over the AGS", () => {
  const grid = buildPivot(
    [b("b1", "09564000", { locality: "Nürnberg" }), b("b2", "09564000")],
    cube({ b1: { 2023: 10000 }, b2: { 2023: 20000 } }),
    "electricityConsumption",
    "gemeinde",
  );
  assert.equal(grid.rows[0].label, "Nürnberg");
  // A Kreis has no name field on the building record, so it stays AGS-labelled.
  const kreis = buildPivot(
    [b("b1", "09564000", { locality: "Nürnberg" })],
    cube({ b1: { 2023: 10000 } }),
    "electricityConsumption",
    "kreis",
  );
  assert.equal(kreis.rows[0].label, "09564");
});

Deno.test("buildPivot: all-gap rows and columns are pruned (the cube is sparse)", () => {
  const grid = buildPivot(
    // b2 carries a year but no usable figure for the metric; b3 no data at all.
    [b("b1"), b("b2"), b("b3")],
    cube({ b1: { 2021: 10000, 2023: 12000 }, b2: { 2022: 0 } }),
  );
  // 2022 held only b2's non-positive figure → the whole column goes.
  assert.deepEqual(grid.years, [2021, 2023]);
  assert.deepEqual(grid.rows.map((r) => r.key), ["b1"]);
  assert.equal(grid.rows[0].cells.length, 2);
});

Deno.test("buildPivot: no reachable years → an empty grid, not a padded one", () => {
  const grid = buildPivot([b("b1")], cube({}));
  assert.deepEqual(grid.years, []);
  assert.deepEqual(grid.rows, []);
});

Deno.test("buildPivot: the derived total rolls up like any other tier metric", () => {
  // The cube helper writes electricity only, so the two-carrier cube is spelled out.
  const both: EnergyByBuildingYear = new Map([
    ["b1", new Map([[2023, { electricityConsumption: 1000, heatConsumption: 500 }]])],
    // b2 carries only heat — the sparse case: it contributes that carrier alone.
    ["b2", new Map([[2023, { heatConsumption: 900 }]])],
  ]);
  const rows = buildPivot([b("b1", "09564000"), b("b2", "09564000")], both, "energyTotal");
  assert.equal(rows.framing, "tier");
  assert.equal(rows.rows.find((r) => r.key === "b1")!.cells[0].value, 15);
  assert.equal(rows.rows.find((r) => r.key === "b2")!.cells[0].value, 9);
  // Rolled up to the Gemeinde: the Ø of the two per-m² totals, over both members.
  const region = buildPivot(
    [b("b1", "09564000"), b("b2", "09564000")],
    both,
    "energyTotal",
    "gemeinde",
  );
  assert.equal(region.rows.length, 1);
  assert.equal(region.rows[0].cells[0].value, 12);
  assert.equal(region.rows[0].cells[0].n, 2);
});

Deno.test("buildPivot: the bund level is one national row over the AGS-carrying buildings", () => {
  const grid = buildPivot(
    [b("b1", "09564000"), b("b2", "05315000"), b("b3")],
    cube({ b1: { 2023: 10000 }, b2: { 2023: 20000 }, b3: { 2023: 30000 } }),
    "electricityConsumption",
    "bund",
  );
  assert.deepEqual(grid.rows.map((r) => r.key), [BUND_KEY, UNASSIGNED_KEY]);
  const [de, rest] = grid.rows;
  assert.equal(de.label, "", "the renderer names the national row");
  assert.equal(de.members, 2);
  assert.equal(de.cells[0].value, 150); // Ø of 100 and 200 per m²
  assert.equal(rest.members, 1);
});

Deno.test("buildPivot: the unassigned bucket never shifts the region bands", () => {
  const regions = [b("b1", "01234000"), b("b2", "02345000"), b("b3", "03456000")];
  const energy = {
    b1: { 2023: 10000 },
    b2: { 2023: 20000 },
    b3: { 2023: 30000 },
  };
  const withoutBucket = buildPivot(regions, cube(energy), "electricityConsumption", "land");
  // An extreme no-AGS outlier: were it a peer, every region would collapse into the
  // lowest tercile.
  const withBucket = buildPivot(
    [...regions, b("b4")],
    cube({ ...energy, b4: { 2023: 900000 } }),
    "electricityConsumption",
    "land",
  );
  const bandsOf = (g: ReturnType<typeof buildPivot>) =>
    g.rows.filter((r) => r.key !== UNASSIGNED_KEY).map((r) => r.cells[0].band);
  assert.deepEqual(bandsOf(withBucket), bandsOf(withoutBucket));
  // …while the bucket itself is still scored (against the regions).
  const bucket = withBucket.rows.find((r) => r.key === UNASSIGNED_KEY);
  assert.equal(bucket?.cells[0].band, "inefficient");
});

Deno.test("finerLevel: walks the ladder down to buildings", () => {
  assert.equal(finerLevel("bund"), "land");
  assert.equal(finerLevel("land"), "kreis");
  assert.equal(finerLevel("kreis"), "gemeinde");
  assert.equal(finerLevel("gemeinde"), "building");
  assert.equal(finerLevel("building"), null);
});

Deno.test("withinRegion: keeps the buildings whose AGS starts with the prefix", () => {
  const buildings = [b("b1", "09564000"), b("b2", "09562000"), b("b3", "05315000"), b("b4")];
  assert.deepEqual(withinRegion(buildings, "09").map((x) => x.id), ["b1", "b2"]);
  assert.deepEqual(withinRegion(buildings, "09564").map((x) => x.id), ["b1"]);
});

Deno.test("scopeLabel: a member's name field when the level has one, else the prefix", () => {
  const buildings = [
    b("b1", "09564000", { locality: "Nürnberg", region: "Bayern" }),
    b("b2", "05315000"),
  ];
  assert.equal(scopeLabel(buildings, "09564000"), "Nürnberg");
  assert.equal(scopeLabel(buildings, "09"), "Bayern");
  assert.equal(scopeLabel(buildings, "09564"), "09564"); // Kreis has no name field
  assert.equal(scopeLabel(buildings, "05"), "05"); // no member carries the field
});

Deno.test("prefixValidAt: the scope must be coarser than the rows", () => {
  assert.ok(prefixValidAt("09", "kreis"));
  assert.ok(prefixValidAt("09564", "gemeinde"));
  assert.ok(prefixValidAt("09564000", "building"));
  assert.ok(!prefixValidAt("09", "land"), "same length as the rows");
  assert.ok(!prefixValidAt("09564", "land"), "finer than the rows");
  assert.ok(!prefixValidAt("09", "bund"), "the national row scopes to nothing");
});

Deno.test("resolveIn: an AGS prefix coherent with the level; else unscoped", () => {
  assert.equal(resolveIn(p("in=09"), "kreis"), "09");
  assert.equal(resolveIn(p("in=09564"), "gemeinde"), "09564");
  assert.equal(resolveIn(p("in=09564000"), "building"), "09564000");
  assert.equal(resolveIn(p(""), "kreis"), null);
  assert.equal(resolveIn(p("in=abc"), "kreis"), null, "not an AGS");
  assert.equal(resolveIn(p("in=095"), "kreis"), null, "not a level's prefix length");
  assert.equal(resolveIn(p("in=09564"), "land"), null, "finer than the rows");
});

Deno.test("inToParams: sets / clears the scope, preserving the other axes", () => {
  const out = inToParams("09", p("view=pivot&rows=kreis&m=heat"));
  assert.equal(out.get("in"), "09");
  assert.equal(out.get("rows"), "kreis");
  assert.equal(out.get("m"), "heat");
  assert.equal(inToParams(null, p("in=09&m=heat")).get("in"), null);
  assert.equal(inToParams(null, p("in=09&m=heat")).get("m"), "heat");
});

Deno.test("resolveRows: empty / unknown → the default (buildings)", () => {
  assert.equal(resolveRows(p("")), DEFAULT_ROWS);
  assert.equal(resolveRows(p("rows=zzz")), "building");
});

Deno.test("resolveRows: each known level passes through", () => {
  for (const r of ["building", "gemeinde", "kreis", "land", "bund"]) {
    assert.equal(resolveRows(p(`rows=${r}`)), r);
  }
});

Deno.test("rowsToParams: omits the default, sets the rest, preserves the other axes", () => {
  const prev = p("view=pivot&m=heat&offset=20");
  const out = rowsToParams("kreis", prev);
  assert.equal(out.get("rows"), "kreis");
  assert.equal(out.get("view"), "pivot", "view survives");
  assert.equal(out.get("m"), "heat", "metric survives");
  assert.equal(out.get("offset"), "20", "pager survives");
  // the default row level writes a clean URI (no ?rows)
  assert.equal(rowsToParams("building", p("rows=land&m=heat")).get("rows"), null);
  assert.equal(rowsToParams("building", p("rows=land&m=heat")).get("m"), "heat");
});
