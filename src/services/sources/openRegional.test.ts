/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  openRegionalId,
  openRegionalItemsFromBuildings,
} from "./openRegional.ts";
import { REGIONAL_TABLES } from "./regionalCube.ts";
import type { Building } from "../../types.ts";

const LAND_TABLES = REGIONAL_TABLES.filter((t) => t.grain === "land");

function building(region: string | undefined): Building {
  return { id: region ?? "x", uri: `urn:${region}`, region } as Building;
}

Deno.test("derives one item per land-grain table for each distinct Bundesland", () => {
  const items = openRegionalItemsFromBuildings([
    building("Bayern"),
    building("Hessen"),
  ]);
  // 2 regions × the land-grain tables.
  assert.deepEqual(items.length, 2 * LAND_TABLES.length);
  const bavaria = items.find((i) => i.ags === "09");
  assert.deepEqual(bavaria?.region, "Bayern");
  assert.deepEqual(bavaria?.tableId, LAND_TABLES[0].tableId);
  assert.deepEqual(bavaria?.id, openRegionalId(LAND_TABLES[0].tableId, "09"));
});

Deno.test("dedupes regions (name variants → same AGS) and sorts by AGS", () => {
  const items = openRegionalItemsFromBuildings([
    building("Bavaria"), // english → 09
    building("Bayern"), // german → 09 (same region)
    building("Hessen"), // 06
  ]);
  const ags = [...new Set(items.map((i) => i.ags))];
  assert.deepEqual(ags, ["06", "09"]); // deduped + sorted, not 3 entries
});

Deno.test("no building region → falls back to all 16 Bundesländer (browse without buildings)", () => {
  // No buildings at all, and buildings with no recognised German region, both yield the
  // full-country catalog (every land table × all 16 Bundesländer) rather than nothing.
  for (
    const items of [
      openRegionalItemsFromBuildings([]),
      openRegionalItemsFromBuildings([building(undefined)]),
      openRegionalItemsFromBuildings([building("Texas")]),
    ]
  ) {
    assert.equal(new Set(items.map((i) => i.ags)).size, 16);
    assert.equal(items.length, 16 * LAND_TABLES.length);
  }
});
