/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  computePotential,
  dominantOrientation,
  evaluateRoofs,
  type RoofSurface,
} from "./rooftopPv.ts";
import { lod2ToPvgisAspect, specificYield } from "./pvgisGrid.ts";
import { PVGIS_GRID } from "./pvgisGridData.ts";

// The three roof surfaces of lod2-by building DEBY_LOD2_3594699 (fetched from the live
// wrapper): one suitable south roof, one north-facing pitched roof (excluded), one wall
// (tilt 90, excluded). The wrapper — using the SAME bundled PVGIS cell — serves
// installableCapacity 40.39 kWp / annualYield 41005 kWh / suitableRoofArea 202.0 / "S".
// The app must reproduce those exactly: the calc is the same, only relocated here.
const ROOFS: RoofSurface[] = [
  { areaM2: 287.506, tiltDeg: 38.444, azimuthDeg: 4.55 }, // north pitched → excluded
  { areaM2: 288.506, tiltDeg: 38.442, azimuthDeg: 184.553 }, // south pitched → suitable
  { areaM2: 117.123, tiltDeg: 90.0, azimuthDeg: -1.0 }, // wall (tilt>80) → excluded
];

Deno.test("computePotential reproduces the wrapper's served figures (fidelity)", () => {
  const p = computePotential(ROOFS);
  assert.ok(p);
  assert.equal(p.suitableAreaM2, 202.0);
  assert.equal(p.installableKwp, 40.39);
  assert.equal(p.annualKwh, 41005);
  assert.equal(p.dominantOrientation, "S");
});

Deno.test("computePotential returns null when no roof is suitable", () => {
  assert.equal(computePotential([]), null);
  assert.equal(computePotential([{ areaM2: 200, tiltDeg: 90, azimuthDeg: 180 }]), null); // wall
  assert.equal(computePotential([{ areaM2: 200, tiltDeg: 35, azimuthDeg: 0 }]), null); // north
});

Deno.test("flat roofs are re-tilted to a racked south array with a row-spacing penalty", () => {
  // 1000 m² flat roof: usable = 1000 × 0.70 × 0.6 = 420 m²; kWp = 420 × 0.20 = 84.0
  const p = computePotential([{ areaM2: 1000, tiltDeg: 5, azimuthDeg: 0 }]);
  assert.ok(p);
  assert.equal(p.suitableAreaM2, 420.0);
  assert.equal(p.installableKwp, 84.0);
  assert.equal(p.dominantOrientation, "N"); // azimuth 0 → nearest compass point
});

Deno.test("evaluateRoofs reports per-surface suitability + yield (for the roof-plan)", () => {
  const evals = evaluateRoofs(ROOFS); // [north pitched, south pitched, wall]
  assert.equal(evals.length, 3);
  // North-facing pitched roof → excluded, zero yield.
  assert.equal(evals[0].suitable, false);
  assert.equal(evals[0].annualKwh, 0);
  // South pitched roof → suitable, positive yield, orientation "S".
  assert.equal(evals[1].suitable, true);
  assert.ok(evals[1].annualKwh > 0);
  assert.ok(evals[1].kwp > 0);
  assert.equal(evals[1].orientation, "S");
  // Wall (tilt > 80) → excluded.
  assert.equal(evals[2].suitable, false);
  // The suitable surface's yield sums to the building total.
  assert.equal(evals[1].annualKwh, computePotential(ROOFS)?.annualKwh);
});

Deno.test("dominantOrientation maps the azimuth to the nearest compass point", () => {
  assert.equal(dominantOrientation(184.553), "S");
  assert.equal(dominantOrientation(0), "N");
  assert.equal(dominantOrientation(45), "NE");
  assert.equal(dominantOrientation(270), "W");
  assert.equal(dominantOrientation(360), "N");
});

Deno.test("PVGIS aspect conversion + on-grid lookup", () => {
  assert.equal(lod2ToPvgisAspect(180), 0); // S
  assert.equal(lod2ToPvgisAspect(90), -90); // E
  assert.equal(lod2ToPvgisAspect(270), 90); // W
  // On a grid node the bilinear interpolation returns that node's value exactly.
  assert.equal(specificYield(30, 0), PVGIS_GRID.grid["30,0"]);
});
