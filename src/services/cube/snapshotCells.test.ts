/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  materializedRows,
  type SnapshotSource,
  snapshotYears,
} from "./snapshotCells.ts";

const snap = (over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  id: "aggregation-1",
  name: "Portfolio electricity",
  values: { electricityConsumption: 1200 },
  buildingCount: 5,
  ...over,
});

Deno.test("snapshotYears: metricPeriod wins, then the monthly period, else none", () => {
  assert.deepEqual(snapshotYears(snap({ metricPeriod: "2024" })), [2024]);
  assert.deepEqual(snapshotYears(snap({ metricPeriod: "2024-03" })), [2024]);
  assert.deepEqual(
    snapshotYears(snap({ metricPeriod: "2024", period: "2019-01" })),
    [2024],
    "the benchmark's own period wins over the definition's",
  );
  assert.deepEqual(snapshotYears(snap({ period: "2021-07" })), [2021]);
  // Neither declared → no time coordinate (never guessed from computedAt).
  assert.deepEqual(snapshotYears(snap()), []);
  assert.deepEqual(snapshotYears(snap({ metricPeriod: "not-a-year" })), []);
});

Deno.test("materializedRows: one row per snapshot, its value only at the covered year", () => {
  const rows = materializedRows(
    [snap({ metricPeriod: "2023" })],
    "electricityConsumption",
    [2022, 2023, 2024],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "aggregation-1");
  assert.equal(rows[0].label, "Portfolio electricity");
  assert.equal(rows[0].members, 5);
  assert.deepEqual(rows[0].cells.map((c) => c.value), [null, 1200, null]);
  assert.deepEqual(rows[0].cells.map((c) => c.year), [2022, 2023, 2024]);
});

Deno.test("materializedRows: a benchmark carries its producing agent", () => {
  const rows = materializedRows(
    [snap({ metricPeriod: "2023", computedBy: "https://bsp.example/card#me" })],
    "electricityConsumption",
    [2023],
  );
  assert.equal(rows[0].computedBy, "https://bsp.example/card#me");
  // A plain (non-benchmark) snapshot leaves the field unset rather than empty.
  const plain = materializedRows(
    [snap({ metricPeriod: "2023" })],
    "electricityConsumption",
    [2023],
  );
  assert.equal("computedBy" in plain[0], false);
});

Deno.test("materializedRows: sparse-prunes the metric it lacks and the year off-grid", () => {
  const carries = snap({ id: "a", metricPeriod: "2023" });
  const otherMetric = snap({
    id: "b",
    metricPeriod: "2023",
    values: { heatConsumption: 900 },
  });
  const offGrid = snap({ id: "c", metricPeriod: "2019" });
  const noPeriod = snap({ id: "d" });
  const rows = materializedRows(
    [carries, otherMetric, offGrid, noPeriod],
    "electricityConsumption",
    [2022, 2023],
  );
  assert.deepEqual(rows.map((r) => r.key), ["a"]);
});

Deno.test("materializedRows: an unusable value is not a cell", () => {
  const rows = materializedRows(
    [
      snap({ id: "nan", metricPeriod: "2023", values: { electricityConsumption: NaN } }),
      snap({ id: "empty", metricPeriod: "2023", values: {} }),
    ],
    "electricityConsumption",
    [2023],
  );
  assert.deepEqual(rows, []);
});

Deno.test("materializedRows: preserves the caller's tier order, defaults an absent count", () => {
  const rows = materializedRows(
    [
      snap({ id: "own", name: "Own", metricPeriod: "2023" }),
      snap({
        id: "received",
        name: "Received",
        metricPeriod: "2023",
        buildingCount: undefined,
      }),
    ],
    "electricityConsumption",
    [2023],
  );
  assert.deepEqual(rows.map((r) => r.label), ["Own", "Received"]);
  assert.equal(rows[1].members, 0);
});

Deno.test("materializedRows: no columns (an empty live grid) yields no rows", () => {
  assert.deepEqual(
    materializedRows([snap({ metricPeriod: "2023" })], "electricityConsumption", []),
    [],
  );
});
