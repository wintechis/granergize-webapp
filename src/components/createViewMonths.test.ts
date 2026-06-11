/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { BuildingType, EnergyDatasetRef } from "../types.ts";
import { monthsFromDays, selectedSeriesRefs } from "./createViewMonths.ts";

function ref(
  url: string,
  granularity: string,
): EnergyDatasetRef {
  return { url, year: 2024, granularity, scenario: "actual" };
}

function building(
  id: string,
  energyDatasets: EnergyDatasetRef[],
): BuildingType {
  return {
    id,
    uri: `https://pod.example/granergize/buildings/${id}.ttl#${id}`,
    type: "x",
    energyDatasets,
  } as unknown as BuildingType;
}

const A = building("a", [
  ref("https://pod.example/a/2024-PT15M.ttl#ds", "PT15M"),
  ref("https://pod.example/a/2024-P1Y.ttl#ds", "P1Y"), // annual — never a month source
]);
const B = building("b", [ref("https://pod.example/b/2023-PT15M.ttl#ds", "PT15M")]);

Deno.test("selectedSeriesRefs returns only the SELECTED buildings' series datasets", () => {
  // heike-5 #4: months from unselected buildings let the user pick a month the
  // view's actual inputs don't carry → empty snapshot.
  const refs = selectedSeriesRefs([A, B], [A.uri]);
  assert.deepEqual(refs.map((r) => r.url), [
    "https://pod.example/a/2024-PT15M.ttl#ds",
  ]);
});

Deno.test("selectedSeriesRefs with no selection yields no refs (query stays disabled)", () => {
  assert.deepEqual(selectedSeriesRefs([A, B], []), []);
});

Deno.test("selectedSeriesRefs covers the whole selection", () => {
  const refs = selectedSeriesRefs([A, B], [A.uri, B.uri]);
  assert.deepEqual(refs.map((r) => r.url), [
    "https://pod.example/a/2024-PT15M.ttl#ds",
    "https://pod.example/b/2023-PT15M.ttl#ds",
  ]);
});

Deno.test("monthsFromDays reduces day names to sorted distinct months", () => {
  const months = monthsFromDays([
    { day: "2024-06-02" },
    { day: "2024-06-01" },
    { day: "2024-05-31" },
    { day: "junk" },
  ]);
  assert.deepEqual(months, ["2024-05", "2024-06"]);
});
