/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  regionalGrainFor,
  regionalRows,
  type RegionalTableSeries,
} from "./regionalCells.ts";
import { BUND_KEY, UNASSIGNED_KEY } from "./pivot.ts";
import type { RegionalObservation } from "../sources/regionalCube.ts";

const obs = (year: number, value: number, unit = "Prozent"): RegionalObservation => ({
  year,
  value,
  unit,
});

const table = (
  over: Omit<Partial<RegionalTableSeries>, "byRegion"> & {
    byRegion?: Record<string, RegionalObservation[]>;
  } = {},
): RegionalTableSeries => ({
  tableId: "86251-Z-02",
  labelId: "regRenewableShare",
  grain: "land",
  ...over,
  byRegion: new Map(Object.entries(over.byRegion ?? { "09": [obs(2023, 61.5)] })),
});

Deno.test("regionalGrainFor: only the two grains the source publishes", () => {
  assert.equal(regionalGrainFor("land"), "land");
  assert.equal(regionalGrainFor("kreis"), "kreis");
  // Finer than the source (building/Gemeinde) and coarser (Bund) have no counterpart.
  assert.equal(regionalGrainFor("building"), null);
  assert.equal(regionalGrainFor("gemeinde"), null);
  assert.equal(regionalGrainFor("bund"), null);
});

Deno.test("regionalRows: one labelled row per (region, table), aligned to the columns", () => {
  const rows = regionalRows(
    [table({ byRegion: { "09": [obs(2022, 55), obs(2023, 61.5)] } })],
    [{ key: "09", label: "Bayern" }],
    [2022, 2023, 2024],
    "land",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "09:86251-Z-02");
  assert.equal(rows[0].regionLabel, "Bayern");
  assert.equal(rows[0].labelId, "regRenewableShare");
  assert.equal(rows[0].unit, "%", "the source's German unit name is displayed");
  assert.deepEqual(rows[0].cells.map((c) => c.value), [55, 61.5, null]);
  assert.deepEqual(rows[0].cells.map((c) => c.year), [2022, 2023, 2024]);
});

Deno.test("regionalRows: only tables whose grain matches the row level", () => {
  const land = table({ tableId: "land-1", grain: "land", byRegion: { "09": [obs(2023, 1)] } });
  const kreis = table({
    tableId: "kreis-1",
    grain: "kreis",
    labelId: "regKreisRenewableUse",
    byRegion: { "09": [obs(2023, 2)] },
  });
  const regions = [{ key: "09", label: "Bayern" }];
  assert.deepEqual(
    regionalRows([land, kreis], regions, [2023], "land").map((r) => r.tableId),
    ["land-1"],
  );
  assert.deepEqual(
    regionalRows([land, kreis], regions, [2023], "kreis").map((r) => r.tableId),
    ["kreis-1"],
  );
  // A level the source has no grain for shows nothing at all.
  assert.deepEqual(regionalRows([land, kreis], regions, [2023], "building"), []);
  assert.deepEqual(regionalRows([land, kreis], regions, [2023], "bund"), []);
});

Deno.test("regionalRows: only regions the live grid shows; never the non-AGS keys", () => {
  const t = table({ byRegion: { "09": [obs(2023, 61.5)], "12": [obs(2023, 88)] } });
  const rows = regionalRows(
    [t],
    [{ key: "09", label: "Bayern" }, { key: UNASSIGNED_KEY, label: "Without a region" }, {
      key: BUND_KEY,
      label: "Germany",
    }],
    [2023],
    "land",
  );
  // 12 is in the table but not on the grid; the bucket/Bund keys are not AGS regions.
  assert.deepEqual(rows.map((r) => r.key), ["09:86251-Z-02"]);
});

Deno.test("regionalRows: sparse-prunes an all-gap row and never widens the grid", () => {
  const offGrid = table({ tableId: "off", byRegion: { "09": [obs(2019, 40)] } });
  const onGrid = table({ tableId: "on", byRegion: { "09": [obs(2023, 61.5)] } });
  const rows = regionalRows(
    [offGrid, onGrid],
    [{ key: "09", label: "Bayern" }],
    [2022, 2023],
    "land",
  );
  assert.deepEqual(rows.map((r) => r.tableId), ["on"]);
  assert.deepEqual(rows[0].cells.map((c) => c.year), [2022, 2023]);
  // No columns (an empty live grid) → no rows, whatever the tables carry.
  assert.deepEqual(regionalRows([onGrid], [{ key: "09", label: "Bayern" }], [], "land"), []);
});

Deno.test("regionalRows: region-major order, one row per table under its region", () => {
  const a = table({ tableId: "a", byRegion: { "09": [obs(2023, 1)], "12": [obs(2023, 3)] } });
  const b = table({
    tableId: "b",
    labelId: "regPrimaryEnergy",
    byRegion: { "09": [obs(2023, 2)], "12": [obs(2023, 4)] },
  });
  const rows = regionalRows(
    [a, b],
    [{ key: "09", label: "Bayern" }, { key: "12", label: "Brandenburg" }],
    [2023],
    "land",
  );
  assert.deepEqual(rows.map((r) => r.key), [
    "09:a",
    "09:b",
    "12:a",
    "12:b",
  ]);
});

Deno.test("regionalRows: the unit falls back to the source string, then to empty", () => {
  const tj = table({ byRegion: { "09": [obs(2023, 900, "TJ")] } });
  assert.equal(
    regionalRows([tj], [{ key: "09", label: "Bayern" }], [2023], "land")[0].unit,
    "TJ",
  );
  const none = table({ byRegion: { "09": [obs(2023, 900, "")] } });
  assert.equal(
    regionalRows([none], [{ key: "09", label: "Bayern" }], [2023], "land")[0].unit,
    "",
  );
});
