/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { buildSpecs, readRows, XLSX_PATH, yearFromRange } from "./genDemoBuildings.ts";
import {
  DEMO_BUILDINGS,
  DEMO_BUILDINGS_CORE,
} from "../src/services/rdf/building/demoBuildings.generated.ts";

Deno.test("demoBuildings.generated.ts is fresh (regenerate == committed)", async () => {
  const rows = readRows(await Deno.readFile(XLSX_PATH));
  assert.deepEqual(
    buildSpecs(rows),
    DEMO_BUILDINGS,
    "generated module is stale — run `deno task gen:demo-buildings`",
  );
});

Deno.test("demo set carries the feature-coverage shapes", () => {
  assert.equal(DEMO_BUILDINGS.length, 37);
  // Every building has annual data, coordinates and the required address parts.
  for (const b of DEMO_BUILDINGS) {
    assert.ok(b.annual && Object.keys(b.annual).length >= 9, b.fields.buildingCode);
    for (const k of ["streetAddress", "postalCode", "locality", "lat", "long"]) {
      assert.ok(b.fields[k], `${b.fields.buildingCode} missing ${k}`);
    }
  }
  // Unique building codes (the import path enforces uniqueness on real adds).
  const codes = new Set(DEMO_BUILDINGS.map((b) => b.fields.buildingCode));
  assert.equal(codes.size, DEMO_BUILDINGS.length);
  // Shapes: two `both` (series toggle), one planned (Soll-Ist), one generation
  // (PV lens), ≥2 selfOperated (Betreiber benchmark group).
  assert.equal(DEMO_BUILDINGS.filter((b) => b.energy === "both").length, 2);
  assert.equal(DEMO_BUILDINGS.filter((b) => b.planned).length, 1);
  assert.equal(
    DEMO_BUILDINGS.filter((b) => b.annual?._inv_gen_2024).length,
    1,
  );
  assert.ok(DEMO_BUILDINGS.filter((b) => b.selfOperated).length >= 2);
});

Deno.test("core subset covers every asserted shape", () => {
  assert.equal(DEMO_BUILDINGS_CORE.length, 6);
  assert.ok(DEMO_BUILDINGS_CORE.some((b) => b.planned));
  assert.ok(DEMO_BUILDINGS_CORE.some((b) => b.annual?._inv_gen_2024));
  assert.equal(DEMO_BUILDINGS_CORE.filter((b) => b.energy === "both").length, 2);
  assert.ok(DEMO_BUILDINGS_CORE.filter((b) => b.selfOperated).length >= 2);
  // Spec-targeted street addresses are unique within the subset.
  const addrs = DEMO_BUILDINGS_CORE.map((b) => b.fields.streetAddress);
  assert.equal(new Set(addrs).size, addrs.length);
});

Deno.test("yearFromRange maps range start and omits open lower bounds", () => {
  assert.equal(yearFromRange("2001-2005"), 2001);
  assert.equal(yearFromRange("2021-2025"), 2021);
  assert.equal(yearFromRange("<1990"), null);
});
